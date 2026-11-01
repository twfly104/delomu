// Plans, limits and Stripe billing for the v3 server. One table (PLANS) defines what each plan includes;
// everything else reads it. Stripe is called over REST with fetch (no SDK): Checkout for upgrading to
// Team, the Customer Portal for managing it, Billing Meters for extra active deployments, and a signed
// webhook that keeps billing_accounts in step with the subscription. With no STRIPE_SECRET_KEY the
// server still runs: billing pages say billing is not configured and every org is on Free (an operator
// can still grant Enterprise with `delomu admin plan`).
//
// Stripe references (checked 2026-11-01):
// - Checkout Session create: https://docs.stripe.com/api/checkout/sessions/create
//   (metered line items must not send quantity)
// - Customer Portal session create: https://docs.stripe.com/api/customer_portal/sessions/create
// - Usage-based billing with Billing Meters, recording usage: https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api
// - Meter Event create (identifier, 35-day timestamp window): https://docs.stripe.com/api/billing/meter-event/create
// - Meter create (sum / count / last aggregation): https://docs.stripe.com/api/billing/meter/create
// - Legacy usage records removed in 2025-03-31.basil: https://docs.stripe.com/billing/subscriptions/usage-based-legacy/migration-guide
// - Webhook signatures and duplicate events: https://docs.stripe.com/events/set-up-events
//   and https://docs.stripe.com/events/manage-webhook-endpoints

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { recordEvent } from './events.mjs';
import { ApiError, sendJson } from './http.mjs';
import { listDeployments, deploymentDir } from './workspace.mjs';

// The single source of truth for plans. null means unlimited / not applicable.
export const PLANS = Object.freeze({
  free: Object.freeze({
    id: 'free', name: 'Free', monthlyUsd: 0, includedActiveDeployments: 1, extraActiveDeploymentUsd: null,
    scansPerMonth: 3, how: 'Default for every organization',
  }),
  team: Object.freeze({
    id: 'team', name: 'Team', monthlyUsd: 499, includedActiveDeployments: 5, extraActiveDeploymentUsd: 99,
    scansPerMonth: null, how: 'Self-serve with a card (Stripe Checkout)',
  }),
  enterprise: Object.freeze({
    id: 'enterprise', name: 'Enterprise', monthlyUsd: null, includedActiveDeployments: null, extraActiveDeploymentUsd: null,
    scansPerMonth: null, how: 'Contact sales; invoiced',
  }),
});

export const PLAN_IDS = Object.keys(PLANS);

// Subscription statuses that keep Team on. past_due stays on while Stripe retries the payment.
// https://docs.stripe.com/api/subscriptions/object (status)
const TEAM_STATUSES = new Set(['active', 'trialing', 'past_due']);

export const WEBHOOK_TOLERANCE_SEC = 5 * 60;
export const DEFAULT_METER_EVENT = 'delomu_extra_active_deployment';
const RUN_ID = /^(\d{4}-\d{2})-\d{2}T/; // same rule as src/v2/usage.mjs: a run folder starts with its UTC month

export class BillingConfigError extends Error {}

// Reads the Stripe settings from the environment. Returns null when billing is off (no key), throws when
// the settings are incomplete or a live key is used without DELOMU_BILLING_LIVE=1.
export function billingConfig(env = {}) {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  const live = !key.startsWith('sk_test_');
  if (live && env.DELOMU_BILLING_LIVE !== '1') {
    throw new BillingConfigError('STRIPE_SECRET_KEY is not a test key (sk_test_...). Set DELOMU_BILLING_LIVE=1 to bill real customers.');
  }
  const missing = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_TEAM', 'STRIPE_PRICE_EXTRA'].filter(k => !env[k]?.trim());
  if (missing.length) throw new BillingConfigError(`Billing needs ${missing.join(', ')} when STRIPE_SECRET_KEY is set.`);
  return {
    key,
    live,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET.trim(),
    priceTeam: env.STRIPE_PRICE_TEAM.trim(),
    priceExtra: env.STRIPE_PRICE_EXTRA.trim(),
    meterEvent: env.STRIPE_METER_EVENT?.trim() || DEFAULT_METER_EVENT,
    apiBase: (env.STRIPE_API_BASE?.trim() || 'https://api.stripe.com').replace(/\/+$/, ''),
    apiVersion: env.STRIPE_API_VERSION?.trim() || null,
  };
}

// ---- Stripe REST ---------------------------------------------------------------------------------

// Stripe takes form-encoded bodies with bracketed keys: a[b][0][c]=v.
export function formEncode(value, prefix = '', out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

export class StripeError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function stripeClient(config, fetchImpl) {
  return async function stripe(method, pathname, params, { idempotencyKey } = {}) {
    const headers = { authorization: `Bearer ${config.key}`, 'content-type': 'application/x-www-form-urlencoded' };
    if (config.apiVersion) headers['stripe-version'] = config.apiVersion;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    let res;
    try {
      res = await fetchImpl(`${config.apiBase}${pathname}`, { method, headers, body: params ? formEncode(params).toString() : undefined });
    } catch (e) {
      throw new StripeError(`could not reach Stripe (${e.message})`, 0);
    }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok) throw new StripeError(json?.error?.message ?? `Stripe answered ${res.status}`, res.status);
    return json;
  };
}

// ---- Webhook signatures ---------------------------------------------------------------------------

// Stripe-Signature: t=<unix seconds>,v1=<hex hmac>[,v1=...][,v0=...]. The signed payload is
// `${t}.${rawBody}` and v1 is HMAC-SHA256 of it with the endpoint secret. Several v1 entries appear
// while a secret is being rolled; any one matching is enough.
export function verifyStripeSignature(rawBody, header, secret, nowSec, tolerance = WEBHOOK_TOLERANCE_SEC) {
  if (typeof header !== 'string' || !header) return { ok: false, reason: 'missing Stripe-Signature header' };
  let t = null;
  const v1 = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1.push(v);
  }
  if (!t || !/^\d{1,12}$/.test(t) || !v1.length) return { ok: false, reason: 'malformed Stripe-Signature header' };
  if (Math.abs(nowSec - Number(t)) > tolerance) return { ok: false, reason: 'timestamp outside the tolerance' };
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  const match = v1.some(sig => {
    if (!/^[0-9a-f]{64}$/i.test(sig)) return false;
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), expected);
  });
  return match ? { ok: true, timestamp: Number(t) } : { ok: false, reason: 'no signature matches' };
}

// For tests and the docs: the header Stripe would send for this body.
export function signStripePayload(rawBody, secret, timestampSec) {
  const sig = crypto.createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
  return `t=${timestampSec},v1=${sig}`;
}

// ---- Accounts (billing_accounts) ------------------------------------------------------------------

export function getAccount(db, orgId) {
  return db.prepare('SELECT * FROM billing_accounts WHERE org_id = ?').get(orgId) ?? null;
}

function upsertAccount(db, orgId, fields, now) {
  const current = getAccount(db, orgId);
  const row = {
    plan: 'free', status: 'none', stripe_customer_id: null, stripe_subscription_id: null, current_period_end: null,
    cancel_at_period_end: 0, payment_failed_at: null, stripe_event_created: 0, ...current, ...fields, updated_at: now.toISOString(),
  };
  db.prepare(`INSERT INTO billing_accounts (org_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end,
      cancel_at_period_end, payment_failed_at, stripe_event_created, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (org_id) DO UPDATE SET plan = excluded.plan, status = excluded.status, stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id, current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end, payment_failed_at = excluded.payment_failed_at,
      stripe_event_created = excluded.stripe_event_created, updated_at = excluded.updated_at`)
    .run(orgId, row.plan, row.status, row.stripe_customer_id, row.stripe_subscription_id, row.current_period_end,
      row.cancel_at_period_end ? 1 : 0, row.payment_failed_at, row.stripe_event_created, row.updated_at);
  return { before: current?.plan ?? 'free', after: row.plan };
}

// Operator override (CLI): Enterprise is sold by contract, so it is set here, not through Stripe.
export function setPlanByOperator(db, orgId, plan, now = new Date()) {
  if (!['free', 'enterprise'].includes(plan)) throw new Error('plan must be free or enterprise (Team is bought through Stripe Checkout)');
  if (!db.prepare('SELECT 1 FROM orgs WHERE id = ?').get(orgId)) throw new Error(`no org ${orgId}`);
  const current = getAccount(db, orgId);
  if (plan === 'free' && current?.plan === 'team') throw new Error('this org pays for Team through Stripe; cancel it in the Customer Portal instead');
  const change = upsertAccount(db, orgId, { plan, status: plan === 'enterprise' ? 'contract' : 'none' }, now);
  recordEvent(db, { orgId, actor: 'system', action: 'billing.plan_change', target: orgId, detail: { from: change.before, to: plan, via: 'operator' } }, now);
  return change;
}

// ---- Usage this month -----------------------------------------------------------------------------

export const monthOf = date => date.toISOString().slice(0, 7);

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return [new Date(Date.UTC(y, m - 1, 1)).toISOString(), new Date(Date.UTC(y, m, 1)).toISOString()];
}

// A deployment is active in a month when it has at least one completed run that month (the same
// definition src/v2/usage.mjs bills by): a runs/<id>/results.json whose id starts with the month.
export function isActiveIn(dir, month) {
  const runs = path.join(dir, 'runs');
  if (!fs.existsSync(runs)) return false;
  return fs.readdirSync(runs).some(id => RUN_ID.exec(id)?.[1] === month && fs.existsSync(path.join(runs, id, 'results.json')));
}

export function activeDeployments(db, root, orgId, month) {
  return listDeployments(db, root, orgId).map(d => d.name).filter(name => isActiveIn(deploymentDir(root, orgId, name), month));
}

export function scansThisMonth(db, orgId, month) {
  const [from, to] = monthRange(month);
  return db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE org_id = ? AND action = 'scan.create' AND ts >= ? AND ts < ?").get(orgId, from, to).n;
}

// ---- The billing service --------------------------------------------------------------------------

const planLimit = (code, message, upgradeUrl) => new ApiError('permission_error', message, { status: 402, code, extra: { upgrade_url: upgradeUrl } });

// ctx needs { db, deploymentsRoot, now, log }. fetchImpl defaults to the global fetch.
export function createBilling({ db, env = {}, deploymentsRoot, now = () => new Date(), log = () => {}, fetch: fetchImpl = globalThis.fetch, billingPath }) {
  const config = billingConfig(env);
  const stripe = config ? stripeClient(config, fetchImpl) : null;
  const pathFor = billingPath ?? (orgId => `/orgs/${encodeURIComponent(orgId)}/billing`);
  // In-flight runs and scans, so two requests at once cannot both take the last free slot.
  const pendingRuns = new Map(); // orgId -> Set(deployment name)
  const pendingScans = new Map(); // orgId -> count

  // The plan an org is on right now. Without Stripe every org is Free, except an operator-granted Enterprise.
  function planOf(orgId) {
    const account = getAccount(db, orgId);
    if (account?.plan === 'enterprise') return PLANS.enterprise;
    if (!config) return PLANS.free;
    if (account?.plan === 'team' && TEAM_STATUSES.has(account.status)) return PLANS.team;
    return PLANS.free;
  }

  function summary(orgId) {
    const month = monthOf(now());
    const plan = planOf(orgId);
    const active = activeDeployments(db, deploymentsRoot, orgId, month);
    const scans = scansThisMonth(db, orgId, month);
    const included = plan.includedActiveDeployments;
    const extra = included === null || plan.extraActiveDeploymentUsd === null ? 0 : Math.max(0, active.length - included);
    return {
      configured: !!config, live: !!config?.live, month, plan, account: getAccount(db, orgId), active, scans,
      extra, extraUsd: extra * (plan.extraActiveDeploymentUsd ?? 0),
    };
  }

  // Throws a 402 when starting a run would make one deployment too many active this month.
  // Returns a release function to call when the run ends.
  function reserveRun(orgId, name) {
    const month = monthOf(now());
    const plan = planOf(orgId);
    const pending = pendingRuns.get(orgId) ?? new Set();
    const release = () => { pending.delete(name); if (!pending.size) pendingRuns.delete(orgId); };
    const limit = plan.includedActiveDeployments;
    const hardCap = limit !== null && plan.extraActiveDeploymentUsd === null;
    if (hardCap) {
      const active = new Set([...activeDeployments(db, deploymentsRoot, orgId, month), ...pending]);
      if (!active.has(name) && active.size >= limit) {
        throw planLimit('plan_limit_active_deployments',
          `The ${plan.name} plan includes ${limit} active deployment${limit === 1 ? '' : 's'} a month, and ${[...active].join(', ')} ${active.size === 1 ? 'is' : 'are'} already active in ${month}. `
          + `Upgrade to Team for ${PLANS.team.includedActiveDeployments} included and $${PLANS.team.extraActiveDeploymentUsd} per extra one; an owner or admin can do this on the Billing page.`,
          pathFor(orgId));
      }
    }
    pending.add(name);
    pendingRuns.set(orgId, pending);
    return release;
  }

  function reserveScan(orgId) {
    const month = monthOf(now());
    const plan = planOf(orgId);
    const inFlight = pendingScans.get(orgId) ?? 0;
    if (plan.scansPerMonth !== null && scansThisMonth(db, orgId, month) + inFlight >= plan.scansPerMonth) {
      throw planLimit('plan_limit_scans',
        `The ${plan.name} plan includes ${plan.scansPerMonth} risk scans a month and this organization has used them all in ${month}. `
        + 'Upgrade to Team for unlimited scans; an owner or admin can do this on the Billing page.',
        pathFor(orgId));
    }
    pendingScans.set(orgId, inFlight + 1);
    return () => {
      const n = (pendingScans.get(orgId) ?? 1) - 1;
      if (n > 0) pendingScans.set(orgId, n); else pendingScans.delete(orgId);
    };
  }

  // After a completed run: if the deployment just became an extra active one on Team, queue one meter
  // event for it, then send whatever is still unsent. Usage errors are logged, never fail the run.
  // The identifier is stable per org, month and deployment, so a resend is deduplicated by Stripe.
  async function afterRun(orgId, name) {
    try {
      const s = summary(orgId);
      if (s.plan.id !== 'team' || !s.active.includes(name)) return;
      // One meter event per extra active deployment: rows for the month always equal the extras.
      const extras = Math.max(0, s.active.length - s.plan.includedActiveDeployments);
      const rows = db.prepare('SELECT deployment FROM billing_usage_reports WHERE org_id = ? AND month = ?').all(orgId, s.month).map(r => r.deployment);
      if (extras > rows.length && !rows.includes(name)) {
        const identifier = `dlm_${crypto.createHash('sha256').update([orgId, s.month, name].join('\n')).digest('hex').slice(0, 40)}`;
        db.prepare('INSERT OR IGNORE INTO billing_usage_reports (org_id, month, deployment, identifier, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(orgId, s.month, name, identifier, now().toISOString());
      }
      await flushUsage(orgId);
    } catch (e) {
      log(`billing: usage for ${orgId}/${name} not recorded: ${e.message}`);
    }
  }

  // Sends unsent meter events (one per extra active deployment per month, value 1, summed by the meter).
  // The identifier makes a retry of the same event a no-op on Stripe's side.
  async function flushUsage(orgId) {
    if (!stripe) return { sent: 0, failed: 0 };
    const account = getAccount(db, orgId);
    if (!account?.stripe_customer_id) return { sent: 0, failed: 0 };
    const rows = db.prepare('SELECT * FROM billing_usage_reports WHERE org_id = ? AND reported_at IS NULL ORDER BY created_at').all(orgId);
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      // Stripe accepts meter events up to 35 days old; report at the time the deployment became extra.
      const ts = Math.floor(Math.max(new Date(r.created_at).getTime(), now().getTime() - 34 * 86400_000) / 1000);
      try {
        await stripe('POST', '/v1/billing/meter_events', {
          event_name: config.meterEvent, identifier: r.identifier, timestamp: ts,
          payload: { stripe_customer_id: account.stripe_customer_id, value: 1 },
        }, { idempotencyKey: r.identifier });
        db.prepare('UPDATE billing_usage_reports SET reported_at = ?, error = NULL WHERE identifier = ?').run(now().toISOString(), r.identifier);
        sent++;
      } catch (e) {
        db.prepare('UPDATE billing_usage_reports SET error = ? WHERE identifier = ?').run(String(e.message).slice(0, 500), r.identifier);
        log(`billing: meter event ${r.identifier} failed: ${e.message}`);
        failed++;
      }
    }
    return { sent, failed };
  }

  function needConfig() {
    if (!stripe) throw new ApiError('invalid_request_error', 'Billing is not configured on this server.', { status: 409, code: 'billing_not_configured' });
  }

  // Returns the Stripe-hosted Checkout URL for upgrading this org to Team.
  async function createCheckout(org, { email, returnBase }) {
    needConfig();
    if (planOf(org.id).id !== 'free') throw new ApiError('conflict_error', `This organization is already on ${planOf(org.id).name}. Use Manage billing to change it.`);
    const account = getAccount(db, org.id);
    const back = `${returnBase}${pathFor(org.id)}`;
    const session = await callStripe(() => stripe('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price: config.priceTeam, quantity: 1 }, { price: config.priceExtra }], // metered: no quantity
      client_reference_id: org.id,
      ...(account?.stripe_customer_id ? { customer: account.stripe_customer_id } : { customer_email: email }),
      metadata: { org_id: org.id },
      subscription_data: { metadata: { org_id: org.id } },
      success_url: `${back}?checkout=success`,
      cancel_url: `${back}?checkout=cancelled`,
    }));
    if (!session?.url) throw new ApiError('api_error', 'Stripe did not return a Checkout link.', { status: 502 });
    return session.url;
  }

  async function createPortal(org, { returnBase }) {
    needConfig();
    const account = getAccount(db, org.id);
    if (!account?.stripe_customer_id) throw new ApiError('conflict_error', 'This organization has no Stripe customer yet. Upgrade first.');
    const session = await callStripe(() => stripe('POST', '/v1/billing_portal/sessions', { customer: account.stripe_customer_id, return_url: `${returnBase}${pathFor(org.id)}` }));
    if (!session?.url) throw new ApiError('api_error', 'Stripe did not return a portal link.', { status: 502 });
    return session.url;
  }

  async function callStripe(fn) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof StripeError)) throw e;
      log(`billing: Stripe call failed: ${e.message}`);
      throw new ApiError('api_error', `Stripe could not start this: ${e.message}`, { status: 502, code: 'stripe_error' });
    }
  }

  // ---- Webhook ----

  const orgExists = id => typeof id === 'string' && !!db.prepare('SELECT 1 FROM orgs WHERE id = ?').get(id);
  const orgByCustomer = id => id && db.prepare('SELECT org_id FROM billing_accounts WHERE stripe_customer_id = ?').get(id)?.org_id;
  const orgBySubscription = id => id && db.prepare('SELECT org_id FROM billing_accounts WHERE stripe_subscription_id = ?').get(id)?.org_id;
  const idOf = v => (typeof v === 'string' ? v : v?.id ?? null);

  function planEvent(orgId, change, detail) {
    if (change.before !== change.after) {
      recordEvent(db, { orgId, actor: 'system', action: 'billing.plan_change', target: orgId, detail: { from: change.before, to: change.after, ...detail } }, now());
    }
  }

  // Applies one verified event. Returns a short note for the response and the log.
  function applyEvent(event) {
    const obj = event.data?.object ?? {};
    const created = Number(event.created) || 0;
    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription') return 'ignored: not a subscription checkout';
        const orgId = [obj.client_reference_id, obj.metadata?.org_id].find(orgExists);
        if (!orgId) return 'ignored: no matching org';
        const paid = ['paid', 'no_payment_required'].includes(obj.payment_status);
        const current = getAccount(db, orgId);
        // An unpaid (async) checkout only links the Stripe ids; the subscription events set the plan.
        const change = upsertAccount(db, orgId, {
          stripe_customer_id: idOf(obj.customer), stripe_subscription_id: idOf(obj.subscription),
          ...(paid && created >= (current?.stripe_event_created ?? 0) ? { plan: 'team', status: 'active', stripe_event_created: created } : {}),
        }, now());
        planEvent(orgId, change, { via: 'stripe', event: event.id });
        return `org ${orgId}: checkout completed`;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const orgId = [obj.metadata?.org_id].find(orgExists) ?? orgBySubscription(obj.id) ?? orgByCustomer(idOf(obj.customer));
        if (!orgId) return 'ignored: no matching org';
        const current = getAccount(db, orgId);
        if (current?.plan === 'enterprise') return `org ${orgId}: on Enterprise, subscription event ignored`;
        if (current && created < (current.stripe_event_created ?? 0)) return `org ${orgId}: older than the last applied event, ignored`;
        if (current?.stripe_subscription_id && obj.id && obj.id !== current.stripe_subscription_id && event.type !== 'customer.subscription.created') {
          return `org ${orgId}: event for another subscription (${obj.id}), ignored`;
        }
        const deleted = event.type === 'customer.subscription.deleted';
        const status = deleted ? 'canceled' : String(obj.status ?? 'incomplete');
        // current_period_end moved from the subscription to its items in 2025-03-31.basil; read either.
        const periodEnd = obj.current_period_end ?? obj.items?.data?.[0]?.current_period_end ?? null;
        const change = upsertAccount(db, orgId, {
          plan: !deleted && TEAM_STATUSES.has(status) ? 'team' : 'free',
          status,
          stripe_customer_id: idOf(obj.customer) ?? current?.stripe_customer_id ?? null,
          stripe_subscription_id: deleted ? null : obj.id ?? current?.stripe_subscription_id ?? null,
          current_period_end: periodEnd ? new Date(Number(periodEnd) * 1000).toISOString() : null,
          cancel_at_period_end: obj.cancel_at_period_end ? 1 : 0,
          ...(status === 'active' ? { payment_failed_at: null } : {}),
          stripe_event_created: created,
        }, now());
        planEvent(orgId, change, { via: 'stripe', event: event.id, status });
        return `org ${orgId}: subscription ${status}`;
      }
      case 'invoice.payment_failed': {
        const orgId = orgByCustomer(idOf(obj.customer));
        if (!orgId) return 'ignored: no matching org';
        const current = getAccount(db, orgId);
        // Stripe keeps retrying; the subscription event that follows sets the real status. Until then mark it.
        upsertAccount(db, orgId, { payment_failed_at: now().toISOString(), ...(current?.status === 'active' ? { status: 'past_due' } : {}) }, now());
        recordEvent(db, { orgId, actor: 'system', action: 'billing.payment_failed', target: idOf(obj.id) ?? '', detail: { via: 'stripe', event: event.id, attempt: obj.attempt_count ?? null } }, now());
        return `org ${orgId}: payment failed`;
      }
      default:
        return `ignored: ${event.type} is not handled`;
    }
  }

  // POST /webhooks/stripe. Answers 400 to anything not signed by Stripe, 200 to every verified event
  // (including ones it ignores or has already processed), so Stripe stops retrying them.
  async function handleWebhook(req, res, { maxBodyBytes }) {
    if (!config) { sendJson(res, 404, { error: { type: 'not_found_error', message: 'Billing is not configured on this server.' } }); return; }
    if (req.method !== 'POST') { sendJson(res, 405, { error: { type: 'invalid_request_error', message: 'Use POST.' } }, { allow: 'POST' }); return; }
    let raw;
    try {
      raw = await readRawBody(req, maxBodyBytes);
    } catch (e) {
      sendJson(res, 413, { error: { type: 'invalid_request_error', message: e.message } });
      return;
    }
    const check = verifyStripeSignature(raw, req.headers['stripe-signature'], config.webhookSecret, Math.floor(now().getTime() / 1000));
    if (!check.ok) {
      log(`billing: webhook refused: ${check.reason}`);
      sendJson(res, 400, { error: { type: 'invalid_request_error', message: `Invalid signature: ${check.reason}.` } });
      return;
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { event = null; }
    if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
      sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'Not a Stripe event.' } });
      return;
    }
    if (typeof event.livemode === 'boolean' && event.livemode !== config.live) {
      sendJson(res, 200, { received: true, note: `ignored: ${event.livemode ? 'live' : 'test'} event for a ${config.live ? 'live' : 'test'} key` });
      return;
    }
    let note;
    db.exec('BEGIN IMMEDIATE');
    try {
      const seen = db.prepare('SELECT 1 FROM stripe_events WHERE id = ?').get(event.id);
      if (seen) note = 'duplicate: already processed';
      else {
        note = applyEvent(event);
        db.prepare('INSERT INTO stripe_events (id, type, created, received_at, note) VALUES (?, ?, ?, ?, ?)')
          .run(event.id, event.type, Number(event.created) || 0, now().toISOString(), note);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      log(`billing: webhook ${event.id} failed: ${e.stack ?? e}`);
      sendJson(res, 500, { error: { type: 'api_error', message: 'Could not process the event.' } }); // Stripe retries
      return;
    }
    sendJson(res, 200, { received: true, note });
  }

  return { configured: !!config, config, planOf, summary, reserveRun, reserveScan, afterRun, flushUsage, createCheckout, createPortal, handleWebhook };
}

// The exact bytes Stripe signed; rejects past `limit` bytes.
function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) { req.resume(); reject(new Error(`Request body is larger than ${limit} bytes.`)); return; }
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { req.removeAllListeners('data'); req.resume(); reject(new Error(`Request body is larger than ${limit} bytes.`)); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
