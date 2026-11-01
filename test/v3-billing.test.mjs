// Billing: plan table, Stripe config guard, webhook signatures, Checkout / Portal / meter events against
// a fake Stripe (node:http), plan transitions from webhooks, Free-plan limits and who may open Billing.
// Only fake keys (sk_test_fake, whsec_fake); nothing here talks to Stripe.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { openDb } from '../src/v3/db.mjs';
import { recordEvent } from '../src/v3/events.mjs';
import {
  PLANS, billingConfig, BillingConfigError, formEncode, verifyStripeSignature, signStripePayload, setPlanByOperator, getAccount,
} from '../src/v3/billing.mjs';
import { createServer } from '../src/v3/server.mjs';
import { api, startServer, seedOrg, fakeTarget, CASES_CSV, targetConfig, listen, close, tmp, PEPPER } from './v3-support.test.mjs';

const WHSEC = 'whsec_fake_test_secret';
const nowSec = () => Math.floor(Date.now() / 1000);

// ---- Units ----------------------------------------------------------------------------------------

test('plans: one table with the agreed limits and prices', () => {
  assert.deepEqual(Object.keys(PLANS), ['free', 'team', 'enterprise']);
  assert.equal(PLANS.free.includedActiveDeployments, 1);
  assert.equal(PLANS.free.scansPerMonth, 3);
  assert.equal(PLANS.free.extraActiveDeploymentUsd, null);
  assert.deepEqual([PLANS.team.monthlyUsd, PLANS.team.includedActiveDeployments, PLANS.team.extraActiveDeploymentUsd, PLANS.team.scansPerMonth], [499, 5, 99, null]);
  assert.equal(PLANS.enterprise.monthlyUsd, null);
  assert.ok(Object.isFrozen(PLANS) && Object.isFrozen(PLANS.team));
});

test('config: off without a key; live keys need DELOMU_BILLING_LIVE=1; incomplete settings are refused', () => {
  const full = { STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PRICE_TEAM: 'price_team', STRIPE_PRICE_EXTRA: 'price_extra' };
  assert.equal(billingConfig({}), null);
  assert.equal(billingConfig({ STRIPE_SECRET_KEY: '  ' }), null);
  const c = billingConfig(full);
  assert.deepEqual([c.live, c.meterEvent, c.apiBase], [false, 'delomu_extra_active_deployment', 'https://api.stripe.com']);
  assert.throws(() => billingConfig({ ...full, STRIPE_SECRET_KEY: 'sk_live_fake' }), BillingConfigError);
  assert.throws(() => billingConfig({ ...full, STRIPE_SECRET_KEY: 'rk_live_fake' }), /DELOMU_BILLING_LIVE=1/);
  assert.equal(billingConfig({ ...full, STRIPE_SECRET_KEY: 'sk_live_fake', DELOMU_BILLING_LIVE: '1' }).live, true);
  assert.throws(() => billingConfig({ STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_PRICE_TEAM: 'p' }), /STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_EXTRA/);
  // The server refuses to start rather than run billing with a live key by accident.
  assert.throws(() => createServer({ dataDir: tmp('live'), deploymentsRoot: tmp('live-deps'), pepper: PEPPER, env: { ...full, STRIPE_SECRET_KEY: 'sk_live_fake' }, log: () => {} }), /not a test key/);
});

test('form encoding: nested objects and arrays use Stripe brackets', () => {
  const body = formEncode({ mode: 'subscription', line_items: [{ price: 'a', quantity: 1 }, { price: 'b' }], metadata: { org_id: 'org_1' }, skip: undefined });
  assert.equal(decodeURIComponent(body.toString()), 'mode=subscription&line_items[0][price]=a&line_items[0][quantity]=1&line_items[1][price]=b&metadata[org_id]=org_1');
});

test('webhook signature: valid, wrong secret, tampered, stale, future, malformed, rolled secrets', () => {
  const body = '{"id":"evt_1"}';
  const t = 1_800_000_000;
  const header = signStripePayload(body, WHSEC, t);
  assert.equal(verifyStripeSignature(body, header, WHSEC, t).ok, true);
  assert.equal(verifyStripeSignature(Buffer.from(body), header, WHSEC, t + 299).ok, true);
  assert.match(verifyStripeSignature(body, header, 'whsec_other', t).reason, /no signature/);
  assert.match(verifyStripeSignature(body + ' ', header, WHSEC, t).reason, /no signature/);
  assert.match(verifyStripeSignature(body, header, WHSEC, t + 301).reason, /tolerance/);
  assert.match(verifyStripeSignature(body, header, WHSEC, t - 301).reason, /tolerance/);
  for (const bad of [undefined, '', 'v1=abc', `t=${t}`, `t=abc,v1=${'0'.repeat(64)}`]) assert.equal(verifyStripeSignature(body, bad, WHSEC, t).ok, false, String(bad));
  assert.equal(verifyStripeSignature(body, `t=${t},v1=zz`, WHSEC, t).ok, false);
  // While a secret is rolled Stripe sends one v1 per secret; one match is enough. v0 is ignored.
  const good = header.split('v1=')[1];
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${'a'.repeat(64)},v1=${good},v0=${'b'.repeat(64)}`, WHSEC, t).ok, true);
});

test('CLI: admin plan grants and removes Enterprise', () => {
  const dataDir = tmp('cli-plan');
  const o = seedOrg(dataDir, { name: 'Cli Plan', members: [{ email: 'o@cli.test', role: 'owner' }] });
  const bin = new URL('../bin/delomu.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const cli = (...args) => spawnSync(process.execPath, [bin, 'admin', ...args, '--data', dataDir], { encoding: 'utf8', env: { ...process.env, DELOMU_KEY_PEPPER: PEPPER } });
  let r = cli('plan', '--org', o.org.id, '--plan', 'enterprise');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /free -> enterprise/);
  r = cli('plan', '--org', o.org.id, '--plan', 'team');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Checkout/);
  r = cli('plan', '--org', o.org.id);
  assert.match(r.stderr, /usage: delomu admin bootstrap/);
  assert.equal(cli('plan', '--org', o.org.id, '--plan', 'free').status, 0);
});

// ---- Fake Stripe ----------------------------------------------------------------------------------

async function fakeStripe() {
  const calls = [];
  const state = { failMeter: false };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const form = Object.fromEntries(new URLSearchParams(raw));
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, idem: req.headers['idempotency-key'], form });
      const reply = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
      if (req.headers.authorization !== 'Bearer sk_test_fake') return reply(401, { error: { message: 'Invalid API Key provided' } });
      if (req.url === '/v1/checkout/sessions') return reply(200, { id: 'cs_test_1', object: 'checkout.session', url: 'https://checkout.stripe.test/c/pay/cs_test_1' });
      if (req.url === '/v1/billing_portal/sessions') return reply(200, { id: 'bps_1', object: 'billing_portal.session', url: 'https://billing.stripe.test/p/session/1' });
      if (req.url === '/v1/billing/meter_events') {
        if (state.failMeter) return reply(500, { error: { message: 'meter is down' } });
        return reply(200, { object: 'billing.meter_event', event_name: form.event_name, identifier: form.identifier });
      }
      return reply(404, { error: { message: `no route ${req.url}` } });
    });
  });
  const base = await listen(server);
  return { base, calls, state, close: () => close(server) };
}

// ---- Web helpers ----------------------------------------------------------------------------------

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);

function webClient(srv, keys) {
  const signIn = async email => {
    const page = await fetch(`${srv.base}/login`);
    const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
    const res = await fetch(`${srv.base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] },
      body: new URLSearchParams({ csrf, api_key: keys[email] }),
    });
    const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
    const home = await fetch(`${srv.base}/`, { headers: { cookie } });
    return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(await home.text())[1] };
  };
  const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
  const post = (url, cookie, form) => fetch(srv.base + url, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
  });
  return { signIn, get, post };
}

async function addDeployment(srv, key, orgId, name, url) {
  const r = await api(srv.base, 'POST', `/v1/orgs/${orgId}/deployments`, { key, body: { name, config: targetConfig(url), cases: CASES_CSV } });
  assert.equal(r.status, 201, r.text);
}
const run = (srv, key, orgId, name) => api(srv.base, 'POST', `/v1/orgs/${orgId}/deployments/${name}/runs`, { key, body: {} });

function seedScans(dataDir, orgId, n) {
  const db = openDb(dataDir);
  try {
    for (let i = 0; i < n; i++) recordEvent(db, { orgId, actor: 'human:eng@x.test', action: 'scan.create', target: `bot/scan-${i}` });
  } finally {
    db.close();
  }
}

// ---- No Stripe configured: everyone is Free -------------------------------------------------------

describe('billing not configured', () => {
  let srv;
  let target;
  let o;
  const ORG_MEMBERS = [{ email: 'owner@free.test', role: 'owner' }, { email: 'eng@free.test', role: 'engineer' }, { email: 'view@free.test', role: 'viewer' }];

  before(async () => {
    srv = await startServer({ llm: {} }); // an llm without methods: a scan that gets past the limit fails fast
    target = await fakeTarget();
    o = seedOrg(srv.dataDir, { name: 'Free Co', members: ORG_MEMBERS });
  });
  after(async () => { await srv.close(); await target.close(); });

  test('billing page explains it is not configured; webhook endpoint is off', async () => {
    const { signIn, get } = webClient(srv, o.keys);
    const owner = await signIn('owner@free.test');
    const res = await get(`/orgs/${o.org.id}/billing`, owner.cookie);
    assert.equal(res.status, 200);
    const page = await res.text();
    assert.match(page, /Billing is not configured on this server/);
    assert.match(page, /<span class="badge plain">Free<\/span>/);
    assert.match(page, /\$499 \/ month/);
    assert.match(page, /\$99 \/ month/);
    assert.doesNotMatch(page, /Upgrade to Team/);
    assert.match(page, /href="\/orgs\/[^"]+\/billing" aria-current="page"/); // rail link, current
    const hook = await fetch(`${srv.base}/webhooks/stripe`, { method: 'POST', body: '{}' });
    assert.equal(hook.status, 404);
  });

  test('RBAC: viewers and engineers cannot open Billing, and do not see the link', async () => {
    const { signIn, get, post } = webClient(srv, o.keys);
    for (const email of ['view@free.test', 'eng@free.test']) {
      const s = await signIn(email);
      assert.equal((await get(`/orgs/${o.org.id}/billing`, s.cookie)).status, 403, email);
      assert.equal((await post(`/orgs/${o.org.id}/billing/checkout`, s.cookie, { csrf: s.csrf })).status, 403, email);
      assert.doesNotMatch(await (await get(`/orgs/${o.org.id}`, s.cookie)).text(), /\/billing"/, email);
    }
    const owner = await signIn('owner@free.test');
    assert.match(await (await get(`/orgs/${o.org.id}`, owner.cookie)).text(), /\/billing"/);
    assert.equal((await post(`/orgs/${o.org.id}/billing/checkout`, owner.cookie, { csrf: 'forged' })).status, 403);
    const nope = await post(`/orgs/${o.org.id}/billing/checkout`, owner.cookie, { csrf: owner.csrf });
    assert.equal(nope.status, 409);
    assert.match(await nope.text(), /Billing is not configured/);
  });

  test('Free: a second active deployment is refused with an upgrade link; the first keeps running', async () => {
    const key = o.keys['eng@free.test'];
    await addDeployment(srv, key, o.org.id, 'first', target.url);
    await addDeployment(srv, key, o.org.id, 'second', target.url);
    assert.equal((await run(srv, key, o.org.id, 'first')).status, 201);
    const refused = await run(srv, key, o.org.id, 'second');
    assert.equal(refused.status, 402);
    assert.equal(refused.json.error.type, 'permission_error');
    assert.equal(refused.json.error.code, 'plan_limit_active_deployments');
    assert.equal(refused.json.error.upgrade_url, `/orgs/${o.org.id}/billing`);
    assert.match(refused.json.error.message, /Free plan includes 1 active deployment a month, and first is already active/);
    await new Promise(r => setTimeout(r, 1100)); // run ids have one-second resolution
    assert.equal((await run(srv, key, o.org.id, 'first')).status, 201, 'the active one can run again');

    const { signIn, post } = webClient(srv, o.keys);
    const eng = await signIn('eng@free.test');
    const page = await post(`/orgs/${o.org.id}/deployments/second/run`, eng.cookie, { csrf: eng.csrf });
    assert.equal(page.status, 402);
    const htmlText = await page.text();
    assert.match(htmlText, /Upgrade to Team for 5 included and \$99 per extra one/);
    assert.match(htmlText, new RegExp(`<a href="/orgs/${o.org.id}/billing">View plans and upgrade</a>`));
  });

  test('Free: the fourth risk scan in a month is refused; failed scans do not count', async () => {
    const { signIn, post, get } = webClient(srv, o.keys);
    const eng = await signIn('eng@free.test');
    seedScans(srv.dataDir, o.org.id, 2);
    const third = await post(`/orgs/${o.org.id}/deployments/first/scan`, eng.cookie, { csrf: eng.csrf });
    assert.equal(third.status, 303, 'within the limit: the scan starts in the background');
    let page = '';
    for (let i = 0; i < 50 && !/could not finish|found nothing/.test(page); i++) {
      await new Promise(r => setTimeout(r, 40));
      page = await (await get(`/orgs/${o.org.id}/deployments/first/scan`, eng.cookie)).text();
    }
    assert.match(page, /could not finish|found nothing/, 'it fails here without a model');
    assert.doesNotMatch(page, /risk scans a month/);
    seedScans(srv.dataDir, o.org.id, 1);
    const fourth = await post(`/orgs/${o.org.id}/deployments/first/scan`, eng.cookie, { csrf: eng.csrf });
    assert.equal(fourth.status, 402);
    const text = await fourth.text();
    assert.match(text, /Free plan includes 3 risk scans a month/);
    assert.match(text, /View plans and upgrade/);
  });

  test('operator-granted Enterprise lifts the limits, even without Stripe', async () => {
    const db = openDb(srv.dataDir);
    try {
      assert.deepEqual(setPlanByOperator(db, o.org.id, 'enterprise'), { before: 'free', after: 'enterprise' });
      assert.throws(() => setPlanByOperator(db, o.org.id, 'team'), /Checkout/);
      assert.throws(() => setPlanByOperator(db, 'org_0000000000000000', 'enterprise'), /no org/);
    } finally {
      db.close();
    }
    assert.equal((await run(srv, o.keys['eng@free.test'], o.org.id, 'second')).status, 201);
    const { signIn, get } = webClient(srv, o.keys);
    const owner = await signIn('owner@free.test');
    const page = await (await get(`/orgs/${o.org.id}/billing`, owner.cookie)).text();
    assert.match(page, /<span class="badge good">Enterprise<\/span>/);
    assert.match(page, /<span class="strong">2<\/span> <span class="subtle">of Unlimited/);
    const db2 = openDb(srv.dataDir);
    try { setPlanByOperator(db2, o.org.id, 'free'); } finally { db2.close(); }
  });
});

// ---- Stripe test mode against a fake Stripe -------------------------------------------------------

describe('billing with Stripe (fake)', () => {
  let srv;
  let stripe;
  let target;
  let o;
  let web;
  let owner;
  let created = 1_700_000_000;
  const MEMBERS = [{ email: 'owner@team.test', role: 'owner' }, { email: 'admin@team.test', role: 'admin' }, { email: 'eng@team.test', role: 'engineer' }, { email: 'view@team.test', role: 'viewer' }];

  before(async () => {
    stripe = await fakeStripe();
    target = await fakeTarget();
    srv = await startServer({ env: {
      STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_PRICE_TEAM: 'price_team_fake', STRIPE_PRICE_EXTRA: 'price_extra_fake',
      STRIPE_API_BASE: stripe.base, DELOMU_SALES_CONTACT: 'sales@delomu.test',
    } });
    o = seedOrg(srv.dataDir, { name: 'Team Co', members: MEMBERS });
    web = webClient(srv, o.keys);
    owner = await web.signIn('owner@team.test');
  });
  after(async () => { await srv.close(); await stripe.close(); await target.close(); });

  const account = () => { const db = openDb(srv.dataDir); try { return getAccount(db, o.org.id); } finally { db.close(); } };
  const billingPage = async () => (await web.get(`/orgs/${o.org.id}/billing`, owner.cookie)).text();
  async function send(type, object, { id = `evt_${type}_${created}`, livemode = false, sign = true, t = nowSec(), when = ++created } = {}) {
    const body = JSON.stringify({ id, object: 'event', type, created: when, livemode, data: { object } });
    const headers = { 'content-type': 'application/json' };
    if (sign) headers['stripe-signature'] = signStripePayload(body, WHSEC, t);
    const res = await fetch(`${srv.base}/webhooks/stripe`, { method: 'POST', headers, body });
    return { status: res.status, json: await res.json() };
  }
  const subscription = (status, extra = {}) => ({ id: 'sub_test_1', object: 'subscription', customer: 'cus_test_1', status, metadata: { org_id: o.org.id }, items: { data: [{ current_period_end: 1_900_000_000 }] }, ...extra });

  test('upgrade: Checkout Session for Team with the metered extra price', async () => {
    const page = await billingPage();
    assert.match(page, /Stripe test mode/);
    assert.match(page, /Upgrade to Team/);
    assert.doesNotMatch(page, /Manage billing/);
    assert.match(page, /href="mailto:sales@delomu.test"/);
    const res = await web.post(`/orgs/${o.org.id}/billing/checkout`, owner.cookie, { csrf: owner.csrf });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), 'https://checkout.stripe.test/c/pay/cs_test_1');
    const call = stripe.calls.find(c => c.path === '/v1/checkout/sessions');
    assert.equal(call.auth, 'Bearer sk_test_fake');
    assert.equal(call.form.mode, 'subscription');
    assert.equal(call.form['line_items[0][price]'], 'price_team_fake');
    assert.equal(call.form['line_items[0][quantity]'], '1');
    assert.equal(call.form['line_items[1][price]'], 'price_extra_fake');
    assert.equal(call.form['line_items[1][quantity]'], undefined, 'metered prices take no quantity');
    assert.equal(call.form.client_reference_id, o.org.id);
    assert.equal(call.form['subscription_data[metadata][org_id]'], o.org.id);
    assert.equal(call.form.customer_email, 'owner@team.test');
    assert.match(call.form.success_url, new RegExp(`^http://127\\.0\\.0\\.1:\\d+/orgs/${o.org.id}/billing\\?checkout=success$`));
    assert.match(await (await web.get(`/orgs/${o.org.id}/billing?checkout=success`, owner.cookie)).text(), /Your plan changes as soon as Stripe confirms/);
  });

  test('webhook: unsigned, wrongly signed, stale and non-event bodies are refused', async () => {
    assert.equal((await send('checkout.session.completed', {}, { sign: false })).status, 400);
    assert.equal((await send('checkout.session.completed', {}, { t: nowSec() - 301 })).status, 400);
    const body = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: { mode: 'subscription', client_reference_id: o.org.id, payment_status: 'paid' } } });
    const forged = await fetch(`${srv.base}/webhooks/stripe`, { method: 'POST', body, headers: { 'stripe-signature': signStripePayload(body, 'whsec_attacker', nowSec()) } });
    assert.equal(forged.status, 400);
    assert.match((await forged.json()).error.message, /Invalid signature/);
    const notEvent = '[1,2]';
    const r = await fetch(`${srv.base}/webhooks/stripe`, { method: 'POST', body: notEvent, headers: { 'stripe-signature': signStripePayload(notEvent, WHSEC, nowSec()) } });
    assert.equal(r.status, 400);
    assert.equal((await fetch(`${srv.base}/webhooks/stripe`)).status, 405);
    assert.equal(account(), null, 'nothing was applied');
  });

  test('webhook: checkout.session.completed moves the org to Team; duplicates and live events are ignored', async () => {
    const session = { id: 'cs_test_1', object: 'checkout.session', mode: 'subscription', client_reference_id: o.org.id, customer: 'cus_test_1', subscription: 'sub_test_1', payment_status: 'paid', metadata: { org_id: o.org.id } };
    const live = await send('checkout.session.completed', session, { id: 'evt_live', livemode: true });
    assert.equal(live.status, 200);
    assert.match(live.json.note, /live event for a test key/);
    assert.equal(account(), null);

    const first = await send('checkout.session.completed', session, { id: 'evt_checkout' });
    assert.equal(first.status, 200);
    assert.deepEqual([account().plan, account().status, account().stripe_customer_id, account().stripe_subscription_id], ['team', 'active', 'cus_test_1', 'sub_test_1']);
    const again = await send('checkout.session.completed', session, { id: 'evt_checkout' });
    assert.equal(again.json.note, 'duplicate: already processed');
    const unknownOrg = await send('checkout.session.completed', { ...session, client_reference_id: 'org_ffffffffffffffff', metadata: {} });
    assert.equal(unknownOrg.json.note, 'ignored: no matching org');
    assert.equal((await send('payment_intent.succeeded', {})).json.note, 'ignored: payment_intent.succeeded is not handled');

    const page = await billingPage();
    assert.match(page, /<span class="badge good">Team<\/span>/);
    assert.match(page, /Manage billing/);
    assert.doesNotMatch(page, /Upgrade to Team/);
    const again2 = await web.post(`/orgs/${o.org.id}/billing/checkout`, owner.cookie, { csrf: owner.csrf });
    assert.equal(again2.status, 409);
    assert.match(await again2.text(), /already on Team/);

    const audit = await api(srv.base, 'GET', `/v1/orgs/${o.org.id}/audit_events`, { key: o.keys['owner@team.test'] });
    assert.ok(audit.json.data.some(e => e.action === 'billing.plan_change' && e.detail.to === 'team' && e.actor === 'system'));
  });

  test('Customer Portal: admins get a portal session for the org customer', async () => {
    const admin = await web.signIn('admin@team.test');
    const res = await web.post(`/orgs/${o.org.id}/billing/portal`, admin.cookie, { csrf: admin.csrf });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), 'https://billing.stripe.test/p/session/1');
    const call = stripe.calls.find(c => c.path === '/v1/billing_portal/sessions');
    assert.equal(call.form.customer, 'cus_test_1');
    assert.match(call.form.return_url, new RegExp(`/orgs/${o.org.id}/billing$`));
    const viewer = await web.signIn('view@team.test');
    assert.equal((await web.post(`/orgs/${o.org.id}/billing/portal`, viewer.cookie, { csrf: viewer.csrf })).status, 403);
    assert.equal((await web.get(`/orgs/${o.org.id}/billing`, viewer.cookie)).status, 403);
  });

  test('Team: 5 active deployments included; the 6th reports one meter event, reruns report nothing', async () => {
    const key = o.keys['eng@team.test'];
    for (let i = 1; i <= 7; i++) await addDeployment(srv, key, o.org.id, `bot-${i}`, target.url);
    for (let i = 1; i <= 6; i++) assert.equal((await run(srv, key, o.org.id, `bot-${i}`)).status, 201, `bot-${i}`);
    let meter = stripe.calls.filter(c => c.path === '/v1/billing/meter_events');
    assert.equal(meter.length, 1);
    assert.equal(meter[0].form.event_name, 'delomu_extra_active_deployment');
    assert.equal(meter[0].form['payload[stripe_customer_id]'], 'cus_test_1');
    assert.equal(meter[0].form['payload[value]'], '1');
    assert.match(meter[0].form.identifier, /^dlm_[0-9a-f]{40}$/);
    assert.equal(meter[0].idem, meter[0].form.identifier);
    assert.ok(Math.abs(Number(meter[0].form.timestamp) - nowSec()) < 120);

    await new Promise(r => setTimeout(r, 1100));
    assert.equal((await run(srv, key, o.org.id, 'bot-1')).status, 201);
    assert.equal((await run(srv, key, o.org.id, 'bot-6')).status, 201);
    assert.equal(stripe.calls.filter(c => c.path === '/v1/billing/meter_events').length, 1, 'reruns are not new extras');

    // A failed report is kept and retried when the Billing page is opened.
    stripe.state.failMeter = true;
    assert.equal((await run(srv, key, o.org.id, 'bot-7')).status, 201, 'a Stripe outage never fails the run');
    stripe.state.failMeter = false;
    const page = await billingPage();
    meter = stripe.calls.filter(c => c.path === '/v1/billing/meter_events');
    assert.equal(meter.length, 3, 'one failed attempt, then the retry');
    assert.equal(meter[1].form.identifier, meter[2].form.identifier);
    assert.match(page, /2 extra × \$99 = \$198 on the next invoice/);
    assert.match(page, /<span class="badge warn">Extra, billed<\/span>/);
    await billingPage();
    assert.equal(stripe.calls.filter(c => c.path === '/v1/billing/meter_events').length, 3, 'nothing left to send');
  });

  test('plan transitions: past_due keeps Team with a warning, older events are ignored, deletion returns to Free', async () => {
    const failed = await send('invoice.payment_failed', { id: 'in_test_1', object: 'invoice', customer: 'cus_test_1', attempt_count: 1 });
    assert.match(failed.json.note, /payment failed/);
    assert.equal(account().status, 'past_due');
    let page = await billingPage();
    assert.match(page, /Team · payment failed/);
    assert.match(page, /The last payment failed/);

    const past = await send('customer.subscription.updated', subscription('past_due'));
    assert.match(past.json.note, /subscription past_due/);
    assert.equal(account().plan, 'team');
    assert.equal(account().current_period_end, new Date(1_900_000_000 * 1000).toISOString());

    const stale = await send('customer.subscription.updated', subscription('canceled'), { when: 1_600_000_000 });
    assert.match(stale.json.note, /older than the last applied event/);
    assert.equal(account().plan, 'team');

    const other = await send('customer.subscription.deleted', subscription('canceled', { id: 'sub_old' }));
    assert.match(other.json.note, /another subscription/);
    assert.equal(account().plan, 'team');

    await send('customer.subscription.updated', subscription('active', { cancel_at_period_end: true }));
    assert.deepEqual([account().status, account().payment_failed_at, account().cancel_at_period_end], ['active', null, 1]);
    assert.match(await billingPage(), /Team ends on/);

    const unpaid = await send('customer.subscription.updated', subscription('unpaid'));
    assert.match(unpaid.json.note, /unpaid/);
    assert.equal(account().plan, 'free');
    await send('customer.subscription.updated', subscription('active'));
    assert.equal(account().plan, 'team');

    await send('customer.subscription.deleted', subscription('canceled'));
    assert.deepEqual([account().plan, account().status, account().stripe_subscription_id, account().stripe_customer_id], ['free', 'canceled', null, 'cus_test_1']);
    page = await billingPage();
    assert.match(page, /<span class="badge plain">Free<\/span>/);
    assert.match(page, /Upgrade to Team/);
    assert.match(page, /Manage billing/, 'past invoices stay reachable in the portal');

    // Back on Free with seven active deployments: an eighth is refused, the active ones still run.
    const key = o.keys['eng@team.test'];
    await addDeployment(srv, key, o.org.id, 'bot-8', target.url);
    assert.equal((await run(srv, key, o.org.id, 'bot-8')).status, 402);
    assert.equal((await run(srv, key, o.org.id, 'bot-2')).status, 201);
    // Re-subscribing goes through Checkout again and reuses the Stripe customer.
    const res = await web.post(`/orgs/${o.org.id}/billing/checkout`, owner.cookie, { csrf: owner.csrf });
    assert.equal(res.status, 303);
    const call = stripe.calls.filter(c => c.path === '/v1/checkout/sessions').at(-1);
    assert.equal(call.form.customer, 'cus_test_1');
    assert.equal(call.form.customer_email, undefined);
  });
});
