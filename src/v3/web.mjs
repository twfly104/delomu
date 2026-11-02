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
import { hoursByStep, loadConfig, logHours, STEPS as HOUR_STEPS } from '../deployment.mjs';
import { deploymentMetrics } from './metrics.mjs';
import { getLiveSettings, setLiveSettings } from '../v1/live.mjs';
import { getScan, listScans, recheck } from '../v1/risk.mjs';
import { PLANS as PLAN_LIST } from './billing.mjs';
import { policyFingerprint } from '../v1/policies.mjs';
import { AGENT_KINDS } from '../v1/kinds.mjs';
import { approveFix, draftFix, getFix, instructionsTarget, revertFix } from '../v1/fix.mjs';
import { renderScanReport } from './scan-report.mjs';
import { buildEvidence, evidenceRange, renderEvidence } from './evidence.mjs';
import { accessibleOrgs, addMember, createOrg, getOrg, getOrgBySlug } from './accounts.mjs';
import { activeShares, createShare, findShare, revokeShares } from './shares.mjs';
import { latestSignoff, recordSignoff, signoffPage, signoffs } from './signoff.mjs';
import { verifiedFacts, verifiedPage } from './verified.mjs';
import { saveSecret, savedSecrets } from './secrets.mjs';
import { tx } from './db.mjs';
import { createRateLimiter } from './ratelimit.mjs';
import { recordEvent, listEvents } from './events.mjs';
import { aiAnswer, demoAnswer, sampleFiles } from './demo-bot.mjs';
import { storeAgentAnswer, storeAgentScripted, storeSampleFiles } from './sample-agent.mjs';
import { ApiError, cookie, createRouter, notFound, parseCookies, readForm, readJson, send } from './http.mjs';
import { authenticateKey, createApiKey } from './keys.mjs';
import {
  auditPage, billingPage, BUSY_SCRIPT_HASH, clientsPage, landingPage, deploymentOverviewPage, depPath, draftsPage, errorPage, homePage, inputsPage, loginPage,
  livePage, metricsPage, newDeploymentPage, orgPage, orgPath, riskScanPage, rolloutPage, runsPage, settingsPage, signupKeyPage, signupPage,
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
// The UI typeface (Geist, OFL; src/v3/fonts/OFL.txt), served from this server so pages make no third-party calls.
// What a person sees when a check fails. Problems with Delomu's own model are ours to fix, so the page says
// so plainly and the details go to the server log; anything else (usually the customer's AI) is shown as is.
function scanError(e, dir, name) {
  const detail = String(e?.message ?? e).split(dir).join(name);
  if (isAuthError(e) || /^(Meta Model API|Anthropic|no Meta Model API key)/i.test(detail) || e?.status >= 500) {
    console.error(`check failed for ${name}: ${detail}`);
    return 'The check could not run because Delomu\u2019s AI model is unavailable right now. It did not count toward your plan. Try again in a few minutes; if it keeps happening, contact support.';
  }
  return `The check could not finish: ${detail}`;
}

const FONTS = Object.fromEntries(['Geist-Variable.woff2', 'GeistMono-Variable.woff2'].map(f => [f, fs.readFileSync(new URL(`./fonts/${f}`, import.meta.url))]));
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>path{fill:#0b0b14}@media (prefers-color-scheme:dark){path{fill:#fff}}</style><defs><mask id="m"><rect width="64" height="64" fill="#fff"/><path d="M14 66 L34 -2" style="fill:none" stroke="#000" stroke-width="5.5"/></mask></defs><path d="M8 6 H30 A26 26 0 0 1 30 58 H8 Z" mask="url(#m)"/></svg>';
const PAGE_CSP = `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; script-src '${BUSY_SCRIPT_HASH}'; frame-ancestors 'none'; base-uri 'none'`;
const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const INPUT_TYPES = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.html']);
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * MAX_INPUT_BYTES;
const REPLAY_LIMIT = 6;
const AGENT_TASKS = ['mapping', 'integration', 'cases', 'fixes', 'launch-report'];
// What one click on Run the rollout does, in order. Fixes and the launch report follow a test run, so they come later.
const ROLLOUT_STEPS = [['mapping', 'Draft the data mapping'], ['integration', 'Draft the integration'], ['cases', 'Draft the test set'], ['check', 'Run the policy check']];
const NOTICES = {
  created: 'AI agent added. Add your policies next, then run the check.',
  ran: 'Test run finished.',
  scanned: 'Check finished.',
  rechecked: 'Re-check finished: the same messages were sent again.',
  fixdrafted: 'The agent drafted a fix. Review the instructions below, edit them if you like, then approve.',
  client: 'Client workspace ready. Connect the AI you deploy for this client, or try the sample bot first.',
  sample: 'Sample ready: Tallyfox’s support assistant and its billing policy. Run the check to see which rules it breaks.',
  drafted: 'The agent drafted a proposal. Review it below.',
  uploaded: 'Files added.',
  policychange: 'Your policies changed, so the check is running again on the new wording.',
  policystale: 'Files added. Your policies changed since the last check; run the check again when you can.',
  checked: 'Conversation checked.',
  replayed: 'Sample traffic checked. Every conversation below was judged against the policy rules.',
  alerts: 'Alert settings saved.',
  hours: 'Hours logged. They count toward Deployment metrics.',
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
    const hours = Object.values(hoursByStep(dir)).reduce((a, b) => a + b, 0);
    return { org, name: d.name, dir, customer: config.customer, config, ov: overview(dir, config), hours, signoff: latestSignoff(dir) };
  });
  // Orgs where the principal may open Billing (owners and admins), for the sidebar link.
  // A client workspace is billed to its vendor, so Billing shows on the vendor's org only.
  const billingOrgsOf = (principal, orgs) => new Set(orgs.filter(o => !o.partner_org_id && principalAllows(principal, roleIn(db, principal, o.id), 'org:manage')).map(o => o.id));
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
      can: { write: allow('deployments:write'), run: allow('runs:create'), review: allow('drafts:review'), manage: allow('org:manage') },
      flash: NOTICES[url?.searchParams.get('notice')] ?? '',
      checking: scans.get(dir)?.status === 'running',
    };
  }

  r.add('GET', '/favicon.svg', () => ({ status: 200, body: FAVICON, type: 'image/svg+xml', headers: { 'cache-control': 'public, max-age=86400' } }), { public: true });

  r.add('GET', '/fonts/:file', ({ params }) => {
    const body = FONTS[params.file];
    if (!body) throw notFound('font');
    return { status: 200, body, type: 'font/woff2', headers: { 'cache-control': 'public, max-age=31536000, immutable' } };
  }, { public: true });

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
    const values = { email: String(form.email ?? '').trim().toLowerCase(), company: String(form.company ?? '').trim(), kind: form.kind === 'vendor' ? 'vendor' : 'company' };
    const fail = (error, status = 400) => html(signupPage({ csrf: form.csrf, error, values }), status);
    if (!signupLimit(ctx.clientIp(req)).ok) return fail('Too many sign-ups from this network. Try again later.', 429);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) return fail('Enter a work email address.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(values.email)) return fail('That email already has an account. Sign in with your key, or ask your admin to add you.', 409);
    let made;
    try {
      made = tx(db, () => {
        // An AI vendor signs up as a partner org: its clients each get a workspace of their own under it.
        const org = createOrg(db, { name: values.company, kind: values.kind === 'vendor' ? 'partner' : 'customer' }, ctx.now());
        const member = addMember(db, org.id, { email: values.email, role: 'owner' }, null, ctx.now());
        const { key, secret } = createApiKey(db, { orgId: org.id, userId: member.user_id, name: 'sign-in key' }, ctx.pepper, ctx.now());
        recordEvent(db, { orgId: org.id, actor: `human:${values.email}`, action: 'org.signup', target: org.id, detail: { key: key.prefix, kind: values.kind }, ip: ctx.clientIp(req) }, ctx.now());
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
    // A signed-out visitor gets the public page; everyone else their home.
    if (!principal) return html(landingPage({ signup: signupOpen, plans: PLAN_LIST }));
    const orgs = orgsOf(principal);
    const deployments = orgs.flatMap(org => {
      const role = roleIn(db, principal, org.id);
      return principalAllows(principal, role, 'deployments:read') ? deploymentsOf(org) : [];
    });
    const review = deployments.flatMap(d => d.ov.pending.map(draft => ({ org: d.org, name: d.name, draft })))
      .sort((a, b) => a.draft.createdAt.localeCompare(b.draft.createdAt));
    const homeRole = roleIn(db, principal, principal.homeOrgId);
    const home = orgs.find(o => o.id === principal.homeOrgId);
    if (home?.kind === 'partner' && !deployments.length) return new Redirect(orgPath(home));
    const nav = { orgs, pending: review.length, canAudit: principalAllows(principal, homeRole, 'audit:read'), billingOrgs: billingOrgsOf(principal, orgs), org: orgs.length === 1 ? orgs[0] : undefined };
    return html(homePage({ ...base(principal), nav, deployments, review, canWrite: principalAllows(principal, homeRole, 'deployments:write') }));
  }, { public: true });

  // An AI vendor's clients: the partner org's own page, one row per client workspace it manages.
  const showClients = (principal, org, role, { url, error, values, status = 200 } = {}) => {
    const clients = orgsOf(principal).filter(o => o.partner_org_id === org.id).map(c => ({ org: c, deployments: deploymentsOf(c) }));
    return html(clientsPage({
      ...base(principal), org, clients, own: deploymentsOf(org), error, values,
      nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }),
      canManage: principalAllows(principal, role, 'org:manage'), notice: NOTICES[url?.searchParams.get('notice')],
    }), status);
  };

  r.add('POST', '/orgs/:org/clients', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org, role } = access(ctx, principal, params.org, 'org:manage');
    if (org.kind !== 'partner') throw notFound('page');
    let client;
    try {
      client = createOrg(db, { name: String(form.name ?? '').trim(), kind: 'customer', partnerOrgId: org.id }, ctx.now());
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
      return showClients(principal, org, role, { error: e.message, values: form, status: 400 });
    }
    event(ctx, principal, client.id, 'org.create', client.id, { name: client.name, partner_org_id: org.id, via_web: true });
    event(ctx, principal, org.id, 'client.add', client.id, { name: client.name });
    return new Redirect(`${orgPath(client)}?notice=client`);
  });

  r.add('GET', '/orgs/:org', ({ principal, params, url }) => {
    const { org, role } = access(ctx, principal, params.org, 'deployments:read');
    if (org.kind === 'partner') return showClients(principal, org, role, { url });
    return html(orgPage({
      ...base(principal), org, deployments: deploymentsOf(org), nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }),
      canWrite: principalAllows(principal, role, 'deployments:write'), notice: NOTICES[url.searchParams.get('notice')],
    }));
  });

  // The sample customer's support bot (see demo-bot.mjs). Public, like any customer endpoint, and canned.
  // With an Anthropic key the sample bot is a real AI, so it is rate limited per client and in total.
  const realBot = Boolean(ctx.demoBotClient || ctx.env?.ANTHROPIC_API_KEY);
  const botPerClient = createRateLimiter({ capacity: 40, refillPerSec: 1 / 3 });
  const botTotal = createRateLimiter({ capacity: 600, refillPerSec: 600 / 86400 });
  r.add('POST', '/demo/support-bot', async ({ req }) => {
    const body = await readJson(req, 16 * 1024).catch(() => ({}));
    const message = body?.body?.message;
    const json = (status, value) => ({ status, body: JSON.stringify(value), type: 'application/json' });
    if (!realBot) return json(200, { reply: demoAnswer(message) });
    if (!botPerClient(ctx.clientIp(req)).ok || !botTotal('all').ok) return json(429, { error: 'The sample bot is busy. Try again in a minute.' });
    try {
      return json(200, { reply: await aiAnswer(message, { ...(ctx.demoBotClient ? { client: ctx.demoBotClient } : {}), instructions: typeof body?.body?.instructions === 'string' ? body.body.instructions : '' }) });
    } catch (e) {
      console.error(`sample bot failed: ${e.message}`);
      return json(502, { error: 'The sample bot is unavailable right now.' });
    }
  }, { public: true });

  // The sample client's agent (see sample-agent.mjs): it takes actions and reports them. Same limits as the bot.
  r.add('POST', '/demo/store-agent', async ({ req }) => {
    const body = await readJson(req, 16 * 1024).catch(() => ({}));
    const message = body?.body?.message;
    const instructions = typeof body?.body?.instructions === 'string' ? body.body.instructions : '';
    const json = (status, value) => ({ status, body: JSON.stringify(value), type: 'application/json' });
    if (!realBot) return json(200, storeAgentScripted(message));
    if (!botPerClient(ctx.clientIp(req)).ok || !botTotal('all').ok) return json(429, { error: 'The sample agent is busy. Try again in a minute.' });
    try {
      return json(200, await storeAgentAnswer(message, { ...(ctx.demoBotClient ? { client: ctx.demoBotClient } : {}), instructions }));
    } catch (e) {
      console.error(`sample agent failed: ${e.message}`);
      return json(502, { error: 'The sample agent is unavailable right now.' });
    }
  }, { public: true });

  // A deployment that can be checked right away: Tallyfox's assistant, its policy and its test cases.
  function addSample(principal, org, req) {
    const taken = new Set(listDeployments(db, ctx.deploymentsRoot, org.id).map(d => d.name));
    let name = 'sample-tallyfox';
    for (let n = 2; taken.has(name); n++) name = `sample-tallyfox-${n}`;
    const origin = ctx.publicUrl ?? `http://${String(req.headers.host ?? '127.0.0.1')}`;
    const { cases, inputs } = sampleFiles();
    const config = {
      customer: realBot ? 'Tallyfox (sample, real AI)' : 'Tallyfox (sample)', name, target: { type: 'http', url: `${origin}/demo/support-bot`, body: { message: '{{input}}' }, output: 'reply' },
      acceptance: { minPassRate: 0.9 }, decisions: [{ date: ctx.now().toISOString().slice(0, 10), decision: 'Accept at a 90% pass rate', reason: 'Sample customer.' }],
    };
    registerDeployment(db, ctx.deploymentsRoot, org.id, { name, config, cases }, { actor: principal.actor, policy: ctx.policy }, ctx.now());
    const { dir } = deploymentFor(ctx, org.id, name);
    fs.mkdirSync(path.join(dir, 'inputs'), { recursive: true });
    for (const f of inputs) fs.writeFileSync(path.join(dir, 'inputs', f.name), f.text);
    event(ctx, principal, org.id, 'deployment.register', name, { via_web: true, sample: true });
    return name;
  }

  // The sample client's rollout: Linden & Co.'s agent, which takes actions on a test account, with the store's
  // policy, past tickets, order-system notes and the test account, as a client would hand them to a vendor.
  function addStoreSample(principal, org, req) {
    const taken = new Set(listDeployments(db, ctx.deploymentsRoot, org.id).map(d => d.name));
    let name = 'sample-linden-agent';
    for (let n = 2; taken.has(name); n++) name = `sample-linden-agent-${n}`;
    const origin = ctx.publicUrl ?? `http://${String(req.headers.host ?? '127.0.0.1')}`;
    const config = {
      customer: realBot ? 'Linden & Co. (sample, real AI)' : 'Linden & Co. (sample)', name, agentKind: 'support',
      target: { type: 'http', url: `${origin}/demo/store-agent`, body: { message: '{{input}}' }, output: 'reply', actions: 'actions' },
      acceptance: { minPassRate: 0.9 }, decisions: [{ date: ctx.now().toISOString().slice(0, 10), decision: 'Client sign-off required before launch', reason: 'Sample client.' }],
    };
    registerDeployment(db, ctx.deploymentsRoot, org.id, { name, config }, { actor: principal.actor, policy: ctx.policy }, ctx.now());
    const { dir } = deploymentFor(ctx, org.id, name);
    fs.mkdirSync(path.join(dir, 'inputs'), { recursive: true });
    for (const f of storeSampleFiles(origin)) fs.writeFileSync(path.join(dir, 'inputs', f.name), f.text);
    event(ctx, principal, org.id, 'deployment.register', name, { via_web: true, sample: true });
    return name;
  }

  r.add('POST', '/orgs/:org/sample', async ({ req, principal, params }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    return new Redirect(`${depPath(org, addSample(principal, org, req))}/scan?notice=sample`);
  });

  // For an AI vendor: a sample client workspace with the sample assistant in it, so the Clients page has a
  // client to open before any real one is added.
  r.add('POST', '/orgs/:org/clients/sample', async ({ req, principal, params }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    const { org } = access(ctx, principal, params.org, 'org:manage');
    if (org.kind !== 'partner') throw notFound('page');
    const client = createOrg(db, { name: 'Linden & Co. (sample client)', kind: 'customer', partnerOrgId: org.id }, ctx.now());
    event(ctx, principal, client.id, 'org.create', client.id, { name: client.name, partner_org_id: org.id, sample: true });
    event(ctx, principal, org.id, 'client.add', client.id, { name: client.name, sample: true });
    return new Redirect(`${depPath(client, addStoreSample(principal, client, req))}/rollout`);
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
    // A pasted key is saved encrypted for this agent and the target refers to it by name; a server environment
    // variable reference (${CUSTOMER_...}) is kept as it is.
    const saved = {};
    const keyRef = (value, name) => {
      if (/^\$\{[A-Za-z0-9_]+\}$/.test(value)) return value;
      saved[name] = value;
      return `\${secret:${name}}`;
    };
    if (form.type === 'command') {
      if (!field('command')) return fail('Enter the command that runs the customer’s AI.');
      target = { type: 'command', command: field('command') };
    } else if (form.type === 'intercom') {
      if (!field('intercom_token')) return fail('Paste the Intercom access token.');
      target = { type: 'intercom', token: keyRef(field('intercom_token'), 'INTERCOM_TOKEN') };
      if (field('intercom_contact')) target.contactExternalId = field('intercom_contact');
    } else if (form.type === 'zendesk') {
      if (!field('zendesk_subdomain')) return fail('Enter the Zendesk subdomain, the part before .zendesk.com.');
      if (!field('zendesk_app_id')) return fail('Enter the Sunshine Conversations app ID.');
      if (!field('zendesk_key_id') || !field('zendesk_secret')) return fail('Paste the Zendesk API key ID and secret.');
      target = { type: 'zendesk', subdomain: field('zendesk_subdomain').replace(/\.zendesk\.com$/i, ''), appId: field('zendesk_app_id'), keyId: keyRef(field('zendesk_key_id'), 'ZENDESK_KEY_ID'), secret: keyRef(field('zendesk_secret'), 'ZENDESK_SECRET') };
    } else if (form.type === 'openai') {
      // An OpenAI-compatible chat completions API is an HTTP target with a fixed request and answer shape.
      if (!/^https?:\/\//i.test(field('openai_url'))) return fail('Enter the full chat completions URL, starting with https://.');
      if (!field('openai_model')) return fail('Enter the model your agent uses.');
      const messages = [...(field('openai_system') ? [{ role: 'system', content: field('openai_system').slice(0, 20000) }] : []), { role: 'user', content: '{{input}}' }];
      target = { type: 'http', preset: 'openai', url: field('openai_url'), body: { model: field('openai_model'), messages }, output: 'choices.0.message.content' };
      if (field('openai_key')) target.headers = { authorization: `Bearer ${keyRef(field('openai_key'), 'API_KEY')}` };
    } else {
      if (!/^https?:\/\//i.test(String(form.url ?? ''))) return fail('Enter the full endpoint URL, starting with https://.');
      target = { type: 'http', url: String(form.url).trim(), body: { message: '{{input}}' } };
      if (field('api_key')) target.headers = { authorization: `Bearer ${keyRef(field('api_key'), 'API_KEY')}` };
      if (String(form.output ?? '').trim()) target.output = String(form.output).trim();
      if (field('actions')) target.actions = field('actions');
    }
    const agentKind = Object.hasOwn(AGENT_KINDS, String(form.agentKind ?? '')) ? String(form.agentKind) : 'support';
    const config = { customer: String(form.customer ?? '').trim() || undefined, name: String(form.name ?? ''), agentKind, target, acceptance: { minPassRate: pass / 100 }, decisions: [] };
    try {
      const d = registerDeployment(db, ctx.deploymentsRoot, org.id, { name: String(form.name ?? ''), config }, { actor: principal.actor, policy: ctx.policy }, ctx.now());
      const { dir } = deploymentFor(ctx, org.id, d.name);
      for (const [name, value] of Object.entries(saved)) saveSecret(dir, name, value, ctx.pepper, ctx.now());
      if (Object.keys(saved).length) appendAudit(dir, { actor: principal.actor, action: 'secret.save', target: Object.keys(saved).join(','), detail: {} }, ctx.now());
      event(ctx, principal, org.id, 'deployment.register', d.name, { via_web: true });
      return new Redirect(`${depPath(org, d.name)}?notice=created`);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500) throw e;
      return fail(e.message);
    }
  });

  const showOverview = (principal, params, url, error, status = 200, upgrade) => html(deploymentOverviewPage({ ...workspace(principal, params, 'runs:read', url), error, upgrade }), status);

  // An agent opens on its check results; the activity view (latest test run, agent activity) moved under More.
  r.add('GET', '/orgs/:org/deployments/:name', ({ principal, params, url }) => {
    const { org } = access(ctx, principal, params.org, 'runs:read');
    return new Redirect(`${depPath(org, params.name)}/scan${url.search}`);
  });
  r.add('GET', '/orgs/:org/deployments/:name/overview', ({ principal, params, url }) => showOverview(principal, params, url));
  // Risk scans run in the background (about a minute); the scan page shows live progress and refreshes.
  const scans = new Map();
  // Starts a policy check in the background and returns its job; throws an ApiError when a plan limit is hit.
  async function startScan(principal, org, name, dir) {
    if (scans.get(dir)?.status === 'running') return scans.get(dir);
    const { riskScan } = await import('../v1/risk.mjs');
    // Plan limits: a completed scan counts toward the month (the scan.create event below).
    const release = ctx.billing.reserveScan(org.id);
    const job = { status: 'running', startedAt: ctx.now().getTime(), progress: { phase: 'rules' } };
    scans.set(dir, job);
    job.done = riskScan(dir, { llm: ctx.llm ?? createLlm(), onProgress: p => { job.progress = p; if (p.status) (job.marks ??= []).push({ status: p.status, at: Date.now() }); } }).then(result => {
      if (!result.ok) Object.assign(job, { status: 'failed', error: `The scan found nothing to test: ${result.reason}` });
      else {
        event(ctx, principal, org.id, 'scan.create', `${name}/${result.scan.id}`, { broken: result.scan.summary.broken, rules: result.scan.summary.rules });
        job.status = 'done';
      }
    }, e => Object.assign(job, { status: 'failed', error: scanError(e, dir, name) })).finally(() => release());
    return job;
  }
  r.add('GET', '/orgs/:org/deployments/:name/scan', ({ principal, params, url }) => {
    const ws = workspace(principal, params, 'runs:read', url);
    const job = scans.get(ws.dir);
    const fixArgs = { fix: getFix(ws.dir), fixTarget: instructionsTarget(ws.config) };
    if (job?.status === 'running') return html(riskScanPage({ ...ws, ...fixArgs, job }));
    if (job) scans.delete(ws.dir);
    if (job?.status === 'failed') return html(riskScanPage({ ...ws, ...fixArgs, flash: '', error: job.error }));
    return html(riskScanPage(job?.status === 'done' ? { ...ws, ...fixArgs, flash: job.recheck ? NOTICES.rechecked : NOTICES.scanned } : { ...ws, ...fixArgs }));
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
    const page = `${depPath(org, params.name)}/scan`;
    try {
      await startScan(principal, org, params.name, dir);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      return fail(e.message, e.status, e.extra?.upgrade_url);
    }
    return new Redirect(page);
  });

  // One click for the whole rollout (src/v1/agent.mjs): the agent drafts the data mapping, the integration and
  // the test set, each as a draft a person reviews, then the policy check runs. Nothing is applied without a person.
  const rollouts = new Map();
  r.add('POST', '/orgs/:org/deployments/:name/rollout', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const page = `${depPath(org, params.name)}/rollout`;
    if (rollouts.get(dir)?.status === 'running') return new Redirect(page);
    const { TASKS } = await import('../v1/agent.mjs');
    const job = { status: 'running', startedAt: ctx.now().toISOString(), steps: ROLLOUT_STEPS.map(([key, label]) => ({ key, label, state: 'waiting' })) };
    rollouts.set(dir, job);
    event(ctx, principal, org.id, 'rollout.start', params.name);
    const llm = ctx.llm ?? createLlm();
    job.done = (async () => {
      for (const step of job.steps) {
        step.state = 'running';
        try {
          if (step.key === 'check') {
            const inputs = path.join(dir, 'inputs');
            if (!fs.existsSync(inputs) || !fs.readdirSync(inputs, { withFileTypes: true }).some(e => e.isFile() && !e.name.toLowerCase().endsWith('.csv'))) {
              Object.assign(step, { state: 'skipped', detail: 'Add the client’s policies to run the check.' });
              continue;
            }
            checkTarget(loadConfig(dir), ctx.policy);
            const scan = await startScan(principal, org, params.name, dir);
            await scan.done;
            Object.assign(step, scan.status === 'done' ? { state: 'done', detail: 'Check finished.' } : { state: 'failed', detail: scan.error });
            continue;
          }
          const result = await TASKS[step.key](dir, { llm });
          if (!result.ok) Object.assign(step, { state: 'skipped', detail: result.reason });
          else {
            event(ctx, principal, org.id, 'agent.draft', `${params.name}/${step.key}`, { drafts: result.drafts.map(d => d.id), via: 'rollout' });
            Object.assign(step, { state: 'done', detail: `${result.drafts.length} draft${result.drafts.length === 1 ? '' : 's'} waiting for review.` });
          }
        } catch (e) {
          const detail = isAuthError(e) ? 'The agent has no model credentials on this server.' : e instanceof ApiError ? e.message : String(e.message ?? e).split(dir).join(params.name);
          Object.assign(step, { state: 'failed', detail });
          if (isAuthError(e)) break;
        }
      }
      for (const step of job.steps) if (step.state === 'waiting') Object.assign(step, { state: 'skipped', detail: 'Stopped after an earlier step failed.' });
      job.status = 'done';
    })();
    return new Redirect(page);
  });

  r.add('POST', '/orgs/:org/deployments/:name/hours', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const hours = Number(form.hours);
    if (!HOUR_STEPS.includes(form.step) || !(hours > 0 && hours <= 200)) {
      return html(rolloutPage({ ...workspace(principal, params, 'runs:read'), rollout: rollouts.get(dir), error: 'Choose a step and enter between 0.25 and 200 hours.' }), 400);
    }
    logHours(dir, form.step, hours, String(form.note ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200), ctx.now().toISOString().slice(0, 10));
    appendAudit(dir, { actor: principal.actor, action: 'hours.log', target: form.step, detail: { hours } }, ctx.now());
    event(ctx, principal, org.id, 'hours.log', params.name, { step: form.step, hours });
    return new Redirect(`${depPath(org, params.name)}/rollout?notice=hours`);
  });

  // The plan's deployment metrics. An AI vendor's include every client workspace it can open.
  r.add('GET', '/orgs/:org/metrics', ({ principal, params }) => {
    const { org, role } = access(ctx, principal, params.org, 'deployments:read');
    const orgs = org.kind === 'partner' ? [org, ...orgsOf(principal).filter(o => o.partner_org_id === org.id)] : [org];
    return html(metricsPage({ ...base(principal), org, m: deploymentMetrics(orgs.flatMap(deploymentsOf)), nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }) }));
  });

  // A sign-off link just made, by session, shown once on the next Rollout page and then forgotten.
  const freshLinks = new Map();
  const showRollout = (principal, params, url, extra = {}, status = 200) => {
    const ws = workspace(principal, params, 'runs:read', url);
    const fresh = freshLinks.get(principal.token);
    freshLinks.delete(principal.token);
    const job = rollouts.get(ws.dir);
    const signoff = { latest: latestSignoff(ws.dir), active: activeShares(db, ws.org.id, params.name, 'signoff', ctx.now()).length, link: extra.link ?? fresh };
    return html(rolloutPage({ ...ws, rollout: job, signoff, error: extra.error, refresh: job?.status === 'running' ? 3 : 0 }), status);
  };
  r.add('GET', '/orgs/:org/deployments/:name/rollout', ({ principal, params, url }) => showRollout(principal, params, url));

  // Client sign-off (src/v3/signoff.mjs): a link to the latest check, shown once, that the client opens without
  // an account to accept the AI agent or send it back.
  r.add('POST', '/orgs/:org/deployments/:name/signoff/link', async ({ req, principal, params }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const scan = listScans(dir)[0];
    if (!scan) return showRollout(principal, params, null, { error: 'Run the policy check first: the client signs off on a check.' }, 400);
    const { token, share } = createShare(db, { orgId: org.id, deployment: params.name, purpose: 'signoff', subject: scan.id, createdBy: principal.actor }, ctx.now());
    appendAudit(dir, { actor: principal.actor, action: 'signoff.link', target: scan.id, detail: { share: share.id, expires: share.expires_at } }, ctx.now());
    event(ctx, principal, org.id, 'signoff.link', params.name, { scan: scan.id, share: share.id });
    // Show the link once on the next page load, so reloading the page does not make another link.
    freshLinks.set(principal.token, `${returnBase(req)}/signoff/${token}`);
    return new Redirect(`${depPath(org, params.name)}/rollout`);
  });

  r.add('POST', '/orgs/:org/deployments/:name/signoff/revoke', async ({ req, principal, params }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const n = revokeShares(db, org.id, params.name, 'signoff', ctx.now());
    event(ctx, principal, org.id, 'signoff.revoke', params.name, { links: n });
    return new Redirect(`${depPath(org, params.name)}/rollout`);
  });

  const SIGNOFF_CSRF = 'delomu_signoff_csrf';
  const signoffLimit = createRateLimiter({ capacity: 10, refillPerSec: 1 / 60 });
  // The link's deployment and what the page shows, or a 404 for an unknown, expired or revoked link.
  function signoffContext(token) {
    const share = findShare(db, token, 'signoff', ctx.now());
    if (!share) throw notFound('sign-off link');
    const org = getOrg(db, share.org_id);
    const vendor = org?.partner_org_id ? getOrg(db, org.partner_org_id) : null;
    const { dir } = deploymentFor(ctx, share.org_id, share.deployment);
    let config = {};
    try { config = loadConfig(dir); } catch { /* the page works without it */ }
    const launch = fs.existsSync(path.join(dir, 'launch-summary.md')) ? fs.readFileSync(path.join(dir, 'launch-summary.md'), 'utf8').slice(0, 8000) : '';
    const done = signoffs(dir).find(s => s.shareId === share.id) ?? null;
    return { share, org, dir, config, scan: getScan(dir, share.subject), launch, done, view: { token, preparedBy: (vendor ?? org).name, client: config.customer ?? org.name, name: share.deployment } };
  }

  r.add('GET', '/signoff/:token', ({ req, params }) => {
    const c = signoffContext(params.token);
    const csrf = randomToken();
    return html(signoffPage({ ...c.view, csrf, scan: c.scan, launch: c.launch, done: c.done }), 200, [cookie(SIGNOFF_CSRF, csrf, { maxAge: 3600, secure: ctx.secureCookies(req), path: '/signoff' })]);
  }, { public: true });

  r.add('GET', '/signoff/:token/report.html', ({ params }) => {
    const c = signoffContext(params.token);
    if (!c.scan) throw notFound('check');
    return { status: 200, body: renderScanReport({ scan: c.scan, name: c.share.deployment, customer: c.config.customer, org: c.view.preparedBy }), csp: REPORT_CSP };
  }, { public: true });

  r.add('POST', '/signoff/:token', async ({ req, params }) => {
    const c = signoffContext(params.token);
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(parseCookies(req.headers.cookie)[SIGNOFF_CSRF] ?? '', form);
    const values = { name: String(form.name ?? '').trim(), decision: form.decision === 'declined' ? 'declined' : 'accepted', note: String(form.note ?? '') };
    const again = (error, status) => html(signoffPage({ ...c.view, csrf: form.csrf, scan: c.scan, launch: c.launch, error, values }), status);
    if (c.done || !c.scan) return html(signoffPage({ ...c.view, csrf: form.csrf, scan: c.scan, launch: c.launch, done: c.done }), 409);
    if (!signoffLimit(ctx.clientIp(req)).ok) return again('Too many attempts from this network. Try again in a few minutes.', 429);
    if (!values.name) return again('Enter your name so the team knows who decided.', 400);
    const done = recordSignoff(c.dir, { ...values, scanId: c.scan.id, shareId: c.share.id, ip: ctx.clientIp(req) }, ctx.now());
    recordEvent(db, { orgId: c.share.org_id, actor: `client:${done.name}`, action: `signoff.${done.decision}`, target: c.share.deployment, detail: { scan: c.scan.id, share: c.share.id }, ip: ctx.clientIp(req) }, ctx.now());
    return html(signoffPage({ ...c.view, csrf: form.csrf, scan: c.scan, launch: c.launch, done }));
  }, { public: true });

  // The fix loop (src/v1/fix.mjs): the agent drafts one change to the AI's instructions for the broken rules,
  // a person edits and approves it, Delomu applies it where it can, and the same messages run again.
  r.add('POST', '/orgs/:org/deployments/:name/fix/draft', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const fail = message => html(riskScanPage({ ...workspace(principal, params, 'runs:read'), fix: getFix(dir), fixTarget: instructionsTarget(loadConfig(dir)), error: message }), 400);
    let res;
    try {
      res = await draftFix(dir, { llm: ctx.llm ?? createLlm(), now: ctx.now() });
    } catch (e) {
      return fail(scanError(e, dir, params.name).replace('The check could not', 'The fix could not'));
    }
    if (!res.ok) return fail(`The agent could not draft a fix: ${res.reason}.`);
    event(ctx, principal, org.id, 'fix.draft', params.name, { rules: res.fix.rules.length });
    return new Redirect(`${depPath(org, params.name)}/scan?notice=fixdrafted`);
  });

  r.add('POST', '/orgs/:org/deployments/:name/fix/approve', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const page = `${depPath(org, params.name)}/scan`;
    if (scans.get(dir)?.status === 'running') return new Redirect(page);
    try {
      approveFix(dir, { instructions: form.instructions, apply: form.mode === 'apply', actor: principal.actor, now: ctx.now() });
    } catch (e) {
      return html(riskScanPage({ ...workspace(principal, params, 'runs:read'), fix: getFix(dir), fixTarget: instructionsTarget(loadConfig(dir)), error: e.message }), 400);
    }
    event(ctx, principal, org.id, form.mode === 'apply' ? 'fix.apply' : 'fix.applied_manually', params.name, {});
    startRecheck(principal, org, params.name, dir);
    return new Redirect(page);
  });

  // When a re-check came out worse: put back the instructions from before the fix, then check again.
  r.add('POST', '/orgs/:org/deployments/:name/fix/revert', async ({ req, principal, params }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const page = `${depPath(org, params.name)}/scan`;
    if (scans.get(dir)?.status === 'running') return new Redirect(page);
    try {
      revertFix(dir, { actor: principal.actor, now: ctx.now() });
    } catch (e) {
      return html(riskScanPage({ ...workspace(principal, params, 'runs:read'), fix: getFix(dir), fixTarget: instructionsTarget(loadConfig(dir)), error: e.message }), 400);
    }
    event(ctx, principal, org.id, 'fix.revert', params.name, {});
    startRecheck(principal, org, params.name, dir);
    return new Redirect(page);
  });

  function startRecheck(principal, org, name, dir) {
    const job = { status: 'running', recheck: true, startedAt: ctx.now().getTime(), progress: { phase: 'probes', done: 0, total: 0 } };
    scans.set(dir, job);
    job.done = recheck(dir, { llm: ctx.llm ?? createLlm(), now: ctx.now(), onProgress: p => { job.progress = p; if (p.status) (job.marks ??= []).push({ status: p.status, at: Date.now() }); } }).then(result => {
      if (!result.ok) Object.assign(job, { status: 'failed', error: `The re-check could not run: ${result.reason}.` });
      else { event(ctx, principal, org.id, 'scan.recheck', `${name}/${result.scan.id}`, { broken: result.scan.summary.broken }); job.status = 'done'; }
    }, e => Object.assign(job, { status: 'failed', error: scanError(e, dir, name) }));
  }

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
  const showSettings = (principal, params, url, link) => {
    const ws = workspace(principal, params, 'deployments:read', url);
    const verified = activeShares(db, ws.org.id, params.name, 'verified', ctx.now()).length > 0;
    return html(settingsPage({ ...ws, keys: savedSecrets(ws.dir), verified: { on: verified, link, canManage: ws.can.manage } }));
  };
  r.add('GET', '/orgs/:org/deployments/:name/settings', ({ principal, params, url }) => showSettings(principal, params, url));

  // Replace a key the customer saved for their AI. Only the name goes into the audit log.
  r.add('POST', '/orgs/:org/deployments/:name/secret', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const name = String(form.name ?? '');
    if (!savedSecrets(dir).some(k => k.name === name) || !String(form.value ?? '').trim()) throw new ApiError('invalid_request_error', 'Choose a saved key and paste its new value.');
    saveSecret(dir, name, form.value, ctx.pepper, ctx.now());
    appendAudit(dir, { actor: principal.actor, action: 'secret.save', target: name, detail: {} }, ctx.now());
    event(ctx, principal, org.id, 'secret.save', params.name, { name });
    return new Redirect(`${depPath(org, params.name)}/settings`);
  });

  // The public page (src/v3/verified.mjs), off by default. Owners and admins turn it on; each time makes a new
  // link (only its hash is stored) and turning it off ends every link.
  r.add('POST', '/orgs/:org/deployments/:name/verified', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'org:manage');
    deploymentFor(ctx, org.id, params.name);
    revokeShares(db, org.id, params.name, 'verified', ctx.now());
    if (form.state !== 'on') {
      event(ctx, principal, org.id, 'verified.off', params.name);
      return new Redirect(`${depPath(org, params.name)}/settings`);
    }
    const { token } = createShare(db, { orgId: org.id, deployment: params.name, purpose: 'verified', createdBy: principal.actor }, ctx.now(), null);
    event(ctx, principal, org.id, 'verified.on', params.name);
    return showSettings(principal, params, null, `${returnBase(req)}/verified/${token}`);
  });

  r.add('GET', '/verified/:token', ({ params }) => {
    const share = findShare(db, params.token, 'verified', ctx.now());
    if (!share) throw notFound('page');
    const org = getOrg(db, share.org_id);
    const { dir } = deploymentFor(ctx, share.org_id, share.deployment);
    let config = {};
    try { config = loadConfig(dir); } catch { /* the page works without it */ }
    return html(verifiedPage({ company: config.customer ?? org.name, name: share.deployment, facts: verifiedFacts(dir, ctx.now()) }));
  }, { public: true });

  // The latest check as a document for the customer or legal: print it, then Save as PDF.
  r.add('GET', '/orgs/:org/deployments/:name/scan/report.html', ({ principal, params }) => {
    const { org } = access(ctx, principal, params.org, 'runs:read');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const scan = listScans(dir)[0];
    if (!scan) throw notFound('check');
    let config = {};
    try { config = loadConfig(dir); } catch { /* the report works without it */ }
    return { status: 200, body: renderScanReport({ scan, name: params.name, customer: config.customer, org: org.name }), csp: REPORT_CSP };
  });

  // The agent's evidence pack over a date range (default: the last 90 days), for legal, risk and compliance.
  r.add('GET', '/orgs/:org/deployments/:name/evidence.html', ({ principal, params, url }) => {
    const { org } = access(ctx, principal, params.org, 'runs:read');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const now = ctx.now();
    const range = evidenceRange({ from: url.searchParams.get('from'), to: url.searchParams.get('to') }, now);
    if (!range.ok) throw new ApiError('invalid_request_error', range.reason);
    let config = {};
    try { config = loadConfig(dir); } catch { /* the pack works without it */ }
    const data = buildEvidence(dir, { from: range.from, to: range.to, now });
    return { status: 200, body: renderEvidence(data, { name: params.name, customer: config.customer, org: org.name }), csp: REPORT_CSP };
  });

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
    const checked = listScans(dir)[0];
    const before = policyFingerprint(dir);
    fs.mkdirSync(inputs, { recursive: true });
    for (const { name, bytes } of ready) {
      fs.writeFileSync(path.join(inputs, name), bytes);
      appendAudit(dir, { actor: principal.actor, action: 'input.upload', target: name, detail: { bytes: bytes.length } }, ctx.now());
    }
    event(ctx, principal, org.id, 'input.upload', params.name, { files: ready.map(f => f.name) });
    // New policy wording can make the last check's rules stale: check again right away, within plan limits.
    if (checked && policyFingerprint(dir) !== before) {
      try {
        checkTarget(loadConfig(dir), ctx.policy);
        await startScan(principal, org, params.name, dir);
        appendAudit(dir, { actor: 'system', action: 'scan.auto', target: 'policies changed' }, ctx.now());
        return new Redirect(`${depPath(org, params.name)}/scan?notice=policychange`);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        return new Redirect(`${depPath(org, params.name)}/inputs?notice=policystale`);
      }
    }
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
    if (org.partner_org_id) {
      const vendor = orgsOf(principal).find(o => o.id === org.partner_org_id);
      if (vendor) return new Redirect(`${orgPath(vendor)}/billing`);
      throw notFound('page');
    }
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
