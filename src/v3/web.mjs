// The web UI: sign in (SSO or API key), home, deployments, the deployment workspace (overview, runs,
// draft review, customer material, settings), creating deployments, starting runs and agent drafts, and
// the audit page. Cookie sessions; every state-changing form POST checks a CSRF token. Authorization goes
// through the same operations.mjs checks as the JSON API.

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { appendAudit } from '../core/audit.mjs';
import { createLlm, isAuthError } from '../core/llm.mjs';
import { callTarget } from '../adapters.mjs';
import { parseCsv } from '../csv.mjs';
import { loadConfig } from '../deployment.mjs';
import { getLiveSettings, setLiveSettings } from '../v1/live.mjs';
import { accessibleOrgs, addMember, createOrg, getOrgBySlug } from './accounts.mjs';
import { tx } from './db.mjs';
import { createRateLimiter } from './ratelimit.mjs';
import { recordEvent, listEvents } from './events.mjs';
import { demoAnswer, sampleFiles } from './demo-bot.mjs';
import { ApiError, cookie, createRouter, notFound, parseCookies, readForm, readJson, send } from './http.mjs';
import { authenticateKey, createApiKey } from './keys.mjs';
import {
  auditPage, billingPage, BUSY_SCRIPT_HASH, deploymentOverviewPage, depPath, draftsPage, errorPage, homePage, inputsPage, loginPage,
  livePage, newDeploymentPage, orgPage, orgPath, riskScanPage, runsPage, settingsPage, signupKeyPage, signupPage,
} from './html.mjs';
import { overview } from './insights.mjs';
import { access, checkLiveConversation, deploymentAudits, deploymentFor, draftOf, event, reviewDeploymentDraft, startRun } from './operations.mjs';
import { principalAllows, roleIn } from './rbac.mjs';
import { createSession, deleteSession, getSession, randomToken, sameSecret, SESSION_COOKIE, SESSION_TTL_MS } from './sessions.mjs';
import { OidcError } from './oidc.mjs';
import { finishLogin, getOidcConfig, LOGIN_TTL_MS, startLogin, STATE_COOKIE } from './sso.mjs';
import { checkTarget, listDeployments, registerDeployment, reportFile } from './workspace.mjs';

const LOGIN_CSRF_COOKIE = 'delomu_login_csrf';
// The Delomu mark (assets/brand/delomu-mark.svg), dark on light tabs and light on dark ones.
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>path{fill:#0b0b14}@media (prefers-color-scheme:dark){path{fill:#fff}}</style><defs><mask id="m"><rect width="64" height="64" fill="#fff"/><path d="M14 66 L34 -2" style="fill:none" stroke="#000" stroke-width="5.5"/></mask></defs><path d="M8 6 H30 A26 26 0 0 1 30 58 H8 Z" mask="url(#m)"/></svg>';
const PAGE_CSP = `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; script-src '${BUSY_SCRIPT_HASH}'; frame-ancestors 'none'; base-uri 'none'`;
const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const INPUT_TYPES = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.html']);
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * MAX_INPUT_BYTES;
const REPLAY_LIMIT = 6;
const AGENT_TASKS = ['mapping', 'integration', 'cases', 'fixes', 'launch-report'];
const NOTICES = {
  created: 'Deployment created. Add the customer’s material next, then ask the agent to draft the first step.',
  ran: 'Test run finished.',
  scanned: 'Risk scan finished.',
  sample: 'Sample customer ready: Acme’s support bot and its refund policy. Run the risk scan to see what it gets wrong.',
  drafted: 'The agent drafted a proposal. Review it below.',
  uploaded: 'Files added.',
  checked: 'Conversation checked.',
  replayed: 'Sample traffic checked. Every conversation below was judged against the policy rules.',
  alerts: 'Alert settings saved.',
};

class Redirect {
  constructor(location, cookies = []) { this.location = location; this.cookies = cookies; }
}

const html = (body, status = 200, cookies = []) => ({ status, body, cookies });

function principalFromSession(ctx, req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const s = token && getSession(ctx.db, token, ctx.now());
  if (!s) return null;
  const user = ctx.db.prepare('SELECT email FROM users WHERE id = ?').get(s.userId);
  if (!user || !roleIn(ctx.db, { userId: s.userId, homeOrgId: s.orgId }, s.orgId)) return null;
  return { userId: s.userId, email: user.email, homeOrgId: s.orgId, scopes: s.scopes, csrf: s.csrf, token, actor: `human:${user.email}`, via: 'session', ip: ctx.clientIp(req) };
}

function requireCsrf(principalOrToken, form) {
  const expected = typeof principalOrToken === 'string' ? principalOrToken : principalOrToken?.csrf;
  if (!sameSecret(form.csrf, expected)) throw new ApiError('permission_error', 'This form has expired. Reload the page and try again.', { code: 'csrf' });
}

function redirectUri(ctx, req) {
  if (ctx.publicUrl) return `${ctx.publicUrl}/sso/callback`;
  const host = String(req.headers.host ?? '');
  if (!LOCAL_HOST.test(host)) throw new ApiError('api_error', 'Single sign-on needs DELOMU_PUBLIC_URL set on the server.');
  return `http://${host}/sso/callback`;
}

function signIn(ctx, req, { userId, orgId, scopes, apiKeyId, email, via }) {
  const { token } = createSession(ctx.db, { userId, orgId, scopes, apiKeyId }, ctx.now());
  recordEvent(ctx.db, { orgId, actor: `human:${email}`, action: 'user.login', target: email, detail: { via }, ip: ctx.clientIp(req) }, ctx.now());
  return new Redirect('/', [cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS / 1000, secure: ctx.secureCookies(req) })]);
}

// Reads a request body as raw bytes, for multipart uploads.
function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new ApiError('invalid_request_error', `Upload is larger than ${limit / MAX_INPUT_BYTES} MB.`, { status: 413 });
    if (Number(req.headers['content-length']) > limit) { req.resume(); reject(tooLarge()); return; }
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { req.removeAllListeners('data'); req.resume(); reject(tooLarge()); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// A file name the deployment's inputs/ folder can hold: no folders, safe characters, an allowed type.
export function cleanInputName(name) {
  const base = path.basename(String(name ?? '').replace(/\\/g, '/')).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 120);
  const ext = path.extname(base).toLowerCase();
  if (!base || !INPUT_TYPES.has(ext)) return null;
  return base;
}

function routes(ctx) {
  const r = createRouter();
  const { db } = ctx;

  // Sidebar data and the deployments a principal can see, with each one's progress.
  const orgsOf = principal => accessibleOrgs(db, principal, roleIn(db, principal, principal.homeOrgId));
  const deploymentsOf = org => listDeployments(db, ctx.deploymentsRoot, org.id).map(d => {
    const { dir } = deploymentFor(ctx, org.id, d.name);
    let config = {};
    try { config = loadConfig(dir); } catch { /* registered without a readable config; show what exists */ }
    return { org, name: d.name, customer: config.customer, config, ov: overview(dir, config) };
  });
  // Orgs where the principal may open Billing (owners and admins), for the sidebar link.
  const billingOrgsOf = (principal, orgs) => new Set(orgs.filter(o => principalAllows(principal, roleIn(db, principal, o.id), 'org:manage')).map(o => o.id));
  const navFor = (principal, extra = {}) => {
    const orgs = orgsOf(principal);
    const pending = orgs.flatMap(deploymentsOf).reduce((n, d) => n + d.ov.pending.length, 0);
    return { orgs, pending, billingOrgs: billingOrgsOf(principal, orgs), ...extra };
  };
  const base = principal => ({ user: principal, csrf: principal.csrf, now: ctx.now() });

  // Everything a deployment page needs, after checking the permission it requires.
  function workspace(principal, params, permission, url) {
    const { org, role } = access(ctx, principal, params.org, permission);
    const { dir } = deploymentFor(ctx, org.id, params.name);
    let config = {};
    try { config = loadConfig(dir); } catch { /* shown as not connected */ }
    const allow = p => principalAllows(principal, role, p);
    return {
      ...base(principal), org, name: params.name, dir, config, ov: overview(dir, config),
      nav: navFor(principal, { canAudit: allow('audit:read') }),
      can: { write: allow('deployments:write'), run: allow('runs:create'), review: allow('drafts:review') },
      flash: NOTICES[url?.searchParams.get('notice')] ?? '',
    };
  }

  r.add('GET', '/favicon.svg', () => ({ status: 200, body: FAVICON, type: 'image/svg+xml', headers: { 'cache-control': 'public, max-age=86400' } }), { public: true });

  r.add('GET', '/login', ({ req }) => {
    const token = randomToken();
    return html(loginPage({ csrf: token, signup: signupOpen }), 200, [cookie(LOGIN_CSRF_COOKIE, token, { maxAge: 3600, secure: ctx.secureCookies(req) })]);
  }, { public: true });

  // Self-serve sign-up, on when the operator sets DELOMU_SIGNUP=open: a new org on the Free plan, its
  // owner, and a sign-in key shown once. Limited per client address so it cannot be used to mass-create orgs.
  const signupOpen = ctx.env?.DELOMU_SIGNUP === 'open';
  const signupLimit = createRateLimiter({ capacity: 5, refillPerSec: 1 / 600 });
  r.add('GET', '/signup', ({ req }) => {
    if (!signupOpen) return new Redirect('/login');
    const token = randomToken();
    return html(signupPage({ csrf: token }), 200, [cookie(LOGIN_CSRF_COOKIE, token, { maxAge: 3600, secure: ctx.secureCookies(req) })]);
  }, { public: true });

  r.add('POST', '/signup', async ({ req }) => {
    if (!signupOpen) throw notFound('page');
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(parseCookies(req.headers.cookie)[LOGIN_CSRF_COOKIE] ?? '', form);
    const values = { email: String(form.email ?? '').trim().toLowerCase(), company: String(form.company ?? '').trim() };
    const fail = (error, status = 400) => html(signupPage({ csrf: form.csrf, error, values }), status);
    if (!signupLimit(ctx.clientIp(req)).ok) return fail('Too many sign-ups from this network. Try again later.', 429);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) return fail('Enter a work email address.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(values.email)) return fail('That email already has an account. Sign in with your key, or ask your admin to add you.', 409);
    let made;
    try {
      made = tx(db, () => {
        const org = createOrg(db, { name: values.company, kind: 'customer' }, ctx.now());
        const member = addMember(db, org.id, { email: values.email, role: 'owner' }, null, ctx.now());
        const { key, secret } = createApiKey(db, { orgId: org.id, userId: member.user_id, name: 'sign-in key' }, ctx.pepper, ctx.now());
        recordEvent(db, { orgId: org.id, actor: `human:${values.email}`, action: 'org.signup', target: org.id, detail: { key: key.prefix }, ip: ctx.clientIp(req) }, ctx.now());
        return { org, member, key, secret };
      });
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) return fail(e.message);
      throw e;
    }
    const session = signIn(ctx, req, { userId: made.member.user_id, orgId: made.org.id, scopes: null, apiKeyId: made.key.id, email: values.email, via: 'signup' });
    return html(signupKeyPage({ secret: made.secret, email: values.email }), 201, session.cookies);
  }, { public: true });

  r.add('POST', '/login', async ({ req }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(parseCookies(req.headers.cookie)[LOGIN_CSRF_COOKIE] ?? '', form);
    const key = authenticateKey(db, String(form.api_key ?? '').trim(), ctx.pepper, ctx.now());
    if (!key) return html(loginPage({ csrf: form.csrf, error: 'That API key is not valid or was revoked.' }), 401);
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(key.user_id);
    return signIn(ctx, req, { userId: key.user_id, orgId: key.org_id, scopes: key.scopes, apiKeyId: key.id, email: user.email, via: `api_key:${key.prefix}` });
  }, { public: true });

  r.add('GET', '/sso/start', async ({ req, url }) => {
    const org = getOrgBySlug(db, url.searchParams.get('org')?.trim().toLowerCase() ?? '');
    // Same answer for an unknown slug and an org without SSO, so the form does not reveal which orgs exist.
    const noSso = () => html(loginPage({ csrf: '', error: 'No organization with that name uses single sign-on.' }), 404);
    if (!org || !getOidcConfig(db, org.id)) return noSso();
    let target;
    let state;
    try {
      ({ url: target, state } = await startLogin(db, ctx.oidc, { orgId: org.id, redirectUri: redirectUri(ctx, req) }, ctx.now()));
    } catch (e) {
      if (!(e instanceof OidcError)) throw e;
      recordEvent(db, { orgId: org.id, actor: 'system', action: 'user.login_failed', detail: { via: 'sso', reason: e.message }, ip: ctx.clientIp(req) }, ctx.now());
      return html(errorPage({ status: 502, message: `Single sign-on is unavailable: ${e.message}.` }), 502);
    }
    return new Redirect(target, [cookie(STATE_COOKIE, state, { maxAge: LOGIN_TTL_MS / 1000, secure: ctx.secureCookies(req), path: '/sso' })]);
  }, { public: true });

  r.add('GET', '/sso/callback', async ({ req, url }) => {
    const q = url.searchParams;
    const clearState = cookie(STATE_COOKIE, '', { maxAge: 0, path: '/sso' });
    if (q.get('error')) return html(errorPage({ status: 400, message: `The identity provider refused the sign-in (${q.get('error')}).` }), 400, [clearState]);
    if (!sameSecret(q.get('state'), parseCookies(req.headers.cookie)[STATE_COOKIE])) {
      return html(errorPage({ status: 400, message: 'This sign-in was started in another browser or has expired. Start again.' }), 400, [clearState]);
    }
    let result;
    try {
      result = await finishLogin(db, ctx.oidc, { state: q.get('state'), code: q.get('code'), redirectUri: redirectUri(ctx, req), env: ctx.env }, ctx.now());
    } catch (e) {
      if (e.orgId) recordEvent(db, { orgId: e.orgId, actor: 'system', action: 'user.login_failed', detail: { via: 'sso', reason: e.message }, ip: ctx.clientIp(req) }, ctx.now());
      return html(errorPage({ status: 400, message: `Single sign-on failed: ${e.message}.` }), 400, [clearState]);
    }
    const { orgId, user, member, created } = result;
    if (created) recordEvent(db, { orgId, actor: 'system', action: 'member.add', target: user.email, detail: { role: member.role, via: 'sso-jit' } }, ctx.now());
    const out = signIn(ctx, req, { userId: user.id, orgId, scopes: null, email: user.email, via: 'sso' });
    out.cookies.push(clearState);
    return out;
  }, { public: true });

  r.add('POST', '/logout', async ({ req, principal }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    deleteSession(db, principal.token);
    event(ctx, principal, principal.homeOrgId, 'user.logout', principal.email);
    return new Redirect('/login', [cookie(SESSION_COOKIE, '', { maxAge: 0 })]);
  });

  r.add('GET', '/', ({ principal }) => {
    const orgs = orgsOf(principal);
    const deployments = orgs.flatMap(org => {
      const role = roleIn(db, principal, org.id);
      return principalAllows(principal, role, 'deployments:read') ? deploymentsOf(org) : [];
    });
    const review = deployments.flatMap(d => d.ov.pending.map(draft => ({ org: d.org, name: d.name, draft })))
      .sort((a, b) => a.draft.createdAt.localeCompare(b.draft.createdAt));
    const homeRole = roleIn(db, principal, principal.homeOrgId);
    const nav = { orgs, pending: review.length, canAudit: principalAllows(principal, homeRole, 'audit:read'), billingOrgs: billingOrgsOf(principal, orgs), org: orgs.length === 1 ? orgs[0] : undefined };
    return html(homePage({ ...base(principal), nav, deployments, review, canWrite: principalAllows(principal, homeRole, 'deployments:write') }));
  });

  r.add('GET', '/orgs/:org', ({ principal, params, url }) => {
    const { org, role } = access(ctx, principal, params.org, 'deployments:read');
    return html(orgPage({
      ...base(principal), org, deployments: deploymentsOf(org), nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }),
      canWrite: principalAllows(principal, role, 'deployments:write'), notice: NOTICES[url.searchParams.get('notice')],
    }));
  });

  // The sample customer's support bot (see demo-bot.mjs). Public, like any customer endpoint, and canned.
  r.add('POST', '/demo/support-bot', async ({ req }) => {
    const body = await readJson(req, 16 * 1024).catch(() => ({}));
    return { status: 200, body: JSON.stringify({ reply: demoAnswer(body?.body?.message) }), type: 'application/json' };
  }, { public: true });

  // One click to a deployment that can be scanned right away: Acme's bot, its policy and its test cases.
  r.add('POST', '/orgs/:org/sample', async ({ req, principal, params }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const taken = new Set(listDeployments(db, ctx.deploymentsRoot, org.id).map(d => d.name));
    let name = 'sample-acme';
    for (let n = 2; taken.has(name); n++) name = `sample-acme-${n}`;
    const origin = ctx.publicUrl ?? `http://${String(req.headers.host ?? '127.0.0.1')}`;
    const { cases, inputs } = sampleFiles();
    const config = {
      customer: 'Acme (sample)', name, target: { type: 'http', url: `${origin}/demo/support-bot`, body: { message: '{{input}}' }, output: 'reply' },
      acceptance: { minPassRate: 0.9 }, decisions: [{ date: ctx.now().toISOString().slice(0, 10), decision: 'Accept at a 90% pass rate', reason: 'Sample customer.' }],
    };
    registerDeployment(db, ctx.deploymentsRoot, org.id, { name, config, cases }, { actor: principal.actor, policy: ctx.policy }, ctx.now());
    const { dir } = deploymentFor(ctx, org.id, name);
    fs.mkdirSync(path.join(dir, 'inputs'), { recursive: true });
    for (const f of inputs) fs.writeFileSync(path.join(dir, 'inputs', f.name), f.text);
    event(ctx, principal, org.id, 'deployment.register', name, { via_web: true, sample: true });
    return new Redirect(`${depPath(org, name)}/scan?notice=sample`);
  });

  const newDeploymentView = (principal, params, error, values) => {
    const { org, role } = access(ctx, principal, params.org, 'deployments:write');
    return newDeploymentPage({ ...base(principal), org, error, values, nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }) });
  };

  r.add('GET', '/orgs/:org/new-deployment', ({ principal, params }) => html(newDeploymentView(principal, params)));

  r.add('POST', '/orgs/:org/new-deployment', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const fail = message => html(newDeploymentView(principal, params, message, form), 400);
    const pass = Number(form.pass || 90);
    if (!(pass > 0 && pass <= 100)) return fail('Required pass rate must be between 1 and 100.');
    let target;
    const field = k => String(form[k] ?? '').trim();
    if (form.type === 'command') {
      if (!field('command')) return fail('Enter the command that runs the customer’s AI.');
      target = { type: 'command', command: field('command') };
    } else if (form.type === 'intercom') {
      if (!field('intercom_token')) return fail('Enter the environment variable that holds the Intercom access token, for example ${CUSTOMER_INTERCOM_TOKEN}.');
      target = { type: 'intercom', token: field('intercom_token') };
      if (field('intercom_contact')) target.contactExternalId = field('intercom_contact');
    } else if (form.type === 'zendesk') {
      if (!field('zendesk_subdomain')) return fail('Enter the Zendesk subdomain, the part before .zendesk.com.');
      if (!field('zendesk_app_id')) return fail('Enter the Sunshine Conversations app ID.');
      if (!field('zendesk_key_id') || !field('zendesk_secret')) return fail('Enter the environment variables that hold the Zendesk API key ID and secret.');
      target = { type: 'zendesk', subdomain: field('zendesk_subdomain').replace(/\.zendesk\.com$/i, ''), appId: field('zendesk_app_id'), keyId: field('zendesk_key_id'), secret: field('zendesk_secret') };
    } else {
      if (!/^https?:\/\//i.test(String(form.url ?? ''))) return fail('Enter the full endpoint URL, starting with https://.');
      target = { type: 'http', url: String(form.url).trim(), body: { message: '{{input}}' } };
      if (String(form.auth ?? '').trim()) target.headers = { authorization: String(form.auth).trim() };
      if (String(form.output ?? '').trim()) target.output = String(form.output).trim();
    }
    const config = { customer: String(form.customer ?? '').trim() || undefined, name: String(form.name ?? ''), target, acceptance: { minPassRate: pass / 100 }, decisions: [] };
    try {
      const d = registerDeployment(db, ctx.deploymentsRoot, org.id, { name: String(form.name ?? ''), config }, { actor: principal.actor, policy: ctx.policy }, ctx.now());
      event(ctx, principal, org.id, 'deployment.register', d.name, { via_web: true });
      return new Redirect(`${depPath(org, d.name)}?notice=created`);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
      return fail(e.message);
    }
  });

  const showOverview = (principal, params, url, error, status = 200, upgrade) => html(deploymentOverviewPage({ ...workspace(principal, params, 'runs:read', url), error, upgrade }), status);

  r.add('GET', '/orgs/:org/deployments/:name', ({ principal, params, url }) => showOverview(principal, params, url));
  // Risk scans run in the background (about a minute); the scan page shows live progress and refreshes.
  const scans = new Map();
  r.add('GET', '/orgs/:org/deployments/:name/scan', ({ principal, params, url }) => {
    const ws = workspace(principal, params, 'runs:read', url);
    const job = scans.get(ws.dir);
    if (job?.status === 'running') return html(riskScanPage({ ...ws, job }));
    if (job) scans.delete(ws.dir);
    if (job?.status === 'failed') return html(riskScanPage({ ...ws, flash: '', error: job.error }));
    return html(riskScanPage(job?.status === 'done' ? { ...ws, flash: NOTICES.scanned } : ws));
  });

  r.add('POST', '/orgs/:org/deployments/:name/scan', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const fail = (message, status = 400, upgrade) => html(riskScanPage({ ...workspace(principal, params, 'runs:read'), error: message, upgrade }), status);
    try {
      checkTarget(loadConfig(dir), ctx.policy);
    } catch (e) {
      return fail(e instanceof ApiError ? e.message : 'The deployment is not connected to an AI yet.');
    }
    const { riskScan } = await import('../v1/risk.mjs');
    const page = `${depPath(org, params.name)}/scan`;
    if (scans.get(dir)?.status === 'running') return new Redirect(page);
    // Plan limits: a completed scan counts toward the month (the scan.create event below).
    let release;
    try {
      release = ctx.billing.reserveScan(org.id);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      return fail(e.message, e.status, e.extra?.upgrade_url);
    }
    const job = { status: 'running', startedAt: ctx.now().getTime(), progress: { phase: 'rules' } };
    scans.set(dir, job);
    job.done = riskScan(dir, { llm: ctx.llm ?? createLlm(), onProgress: p => { job.progress = p; } }).then(result => {
      if (!result.ok) Object.assign(job, { status: 'failed', error: `The scan found nothing to test: ${result.reason}` });
      else {
        event(ctx, principal, org.id, 'scan.create', `${params.name}/${result.scan.id}`, { broken: result.scan.summary.broken, rules: result.scan.summary.rules });
        job.status = 'done';
      }
    }, e => Object.assign(job, { status: 'failed', error: isAuthError(e)
      ? 'The agent has no model credentials on this server. Set ANTHROPIC_API_KEY or MODEL_API_KEY and restart.'
      : `The scan could not finish: ${String(e.message).split(dir).join(params.name)}` })).finally(() => release());
    return new Redirect(page);
  });

  // Live monitoring. The page shows the last 7 days; "Send sample traffic" replays the customer's ticket
  // export through their AI in the background so a new deployment has something to watch.
  const replays = new Map();
  const liveView = (req, principal, params, url, extra = {}) => {
    const ws = workspace(principal, params, 'runs:read', url);
    const job = replays.get(ws.dir);
    if (job && job.status !== 'running') replays.delete(ws.dir);
    return livePage({ ...ws, can: { ...ws.can, live: principalAllows(principal, roleIn(db, principal, ws.org.id), 'conversations:write') },
      settings: getLiveSettings(ws.dir), apiBase: `${ctx.publicUrl ?? `http://${req.headers.host}`}/v1/orgs/${ws.org.id}/deployments/${encodeURIComponent(params.name)}`,
      job: job?.status === 'running' ? job : null, error: job?.status === 'failed' ? job.error : undefined,
      flash: job?.status === 'done' ? NOTICES.replayed : ws.flash, ...extra });
  };
  r.add('GET', '/orgs/:org/deployments/:name/live', ({ req, principal, params, url }) => html(liveView(req, principal, params, url)));

  r.add('POST', '/orgs/:org/deployments/:name/live/check', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'conversations:write');
    try {
      await checkLiveConversation(ctx, principal, org.id, params.name, { message: form.message, answer: form.answer, source: 'web' });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 404) throw e;
      return html(liveView(req, principal, params, null, { error: e.message, upgrade: e.extra?.upgrade_url, draft: { message: form.message, answer: form.answer } }), e.status);
    }
    return new Redirect(`${depPath(org, params.name)}/live?notice=checked`);
  });

  r.add('POST', '/orgs/:org/deployments/:name/live/replay', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'conversations:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const page = `${depPath(org, params.name)}/live`;
    const fail = message => html(liveView(req, principal, params, null, { error: message }), 400);
    if (replays.get(dir)?.status === 'running') return new Redirect(page);
    const file = path.join(dir, 'inputs', 'tickets.csv');
    const rows = fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
    const messages = rows.map(r => r.customer_message ?? r.message ?? r.input).filter(m => String(m ?? '').trim()).slice(0, REPLAY_LIMIT);
    if (!messages.length) return fail('Add the customer’s ticket export (tickets.csv with a customer_message column) under Customer material first.');
    let config;
    try { config = loadConfig(dir); checkTarget(config, ctx.policy); } catch (e) { return fail(e instanceof ApiError ? e.message : 'The deployment is not connected to an AI yet.'); }
    const job = { status: 'running', startedAt: ctx.now().getTime(), done: 0, total: messages.length };
    replays.set(dir, job);
    (async () => {
      for (const message of messages) {
        const answer = await callTarget(config.target, message, { cwd: dir });
        await checkLiveConversation(ctx, principal, org.id, params.name, { message, answer, source: 'sample' });
        job.done++;
      }
    })().then(() => { job.status = 'done'; }, e => Object.assign(job, { status: 'failed', error: e instanceof ApiError ? e.message : `Sample traffic stopped: ${String(e.message).split(dir).join(params.name)}` }));
    return new Redirect(page);
  });

  r.add('POST', '/orgs/:org/deployments/:name/live/settings', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    try {
      setLiveSettings(dir, { webhook: form.webhook });
    } catch (e) {
      return html(liveView(req, principal, params, null, { error: e.message }), 400);
    }
    event(ctx, principal, org.id, 'live.settings', params.name, { webhook: form.webhook ? 'set' : 'cleared' });
    return new Redirect(`${depPath(org, params.name)}/live?notice=alerts`);
  });

  r.add('GET', '/orgs/:org/deployments/:name/runs', ({ principal, params, url }) => html(runsPage(workspace(principal, params, 'runs:read', url))));
  r.add('GET', '/orgs/:org/deployments/:name/inputs', ({ principal, params, url }) => html(inputsPage(workspace(principal, params, 'deployments:read', url))));
  r.add('GET', '/orgs/:org/deployments/:name/settings', ({ principal, params, url }) => html(settingsPage(workspace(principal, params, 'deployments:read', url))));

  r.add('GET', '/orgs/:org/deployments/:name/runs/:run/report.html', ({ principal, params }) => {
    const { org } = access(ctx, principal, params.org, 'runs:read');
    const file = reportFile(deploymentFor(ctx, org.id, params.name).dir, params.run);
    if (!file) throw notFound('run');
    return { status: 200, body: fs.readFileSync(file, 'utf8'), csp: REPORT_CSP };
  });

  r.add('POST', '/orgs/:org/deployments/:name/run', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'runs:create');
    try {
      await startRun(ctx, principal, org.id, params.name, { judge: form.judge === '1' });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500 || e.status === 404) throw e;
      return showOverview(principal, params, null, e.message, e.status, e.extra?.upgrade_url);
    }
    return new Redirect(`${depPath(org, params.name)}?notice=ran`);
  });

  r.add('POST', '/orgs/:org/deployments/:name/agent', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    if (!AGENT_TASKS.includes(form.task)) return showOverview(principal, params, null, 'Choose what the agent should draft.', 400);
    const { TASKS } = await import('../v1/agent.mjs');
    let result;
    try {
      result = await TASKS[form.task](dir, { llm: ctx.llm ?? createLlm() });
    } catch (e) {
      const message = isAuthError(e)
        ? 'The agent has no model credentials on this server. Set ANTHROPIC_API_KEY or MODEL_API_KEY and restart.'
        : `The agent could not finish: ${String(e.message).split(dir).join(params.name)}`;
      return showOverview(principal, params, null, message, 400);
    }
    if (!result.ok) return showOverview(principal, params, null, `The agent drafted nothing: ${result.reason}`, 400);
    event(ctx, principal, org.id, 'agent.draft', `${params.name}/${form.task}`, { drafts: result.drafts.map(d => d.id) });
    return new Redirect(`${depPath(org, params.name)}/drafts?notice=drafted`);
  });

  r.add('POST', '/orgs/:org/deployments/:name/inputs', async ({ req, principal, params }) => {
    const type = String(req.headers['content-type'] ?? '');
    if (!type.startsWith('multipart/form-data')) throw new ApiError('invalid_request_error', 'Expected a file upload.');
    const form = await new Response(await readRaw(req, MAX_UPLOAD_BYTES), { headers: { 'content-type': type } }).formData();
    requireCsrf(principal, { csrf: form.get('csrf') });
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const files = form.getAll('files').filter(f => typeof f === 'object' && f.size > 0);
    const fail = message => html(inputsPage({ ...workspace(principal, params, 'deployments:read'), error: message }), 400);
    if (!files.length) return fail('Choose at least one file.');
    const ready = [];
    for (const f of files) {
      const name = cleanInputName(f.name);
      if (!name) return fail(`${f.name} is not a supported type. Use Markdown, text, CSV, JSON, YAML or HTML.`);
      if (f.size > MAX_INPUT_BYTES) return fail(`${f.name} is larger than 1 MB.`);
      ready.push({ name, bytes: Buffer.from(await f.arrayBuffer()) });
    }
    const inputs = path.join(dir, 'inputs');
    fs.mkdirSync(inputs, { recursive: true });
    for (const { name, bytes } of ready) {
      fs.writeFileSync(path.join(inputs, name), bytes);
      appendAudit(dir, { actor: principal.actor, action: 'input.upload', target: name, detail: { bytes: bytes.length } }, ctx.now());
    }
    event(ctx, principal, org.id, 'input.upload', params.name, { files: ready.map(f => f.name) });
    return new Redirect(`${depPath(org, params.name)}/inputs?notice=uploaded`);
  });

  const draftsView = (principal, params, url, error) => draftsPage({ ...workspace(principal, params, 'drafts:read', url), error });

  r.add('GET', '/orgs/:org/deployments/:name/drafts', ({ principal, params, url }) => html(draftsView(principal, params, url)));

  r.add('POST', '/orgs/:org/deployments/:name/drafts/:draft/review', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'drafts:review');
    let content;
    if (form.decision === 'approve' && typeof form.content === 'string') {
      try {
        content = JSON.parse(form.content);
      } catch {
        return html(draftsView(principal, params, null, 'The edited content is not valid JSON; nothing was changed.'), 400);
      }
      // The form always posts the textarea; only a real change counts as a human edit in the audit trail.
      if (isDeepStrictEqual(content, draftOf(ctx, org.id, params.name, params.draft).content)) content = undefined;
    }
    try {
      await reviewDeploymentDraft(ctx, principal, org.id, params.name, params.draft, { decision: form.decision, note: form.note ?? '', content });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500 || e.status === 404) throw e;
      return html(draftsView(principal, params, null, e.message), e.status);
    }
    return new Redirect(`${depPath(org, params.name)}/drafts`);
  });

  // Billing: owners and admins only (org:manage). Stripe hosts the payment pages; this server never sees a card.
  const returnBase = req => {
    if (ctx.publicUrl) return ctx.publicUrl;
    const host = String(req.headers.host ?? '');
    if (!LOCAL_HOST.test(host)) throw new ApiError('api_error', 'Billing needs DELOMU_PUBLIC_URL set on the server, so Stripe knows where to send people back.');
    return `http://${host}`;
  };
  const BILLING_NOTICES = { success: 'Thanks. Your plan changes as soon as Stripe confirms the payment, usually within a few seconds.', cancelled: '' };

  const showBilling = (principal, params, url, error, status = 200) => {
    const { org } = access(ctx, principal, params.org, 'org:manage');
    const role = roleIn(db, principal, org.id);
    return html(billingPage({
      ...base(principal), org, billing: ctx.billing.summary(org.id), salesContact: ctx.env.DELOMU_SALES_CONTACT ?? '',
      nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }),
      flash: BILLING_NOTICES[url?.searchParams.get('checkout')] ?? '', error,
    }), status);
  };

  r.add('GET', '/orgs/:org/billing', async ({ principal, params, url }) => {
    const { org } = access(ctx, principal, params.org, 'org:manage');
    await ctx.billing.flushUsage(org.id); // retry meter events that failed earlier
    return showBilling(principal, params, url);
  });

  for (const [action, start] of [['checkout', (org, principal, req) => ctx.billing.createCheckout(org, { email: principal.email, returnBase: returnBase(req) })],
    ['portal', (org, principal, req) => ctx.billing.createPortal(org, { returnBase: returnBase(req) })]]) {
    r.add('POST', `/orgs/:org/billing/${action}`, async ({ req, principal, params }) => {
      const form = await readForm(req, ctx.maxBodyBytes);
      requireCsrf(principal, form);
      const { org } = access(ctx, principal, params.org, 'org:manage');
      let target;
      try {
        target = await start(org, principal, req);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status === 404) throw e;
        return showBilling(principal, params, null, e.message, e.status);
      }
      event(ctx, principal, org.id, `billing.${action}`, org.id);
      return new Redirect(target);
    });
  }

  r.add('GET', '/orgs/:org/audit', ({ principal, params, url }) => {
    const { org } = access(ctx, principal, params.org, 'audit:read');
    const events = listEvents(db, org.id, new URLSearchParams({ limit: '100', ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor') } : {}) })).data;
    return html(auditPage({ ...base(principal), org, events, audits: deploymentAudits(ctx, org.id), nav: navFor(principal, { canAudit: true }) }));
  });

  return { router: r, navFor };
}

// Returns a handler for non-/v1 paths, or answers 404 itself.
export function createWebHandler(ctx) {
  const { router, navFor } = routes(ctx);

  return async function handleWeb(req, res, url) {
    let principal = null;
    try {
      const found = router.match(req.method, url.pathname);
      if (!found) throw notFound('page');
      if (found.allowed) throw new ApiError('invalid_request_error', 'Method not allowed.', { status: 405, headers: { allow: found.allowed.join(', ') } });
      principal = principalFromSession(ctx, req);
      if (!principal && !found.options?.public) {
        if (req.method === 'GET') return respond(res, new Redirect('/login'));
        throw new ApiError('authentication_error', 'Your session has ended. Sign in again.');
      }
      respond(res, await found.handler({ req, url, principal, params: found.params }));
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('api_error', 'Something went wrong on the server.');
      if (!(e instanceof ApiError)) ctx.log(`unexpected error: ${e.stack ?? e}`);
      let nav;
      try { nav = principal ? navFor(principal) : undefined; } catch { nav = undefined; }
      respond(res, { status: err.status, body: errorPage({ status: err.status, message: err.message, user: principal, csrf: principal?.csrf, nav }), headers: err.headers });
    }
  };
}

function respond(res, out) {
  const headers = { 'set-cookie': out.cookies ?? [] };
  if (out instanceof Redirect) {
    send(res, 303, '', { ...headers, location: out.location });
    return;
  }
  send(res, out.status, out.body, { ...headers, ...out.headers, 'content-type': out.type ?? 'text/html; charset=utf-8', 'content-security-policy': out.csp ?? PAGE_CSP });
}
