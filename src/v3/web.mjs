// The web UI: sign in (SSO or API key), home, deployments, the deployment workspace (overview, runs,
// draft review, customer material, settings), creating deployments, starting runs and agent drafts, and
// the audit page. Cookie sessions; every state-changing form POST checks a CSRF token. Authorization goes
// through the same operations.mjs checks as the JSON API.

import crypto from 'node:crypto';
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
import { getScan, listScans, recheck, setOverride } from '../v1/risk.mjs';
import { PLANS as PLAN_LIST } from './billing.mjs';
import { INTERVALS as MONITOR_INTERVALS, monitorSettings, monitorStatus, monitorTick, setMonitor } from './monitoring.mjs';
import { getOrgSettings, getRevenue, logIntervention, normTag, productizationHealth, readInterventions, setOrgSettings, setRevenue } from './productization.mjs';
import { importFrom, SOURCES as IMPORT_SOURCES, zendeskAuthorizeUrl, zendeskToken } from './importers.mjs';
import { readConnector, generateConnectorCode, toolSchemas } from '../v1/connector.mjs';
import { summarizeHar, saveRecording, readRecording, removeRecording } from '../v1/recording.mjs';
import { ask as askAssistant, deploymentContext, MAX_HISTORY, MAX_MESSAGE, orgContext, resolveActions, suggestions as assistantSuggestions } from './assistant.mjs';
import { addToPlaybook, consentOf, contributed, integrationExamples, playbookStats, removeFromPlaybook, setConsent, suggestFromPlaybook } from './playbook.mjs';
import { policyFingerprint } from '../v1/policies.mjs';
import { AGENT_KINDS } from '../v1/kinds.mjs';
import { approveFix, draftFix, getFix, instructionsTarget, revertFix, undoIfWorse } from '../v1/fix.mjs';
import { renderScanReport } from './scan-report.mjs';
import { buildEvidence, evidenceRange, renderEvidence } from './evidence.mjs';
import { accessibleOrgs, addMember, createOrg, getOrg, getOrgBySlug, renameOrg } from './accounts.mjs';
import { activeShares, createShare, deadShare, findShare, isPreviewBot, markOpened, revokeShares } from './shares.mjs';
import { latestSignoff, recordSignoff, signoffGonePage, signoffPage, signoffs } from './signoff.mjs';
import { handoverData, handoverPage } from './handover.mjs';
import { buildQuestionnaire, questionnaireCsv, questionnairePage, saveVendorAnswers } from './questionnaire.mjs';
import { verifiedFacts, verifiedPage } from './verified.mjs';
import { readSecret, saveSecret, savedSecrets } from './secrets.mjs';
import { tx } from './db.mjs';
import { createRateLimiter } from './ratelimit.mjs';
import { recordEvent, listEvents } from './events.mjs';
import { aiAnswer, demoAnswer, sampleFiles } from './demo-bot.mjs';
import { storeAgentAnswer, storeAgentScripted, storeSampleFiles } from './sample-agent.mjs';
import { INDUSTRIES, industryAgentAnswer, industryFiles, industryScripted } from './sample-industries.mjs';
import { DEMO_CLIENTS, demoScan, seedDemoAcceptance, seedDemoScan } from './demo-portfolio.mjs';
// The recorded checks the landing page draws its product scenes from, read once.
const LANDING_DEMO = { bank: demoScan('bank'), store: demoScan('store') };
import { ApiError, cookie, createRouter, notFound, parseCookies, readForm, readFormAll, readJson, send } from './http.mjs';
import { authenticateKey, createApiKey } from './keys.mjs';
import {
  auditPage, billingPage, BUSY_SCRIPT_HASH, ASSISTANT_SCRIPT_HASH, LANDING_SCRIPT_HASH, clientsPage, landingPage, pricingPage, securityPage, integrationsPage, developersPage, designPartnersPage, applicationsPage, welcomePage, privacyPage, termsPage, deploymentOverviewPage, depPath, draftsPage, errorPage, homePage, inputsPage, loginPage,
  livePage, metricsPage, productizationPage, assistantPage, newDeploymentPage, orgPage, orgPath, riskScanPage, rolloutPage, runsPage, settingsPage, signupKeyPage, signupPage,
} from './html.mjs';
import { overview } from './insights.mjs';
import { access, checkLiveConversation, deploymentAudits, deploymentFor, draftOf, event, reviewDeploymentDraft, startRun } from './operations.mjs';
import { principalAllows, roleIn } from './rbac.mjs';
import { createLoginLink, sendLoginEmail, useLoginLink } from './email-login.mjs';
import { readApplication, saveApplication, notifyApplication, listApplications, isOperator } from './partners.mjs';
import { createSession, deleteSession, getSession, randomToken, sameSecret, SESSION_COOKIE, SESSION_TTL_MS } from './sessions.mjs';
import { OidcError } from './oidc.mjs';
import { finishLogin, getOidcConfig, LOGIN_TTL_MS, startLogin, STATE_COOKIE } from './sso.mjs';
import { checkTarget, listDeployments, registerDeployment, reportFile } from './workspace.mjs';

const LOGIN_CSRF_COOKIE = 'delomu_login_csrf';
// The Grapim mark (assets/brand/delomu-mark.svg), dark on light tabs and light on dark ones.
// The UI typeface (Geist, OFL; src/v3/fonts/OFL.txt), served from this server so pages make no third-party calls.
// What a person sees when a check fails. Problems with Grapim's own model are ours to fix, so the page says
// so plainly and the details go to the server log; anything else (usually the customer's AI) is shown as is.
function scanError(e, dir, name) {
  const detail = String(e?.message ?? e).split(dir).join(name);
  if (isAuthError(e) || /^(Meta Model API|Anthropic|no Meta Model API key)/i.test(detail) || e?.status >= 500) {
    console.error(`check failed for ${name}: ${detail}`);
    return 'The check could not run because Grapim\u2019s AI model is unavailable right now. It did not count toward your plan. Try again in a few minutes; if it keeps happening, contact support.';
  }
  return `The check could not finish: ${detail}`;
}

const FONTS = Object.fromEntries(['Geist-Variable.woff2', 'GeistMono-Variable.woff2'].map(f => [f, fs.readFileSync(new URL(`./fonts/${f}`, import.meta.url))]));
// Product clips and stills on the public page (src/v3/media), recorded in Grapim on the sample store.
const MEDIA_TYPES = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg' };
const MEDIA = Object.fromEntries(fs.readdirSync(new URL('./media/', import.meta.url)).filter(f => MEDIA_TYPES[f.slice(f.lastIndexOf('.'))]).map(f => [f, fs.readFileSync(new URL(`./media/${f}`, import.meta.url))]));
const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>.f{fill:#0a0a0a}.s{stroke:#0a0a0a}@media (prefers-color-scheme:dark){.f{fill:#fff}.s{stroke:#fff}}</style><rect x="25" y="9" width="30" height="30" rx="5" transform="rotate(45 40 24)" fill="none" class="s" stroke-width="5"/><rect x="6" y="26" width="34" height="34" rx="8" class="f"/></svg>';
const PAGE_CSP = `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'self'; script-src '${BUSY_SCRIPT_HASH}' '${ASSISTANT_SCRIPT_HASH}' '${LANDING_SCRIPT_HASH}'; frame-ancestors 'none'; base-uri 'none'`;
const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;
const INPUT_TYPES = new Set(['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.html']);
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * MAX_INPUT_BYTES;
const MAX_RECORDING_BYTES = 40 * MAX_INPUT_BYTES; // HAR files carry response bodies; only their shape is kept
const REPLAY_LIMIT = 6;
const AGENT_TASKS = ['mapping', 'integration', 'cases', 'fixes', 'launch-report', 'connector'];
// What one click on Run the rollout does, in order. Fixes and the launch report follow a test run, so they come later.
const ROLLOUT_STEPS = [['mapping', 'Draft the data mapping'], ['integration', 'Draft the integration'], ['connector', 'Draft the client-system connector'], ['cases', 'Draft the test set'], ['playbook', 'Add test messages from your playbook'], ['check', 'Run the policy check'], ['fix', 'Draft the fix for broken rules'], ['signoff', 'Get the client’s sign-off']];
const NOTICES = {
  created: 'AI agent added. Add your policies next, then run the check.',
  ran: 'Test run finished.',
  scanned: 'Check finished.',
  autofix: 'Check finished. Grapim drafted a fix for the broken rules: review it below, then approve to send the same messages again.',
  rechecked: 'Re-check finished: the same messages were sent again.',
  'zendesk-connected': 'Zendesk connected. Import whenever you like; nothing is copied until you do.',
  'zendesk-denied': 'Zendesk was not connected: the request was declined in Zendesk.',
  verdict: 'Verdict changed. The counts and the fix use it from now on, and the change is in the audit log.',
  fixdrafted: 'The agent drafted a fix. Review the instructions below, edit them if you like, then approve.',
  client: 'Client workspace ready. Connect the AI you deploy for this client, or try the sample bot first.',
  demo: 'Demo ready: three sample clients at three stages. Their check results were recorded on the sample agents.',
  sample: 'Sample ready: Tallyfox’s support assistant and its billing policy. Run the check to see which rules it breaks.',
  drafted: 'The agent drafted a proposal. Review it below.',
  uploaded: 'Files added.',
  policychange: 'Your policies changed, so the check is running again on the new wording.',
  policystale: 'Files added. Your policies changed since the last check; run the check again when you can.',
  checked: 'Conversation checked.',
  replayed: 'Sample traffic checked. Every conversation below was judged against the policy rules.',
  alerts: 'Alert settings saved.',
  hours: 'Hours logged. They count toward Deployment metrics.',
  playbook: 'Playbook updated.',
  renamed: 'Organization renamed.',
  imported: 'Imported from the client’s system. The files are listed below.',
  revenue: 'Revenue saved. It counts toward Productization health.',
  focus: 'Focus and team saved.',
  monitor: 'Monitoring settings saved.',
  monitorran: 'The saved test set ran again. See the result under Monitoring.',
  recorded: 'Recording added: Grapim kept the API calls’ shape and dropped every value. Draft the connector to use it.',
  recordingremoved: 'Recording removed.',
  monitorchecked: 'Nothing changed since the last run, so the tests were not run again.',
};

class Redirect {
  constructor(location, cookies = []) { this.location = location; this.cookies = cookies; }
}
// Thrown from a helper deep in a handler to answer with this page instead (e.g. a closed sign-off link).
class Responded {
  constructor(out) { this.out = out; }
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

function signIn(ctx, req, { userId, orgId, scopes, apiKeyId, email, via, to = '/' }) {
  const { token } = createSession(ctx.db, { userId, orgId, scopes, apiKeyId }, ctx.now());
  recordEvent(ctx.db, { orgId, actor: `human:${email}`, action: 'user.login', target: email, detail: { via }, ip: ctx.clientIp(req) }, ctx.now());
  const out = new Redirect(to, [cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL_MS / 1000, secure: ctx.secureCookies(req) })]);
  out.token = token;
  return out;
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
    return { org, name: d.name, dir, customer: config.customer, config, ov: overview(dir, config), hours, signoff: latestSignoff(dir), signoffOpen: activeShares(db, org.id, d.name, 'signoff', ctx.now()).length };
  });
  // Orgs where the principal may open Billing (owners and admins), for the sidebar link.
  // A client workspace is billed to its vendor, so Billing shows on the vendor's org only.
  const billingOrgsOf = (principal, orgs) => new Set(orgs.filter(o => !o.partner_org_id && principalAllows(principal, roleIn(db, principal, o.id), 'org:manage')).map(o => o.id));
  const navFor = (principal, extra = {}) => {
    const orgs = orgsOf(principal);
    const pending = orgs.flatMap(deploymentsOf).reduce((n, d) => n + d.ov.pending.length, 0);
    const billingOrgs = billingOrgsOf(principal, orgs);
    // The org to offer an upgrade for: the home org, when it is on Free, paid plans are on and this person can buy.
    const home = orgs.find(o => o.id === principal.homeOrgId);
    const upgrade = ctx.billing?.configured && home && billingOrgs.has(home.id) && ctx.billing.planOf(home.id)?.id === 'free' ? home : null;
    return { orgs, pending, billingOrgs, upgrade, ...extra };
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
      signoff: { latest: latestSignoff(dir), active: activeShares(db, org.id, params.name, 'signoff', ctx.now()).length },
      nav: navFor(principal, { canAudit: allow('audit:read') }),
      can: { write: allow('deployments:write'), run: allow('runs:create'), review: allow('drafts:review'), manage: allow('org:manage') },
      flash: NOTICES[url?.searchParams.get('notice')] ?? '',
      checking: scans.get(dir)?.status === 'running',
    };
  }

  const PUBLIC_PATHS = ['/', '/pricing', '/design-partners', '/integrations', '/developers', '/security', '/privacy', '/terms'];
  r.add('GET', '/robots.txt', () => ({ status: 200, body: `User-agent: *\nAllow: /\nDisallow: /orgs/\nDisallow: /operator/\nDisallow: /signoff/\nDisallow: /verified/\nDisallow: /v1/\nSitemap: https://grapim.com/sitemap.xml\n`, type: 'text/plain; charset=utf-8' }), { public: true });
  r.add('GET', '/sitemap.xml', () => ({ status: 200, body: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${PUBLIC_PATHS.map(p => `<url><loc>https://grapim.com${p}</loc></url>`).join('')}</urlset>\n`, type: 'application/xml; charset=utf-8' }), { public: true });
  r.add('GET', '/favicon.svg', () => ({ status: 200, body: FAVICON, type: 'image/svg+xml', headers: { 'cache-control': 'public, max-age=86400' } }), { public: true });

  // Videos are sent whole or as one byte range, which Safari needs before it plays an mp4.
  r.add('GET', '/media/:file', ({ req, params }) => {
    const body = MEDIA[params.file];
    if (!body) throw notFound('file');
    const type = MEDIA_TYPES[params.file.slice(params.file.lastIndexOf('.'))];
    const headers = { 'cache-control': 'public, max-age=86400', 'accept-ranges': 'bytes' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m && (m[1] || m[2])) {
      const size = body.length;
      let start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      let end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) return { status: 416, body: '', type, headers: { ...headers, 'content-range': `bytes */${size}` } };
      return { status: 206, body: body.subarray(start, end + 1), type, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}` } };
    }
    return { status: 200, body, type, headers };
  }, { public: true });

  r.add('GET', '/fonts/:file', ({ params }) => {
    const body = FONTS[params.file];
    if (!body) throw notFound('font');
    return { status: 200, body, type: 'font/woff2', headers: { 'cache-control': 'public, max-age=31536000, immutable' } };
  }, { public: true });

  r.add('GET', '/login', ({ req }) => {
    const token = randomToken();
    return html(loginPage({ csrf: token, signup: signupOpen, email: Boolean(ctx.emailLogin) }), 200, [cookie(LOGIN_CSRF_COOKIE, token, { maxAge: 3600, secure: ctx.secureCookies(req) })]);
  }, { public: true });

  // Self-serve sign-up, on when the operator sets DELOMU_SIGNUP=open: a new org on the Free plan, its
  // owner, and a sign-in key shown once. Limited per client address so it cannot be used to mass-create orgs.
  const signupOpen = ctx.env?.DELOMU_SIGNUP === 'open';
  // A new account's sign-in key, by session, shown once on the first page and then forgotten.
  const freshKeys = new Map();
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
    const session = signIn(ctx, req, { userId: made.member.user_id, orgId: made.org.id, scopes: null, apiKeyId: made.key.id, email: values.email, via: 'signup', to: '/welcome' });
    if (!ctx.emailLogin) freshKeys.set(session.token, made.secret);
    return session;
  }, { public: true });

  // Sign-in by email link. The answer is the same whether or not the email has an account.
  const emailLimit = createRateLimiter({ capacity: 5, refillPerSec: 1 / 300 });
  r.add('POST', '/login/email', async ({ req }) => {
    if (!ctx.emailLogin) throw notFound('page');
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(parseCookies(req.headers.cookie)[LOGIN_CSRF_COOKIE] ?? '', form);
    const email = String(form.email ?? '').trim().toLowerCase();
    const sent = html(loginPage({ csrf: form.csrf, signup: signupOpen, email: true, sentTo: email }));
    if (!/^[^@s]+@[^@s]+.[^@s]+$/.test(email)) return html(loginPage({ csrf: form.csrf, signup: signupOpen, email: true, error: 'Enter your work email.' }), 400);
    if (!emailLimit(ctx.clientIp(req)).ok || !emailLimit(`e:${email}`).ok) return html(loginPage({ csrf: form.csrf, signup: signupOpen, email: true, error: 'Too many sign-in emails. Try again in a few minutes.' }), 429);
    const secret = createLoginLink(db, email, ctx.now());
    if (secret) {
      try { await sendLoginEmail(ctx.emailLogin, { to: email, link: `${returnBase(req)}/login/email/${secret}` }, ctx.sendEmail); } catch (e) { ctx.log(`login email failed: ${e.message}`); }
    }
    return sent;
  }, { public: true });

  r.add('GET', '/login/email/:token', ({ req, params }) => {
    const who = useLoginLink(db, params.token, ctx.now());
    if (!who) return html(loginPage({ csrf: '', signup: signupOpen, email: Boolean(ctx.emailLogin), error: 'That sign-in link has expired or was already used. Ask for a new one.' }), 400);
    return signIn(ctx, req, { userId: who.userId, orgId: who.orgId, scopes: null, email: who.email, via: 'email' });
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

  // Public pricing, from the same plan table billing charges by.
  r.add('GET', '/pricing', () => html(pricingPage({ signup: signupOpen, plans: PLAN_LIST })), { public: true });
  r.add('GET', '/security', () => html(securityPage({ signup: signupOpen })), { public: true });
  r.add('GET', '/integrations', () => html(integrationsPage({ signup: signupOpen })), { public: true });
  // Design partner applications: stored first, then the operator is told (src/v3/partners.mjs).
  const applyLimit = createRateLimiter({ capacity: 5, refillPerSec: 1 / 600 });
  r.add('GET', '/design-partners', ({ req }) => {
    const token = randomToken();
    return html(designPartnersPage({ signup: signupOpen, csrf: token }), 200, [cookie(LOGIN_CSRF_COOKIE, token, { maxAge: 3600, secure: ctx.secureCookies(req) })]);
  }, { public: true });
  r.add('POST', '/design-partners', async ({ req }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(parseCookies(req.headers.cookie)[LOGIN_CSRF_COOKIE] ?? '', form);
    const { values, error } = readApplication(form);
    const again = (msg, status = 400) => html(designPartnersPage({ signup: signupOpen, csrf: form.csrf, values, error: msg }), status);
    if (!applyLimit(ctx.clientIp(req)).ok) return again('Too many applications from this network. Try again later.', 429);
    if (error) return again(error);
    saveApplication(db, values, ctx.now());
    await notifyApplication(ctx, values);
    return html(designPartnersPage({ signup: signupOpen, sent: values.name.split(' ')[0] }));
  }, { public: true });
  r.add('GET', '/operator/applications', ({ principal }) => {
    if (!principal || !isOperator(ctx.env, principal.email)) throw notFound('page');
    return html(applicationsPage({ rows: listApplications(db) }));
  }, { public: true });
  r.add('GET', '/developers', () => html(developersPage({ signup: signupOpen })), { public: true });
  r.add('GET', '/privacy', () => html(privacyPage({ signup: signupOpen })), { public: true });
  r.add('GET', '/terms', () => html(termsPage({ signup: signupOpen })), { public: true });

  r.add('GET', '/', ({ principal }) => {
    // A signed-out visitor gets the public page; everyone else their home.
    if (!principal) return html(landingPage({ signup: signupOpen, plans: PLAN_LIST, demo: LANDING_DEMO }));
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
    const signinKey = freshKeys.get(principal.token); freshKeys.delete(principal.token);
    return html(homePage({ ...base(principal), nav, deployments, review, signinKey, canWrite: principalAllows(principal, homeRole, 'deployments:write') }));
  }, { public: true });

  // Guided setup (/welcome): where a new account stands on its first rollout. A vendor: client, agent, policies,
  // first check; a company running its own agent: agent, policies, first check. Each step posts to the normal form
  // with next=welcome and comes back here, so the wizard adds no second way to do anything.
  function setupState(principal) {
    const orgs = orgsOf(principal);
    const home = orgs.find(o => o.id === principal.homeOrgId);
    if (!home) return null;
    const vendor = home.kind === 'partner';
    const client = vendor ? orgs.filter(o => o.partner_org_id === home.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null : home;
    const deps = client ? listDeployments(db, ctx.deploymentsRoot, client.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : [];
    const dep = deps[0]?.name ?? null;
    const dir = dep ? deploymentFor(ctx, client.id, dep).dir : null;
    const inputs = dir ? path.join(dir, 'inputs') : null;
    const hasPolicies = Boolean(inputs && fs.existsSync(inputs) && fs.readdirSync(inputs).length);
    const checked = Boolean(dir && listScans(dir).length);
    const steps = [...(vendor ? [{ key: 'client', done: Boolean(client) }] : []), { key: 'agent', done: Boolean(dep) }, { key: 'policies', done: hasPolicies }, { key: 'check', done: checked }];
    return { vendor, home, client, dep, steps, current: steps.find(x => !x.done)?.key ?? 'done' };
  }
  const welcomeView = (principal, extra = {}) => {
    const signinKey = freshKeys.get(principal.token); freshKeys.delete(principal.token);
    return welcomePage({ ...base(principal), state: setupState(principal), signinKey, ...extra });
  };
  r.add('GET', '/welcome', ({ principal }) => {
    const state = setupState(principal);
    if (!state) return new Redirect('/');
    if (state.current === 'done' && state.dep) return new Redirect(`${depPath(state.client, state.dep)}/scan`);
    return html(welcomeView(principal));
  });
  // For a vendor trying Grapim before a real agent is reachable: a sample agent, with its sample policies, inside
  // the client they just named. It is marked as a sample everywhere it shows.
  r.add('POST', '/orgs/:org/sample-agent', async ({ req, principal, params }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    addStoreSample(principal, org, req, 'store');
    return new Redirect('/welcome');
  });

  // An AI vendor's clients: the partner org's own page, one row per client workspace it manages.
  const showClients = (principal, org, role, { url, error, values, status = 200 } = {}) => {
    const clients = orgsOf(principal).filter(o => o.partner_org_id === org.id).map(c => ({ org: c, deployments: deploymentsOf(c) }));
    const signinKey = freshKeys.get(principal.token); freshKeys.delete(principal.token);
    return html(clientsPage({
      ...base(principal), org, clients, own: deploymentsOf(org), error, values,
      nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }),
      canManage: principalAllows(principal, role, 'org:manage'), notice: NOTICES[url?.searchParams.get('notice')], signinKey,
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
      if (form.next === 'welcome') return html(welcomeView(principal, { error: e.message, values: form }), 400);
      return showClients(principal, org, role, { error: e.message, values: form, status: 400 });
    }
    event(ctx, principal, client.id, 'org.create', client.id, { name: client.name, partner_org_id: org.id, via_web: true });
    event(ctx, principal, org.id, 'client.add', client.id, { name: client.name });
    if (form.next === 'welcome') return new Redirect('/welcome');
    return new Redirect(`${orgPath(client)}?notice=client`);
  });

  r.add('GET', '/orgs/:org', ({ principal, params, url }) => {
    const { org, role } = access(ctx, principal, params.org, 'deployments:read');
    if (org.kind === 'partner') return showClients(principal, org, role, { url });
    const signinKey = freshKeys.get(principal.token); freshKeys.delete(principal.token);
    return html(orgPage({
      ...base(principal), org, deployments: deploymentsOf(org), nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }),
      canWrite: principalAllows(principal, role, 'deployments:write'), notice: NOTICES[url.searchParams.get('notice')], signinKey,
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

  // The other sample clients' agents (see sample-industries.mjs): a bank and a telehealth provider.
  r.add('POST', '/demo/agent/:id', async ({ req, params }) => {
    const json = (status, value) => ({ status, body: JSON.stringify(value), type: 'application/json' });
    if (!Object.hasOwn(INDUSTRIES, params.id)) return json(404, { error: 'No such sample agent.' });
    const body = await readJson(req, 16 * 1024).catch(() => ({}));
    const message = body?.body?.message;
    const instructions = typeof body?.body?.instructions === 'string' ? body.body.instructions : '';
    if (!realBot) return json(200, industryScripted(params.id, message));
    if (!botPerClient(ctx.clientIp(req)).ok || !botTotal('all').ok) return json(429, { error: 'The sample agent is busy. Try again in a minute.' });
    try {
      return json(200, await industryAgentAnswer(params.id, message, { ...(ctx.demoBotClient ? { client: ctx.demoBotClient } : {}), instructions }));
    } catch (e) {
      console.error(`sample agent ${params.id} failed: ${e.message}`);
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
      customer: 'Tallyfox (sample)', name, target: { type: 'http', url: `${origin}/demo/support-bot`, body: { message: '{{input}}' }, output: 'reply' },
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
  // industry: 'store' (Linden & Co.) or a key of INDUSTRIES (Quillby Bank, Velmora Health).
  function addStoreSample(principal, org, req, industry = 'store') {
    const ind = INDUSTRIES[industry];
    const client = ind?.client ?? 'Linden & Co.';
    const stem = ind ? `sample-${client.split(' ')[0].toLowerCase()}-agent` : 'sample-linden-agent';
    const taken = new Set(listDeployments(db, ctx.deploymentsRoot, org.id).map(d => d.name));
    let name = stem;
    for (let n = 2; taken.has(name); n++) name = `${stem}-${n}`;
    const origin = ctx.publicUrl ?? `http://${String(req.headers.host ?? '127.0.0.1')}`;
    const config = {
      customer: `${client} (sample)`, name, agentKind: 'support',
      title: `${client} · ${{ bank: 'Max', health: 'Ava' }[industry] ?? 'Lia'}`,
      target: { type: 'http', url: `${origin}${ind ? `/demo/agent/${industry}` : '/demo/store-agent'}`, body: { message: '{{input}}' }, output: 'reply', actions: 'actions' },
      acceptance: { minPassRate: 0.9 }, decisions: [{ date: ctx.now().toISOString().slice(0, 10), decision: 'Client sign-off required before launch', reason: 'Sample client.' }],
    };
    registerDeployment(db, ctx.deploymentsRoot, org.id, { name, config }, { actor: principal.actor, policy: ctx.policy }, ctx.now());
    const { dir } = deploymentFor(ctx, org.id, name);
    fs.mkdirSync(path.join(dir, 'inputs'), { recursive: true });
    for (const f of ind ? industryFiles(industry, origin) : storeSampleFiles(origin)) fs.writeFileSync(path.join(dir, 'inputs', f.name), f.text);
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
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'org:manage');
    if (org.kind !== 'partner') throw notFound('page');
    const industry = Object.hasOwn(INDUSTRIES, form.industry) ? form.industry : 'store';
    const client = createOrg(db, { name: `${INDUSTRIES[industry]?.client ?? 'Linden & Co.'} (sample client)`, kind: 'customer', partnerOrgId: org.id }, ctx.now());
    event(ctx, principal, client.id, 'org.create', client.id, { name: client.name, partner_org_id: org.id, sample: true });
    event(ctx, principal, org.id, 'client.add', client.id, { name: client.name, sample: true });
    return new Redirect(`${depPath(client, addStoreSample(principal, client, req, industry))}/rollout`);
  });

  // The Brightdesk AI demo (demo-portfolio.mjs): three sample clients at three stages of a rollout.
  r.add('POST', '/orgs/:org/clients/demo', async ({ req, principal, params }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    const { org } = access(ctx, principal, params.org, 'org:manage');
    if (org.kind !== 'partner') throw notFound('page');
    for (const { industry, stage, ageHours } of DEMO_CLIENTS) {
      const client = createOrg(db, { name: `${INDUSTRIES[industry]?.client ?? 'Linden & Co.'} (sample client)`, kind: 'customer', partnerOrgId: org.id }, ctx.now());
      event(ctx, principal, org.id, 'client.add', client.id, { name: client.name, sample: true, demo: true });
      const name = addStoreSample(principal, client, req, industry);
      const { dir } = deploymentFor(ctx, client.id, name);
      const scan = seedDemoScan(dir, industry, ctx.now(), ageHours);
      if (stage === 'signoff') createShare(db, { orgId: client.id, deployment: name, purpose: 'signoff', subject: scan.id, createdBy: principal.actor }, ctx.now());
      if (stage === 'accepted') seedDemoAcceptance(dir, scan, ctx.now());
    }
    return new Redirect(`${orgPath(org)}?notice=demo`);
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
    const fail = message => (form.next === 'welcome' ? html(welcomeView(principal, { error: message, values: form }), 400) : html(newDeploymentView(principal, params, message, form), 400));
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
      // Optional: the request field the agent reads extra instructions from, so approved fixes apply directly.
      if (field('instructions_field')) {
        if (!/^[A-Za-z_][\w-]{0,60}$/.test(field('instructions_field')) || field('instructions_field') === 'message') return fail('The instructions field must be a plain field name, such as instructions or system_prompt.');
        target.instructionsField = field('instructions_field');
      }
    }
    const agentKind = Object.hasOwn(AGENT_KINDS, String(form.agentKind ?? '')) ? String(form.agentKind) : 'support';
    const given = String(form.name ?? '').trim();
    const slug = x => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
    const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').split('.').slice(0, -1).join('-') || new URL(u).hostname; } catch { return ''; } };
    const base = given || slug(form.customer) || slug(host(field('url') || field('openai_url'))) || slug(form.type === 'zendesk' ? `zendesk-${field('zendesk_subdomain')}` : form.type) || 'agent';
    const taken = new Set(db.prepare('SELECT name FROM deployments WHERE org_id = ?').all(org.id).map(r => r.name));
    let name = base;
    for (let i = 2; !given && taken.has(name); i++) name = `${base}-${i}`;
    const config = { customer: String(form.customer ?? '').trim() || undefined, name, agentKind, target, acceptance: { minPassRate: pass / 100 }, decisions: [] };
    try {
      const d = registerDeployment(db, ctx.deploymentsRoot, org.id, { name, config }, { actor: principal.actor, policy: ctx.policy }, ctx.now());
      const { dir } = deploymentFor(ctx, org.id, d.name);
      for (const [name, value] of Object.entries(saved)) saveSecret(dir, name, value, ctx.pepper, ctx.now());
      if (Object.keys(saved).length) appendAudit(dir, { actor: principal.actor, action: 'secret.save', target: Object.keys(saved).join(','), detail: {} }, ctx.now());
      event(ctx, principal, org.id, 'deployment.register', d.name, { via_web: true });
      if (form.next === 'welcome') return new Redirect('/welcome');
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
  // Done for the vendor: when a check or re-check leaves rules broken, the agent drafts the fix right away, so
  // the person opens the result to a change ready to approve. Nothing is applied until they approve it.
  async function autoDraftFix(principal, org, name, dir, job) {
    const scan = listScans(dir)[0];
    if (!scan?.summary?.broken) return;
    const f = getFix(dir);
    if (f?.status === 'proposed' && f.scanId === scan.id) return;
    job.progress = { phase: 'fix', broken: scan.summary.broken };
    try {
      const res = await draftFix(dir, { llm: ctx.llm ?? createLlm(), now: ctx.now() });
      if (res.ok) { job.autoFix = true; event(ctx, principal, org.id, 'fix.draft', name, { rules: res.fix.rules.length, via: 'auto' }); }
    } catch (e) { console.error(`could not draft a fix for ${name}: ${e.message}`); }
  }

  async function startScan(principal, org, name, dir, { autoFix = true } = {}) {
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
        return (autoFix ? autoDraftFix(principal, org, name, dir, job) : Promise.resolve()).then(() => { job.status = 'done'; });
      }
    }, e => Object.assign(job, { status: 'failed', error: scanError(e, dir, name) })).finally(() => release());
    return job;
  }
  ctx.startScan = (principal, org, name, dir) => { checkTarget(loadConfig(dir), ctx.policy); return startScan(principal, org, name, dir); };
  ctx.scanJob = dir => scans.get(dir) ?? null;

  r.add('GET', '/orgs/:org/deployments/:name/scan', ({ principal, params, url }) => {
    const ws = workspace(principal, params, 'runs:read', url);
    const job = scans.get(ws.dir);
    const fixArgs = { fix: getFix(ws.dir), fixTarget: instructionsTarget(ws.config) };
    if (job?.status === 'running') return html(riskScanPage({ ...ws, ...fixArgs, job }));
    if (job) scans.delete(ws.dir);
    if (job?.status === 'failed') return html(riskScanPage({ ...ws, ...fixArgs, flash: '', error: job.error }));
    return html(riskScanPage(job?.status === 'done' ? { ...ws, ...fixArgs, flash: job.autoFix ? NOTICES.autofix : job.recheck ? NOTICES.rechecked : NOTICES.scanned } : { ...ws, ...fixArgs }));
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
  const playbookOwner = org => org.partner_org_id ?? org.id;
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
    const play = { root: ctx.deploymentsRoot, pepper: ctx.pepper, ownerId: playbookOwner(org), dir, now: ctx.now() };
    job.done = (async () => {
      for (const step of job.steps) {
        step.state = 'running';
        try {
          if (step.key === 'playbook') {
            if (!playbookStats(play.root, play.ownerId)) { Object.assign(step, { state: 'skipped', detail: 'Your playbook is empty. It fills when a client agrees to reuse at sign-off.' }); continue; }
            let draft = null;
            try { draft = suggestFromPlaybook(play); } catch { /* nothing to match on yet */ }
            if (!draft) { Object.assign(step, { state: 'skipped', detail: 'Nothing in your playbook matches this client yet.' }); continue; }
            event(ctx, principal, org.id, 'agent.draft', `${params.name}/playbook`, { drafts: [draft.id], via: 'rollout' });
            Object.assign(step, { state: 'done', detail: `${draft.content.rows.length} test message${draft.content.rows.length === 1 ? '' : 's'} from earlier clients, waiting for review.` });
            continue;
          }
          if (step.key === 'check') {
            const inputs = path.join(dir, 'inputs');
            if (!fs.existsSync(inputs) || !fs.readdirSync(inputs, { withFileTypes: true }).some(e => e.isFile() && !e.name.toLowerCase().endsWith('.csv'))) {
              Object.assign(step, { state: 'skipped', detail: 'Add the client’s policies to run the check.' });
              continue;
            }
            checkTarget(loadConfig(dir), ctx.policy);
            const scan = await startScan(principal, org, params.name, dir, { autoFix: false });
            await scan.done;
            Object.assign(step, scan.status === 'done' ? { state: 'done', detail: 'Check finished.' } : { state: 'failed', detail: scan.error });
            continue;
          }
          // After the check: the agent drafts one fix for the broken rules (a person approves it, which re-checks the
          // same messages), and once every rule is kept the rollout is ready for the client's sign-off.
          if (step.key === 'fix' || step.key === 'signoff') {
            const checked = job.steps.find(s => s.key === 'check')?.state === 'done';
            const scan = checked ? listScans(dir)[0] : null;
            const broken = scan?.summary?.broken ?? null;
            if (broken == null) { Object.assign(step, { state: 'skipped', detail: 'Needs a finished policy check.' }); continue; }
            if (step.key === 'signoff') {
              Object.assign(step, broken ? { state: 'skipped', detail: 'Waiting for the fix. Once a re-check keeps every rule, send the client the sign-off link above.' } : { state: 'done', detail: 'Every rule kept. Send the client the sign-off link above; they accept without an account.' });
              continue;
            }
            if (!broken) { Object.assign(step, { state: 'skipped', detail: 'No rule broken: nothing to fix.' }); continue; }
            const res = await draftFix(dir, { llm, now: ctx.now() });
            if (!res.ok) { Object.assign(step, { state: 'skipped', detail: `The agent could not draft a fix: ${res.reason}.` }); continue; }
            event(ctx, principal, org.id, 'fix.draft', params.name, { rules: res.fix.rules.length, via: 'rollout' });
            Object.assign(step, { state: 'done', detail: `A fix for ${broken} broken rule${broken === 1 ? '' : 's'} is waiting for your approval on the Check page. Approving it sends the same messages again.` });
            continue;
          }
          const result = await TASKS[step.key](dir, { llm, ...(step.key === 'integration' && { examples: integrationExamples(play) }) });
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
    // A tag makes the hours a manual intervention for Productization health.
    if (normTag(form.tag)) logIntervention(dir, { step: form.step, tag: form.tag, hours, note: form.note ?? '', by: principal.actor }, ctx.now());
    event(ctx, principal, org.id, 'hours.log', params.name, { step: form.step, hours });
    return new Redirect(`${depPath(org, params.name)}/rollout?notice=hours`);
  });

  // Revenue from one client, entered by the vendor: service (onboarding) and software (monthly) revenue.
  r.add('POST', '/orgs/:org/deployments/:name/revenue', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    try {
      setRevenue(dir, form, { actor: principal.actor, now: ctx.now() });
    } catch (e) {
      return showRollout(principal, params, null, { error: e.message }, 400);
    }
    event(ctx, principal, org.id, 'revenue.set', params.name);
    return new Redirect(`${depPath(org, params.name)}/rollout?notice=revenue`);
  });

  // Productization health (src/v3/productization.mjs) for an org and, for an AI vendor, every client it can open.
  const showProductization = (principal, params, url, extra = {}, status = 200) => {
    const { org, role } = access(ctx, principal, params.org, 'deployments:read');
    const orgs = org.kind === 'partner' ? [org, ...orgsOf(principal).filter(o => o.partner_org_id === org.id)] : [org];
    const rows = orgs.flatMap(deploymentsOf);
    const settings = getOrgSettings(ctx.deploymentsRoot, org.id);
    const h = productizationHealth({ rows, m: deploymentMetrics(rows), settings, now: ctx.now() });
    return html(productizationPage({ ...base(principal), org, h, settings, canManage: principalAllows(principal, role, 'org:manage'), error: extra.error, notice: NOTICES[url?.searchParams.get('notice')], nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }) }), status);
  };
  r.add('GET', '/orgs/:org/productization', ({ principal, params, url }) => showProductization(principal, params, url));
  r.add('POST', '/orgs/:org/productization', async ({ req, principal, params }) => {
    const { form, all } = await readFormAll(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'org:manage');
    try {
      setOrgSettings(ctx.deploymentsRoot, org.id, { teamSize: form.teamSize, kinds: all('kinds'), industry: form.industry ?? '', connections: all('connections') });
    } catch (e) {
      return showProductization(principal, params, null, { error: e.message }, 400);
    }
    event(ctx, principal, org.id, 'productization.settings', org.id);
    return new Redirect(`${orgPath(org)}/productization?notice=focus`);
  });

  // The assistant (src/v3/assistant.mjs). It answers about the page the person is on (from: that page's path)
  // and proposes actions that become links or forms for the routes below; it never runs anything itself.
  // Conversations are kept per session, in memory, for the last 12 messages (MAX_HISTORY).
  const assistantChats = new Map();
  const assistantLimit = createRateLimiter({ capacity: 15, refillPerSec: 1 / 8 });
  const assistantJson = (status, value) => ({ status, body: JSON.stringify(value), type: 'application/json' });
  function assistantScope(principal, from) {
    const m = /^\/orgs\/([^/?#]+)(?:\/deployments\/([^/?#]+))?/.exec(String(from ?? ''));
    let org, role;
    try { ({ org, role } = access(ctx, principal, m ? decodeURIComponent(m[1]) : principal.homeOrgId, 'deployments:read')); } catch { ({ org, role } = access(ctx, principal, principal.homeOrgId, 'deployments:read')); }
    const canWrite = principalAllows(principal, role, 'deployments:write');
    const vendor = org.partner_org_id ? orgsOf(principal).find(o => o.id === org.partner_org_id) : null;
    const orgBase = orgPath(vendor ?? org);
    const page = String(from ?? '').slice(0, 200) || '/';
    const name = m?.[2] ? decodeURIComponent(m[2]) : null;
    const row = name ? deploymentsOf(org).find(d => d.name === name) : null;
    if (row) {
      return { page, canWrite, orgBase, label: `${org.name} · ${row.name}`, deployment: deploymentContext(row), base: ref => (ref === 'this' || ref === row.name ? depPath(org, row.name) : null) };
    }
    const orgs = org.kind === 'partner' ? [org, ...orgsOf(principal).filter(o => o.partner_org_id === org.id)] : [org];
    const rows = orgs.flatMap(deploymentsOf);
    return { page, canWrite, orgBase, label: org.name, org: orgContext({ org, rows }), base: ref => { const i = /^d(\d+)$/.exec(String(ref))?.[1]; const r = i ? rows[Number(i) - 1] : rows.find(x => x.name === ref); return r ? depPath(r.org, r.name) : null; } };
  }
  async function assistantTurn(principal, from, message) {
    const scope = assistantScope(principal, from);
    const history = assistantChats.get(principal.token) ?? [];
    let answer;
    try {
      answer = await askAssistant({ llm: ctx.llm ?? createLlm(), scope, history, message });
    } catch (e) {
      answer = { reply: isAuthError(e) ? 'The assistant has no model credentials on this server.' : 'I couldn’t answer just now. Try again in a moment.', actions: [] };
    }
    const actions = resolveActions(answer.actions, scope);
    const next = [...history, { role: 'user', text: message }, { role: 'assistant', text: answer.reply, actions }].slice(-MAX_HISTORY);
    assistantChats.set(principal.token, next);
    if (assistantChats.size > 5000) assistantChats.delete(assistantChats.keys().next().value);
    return { reply: answer.reply, actions, label: scope.label };
  }
  const readMessage = form => String(form.message ?? '').trim().slice(0, MAX_MESSAGE);

  r.add('GET', '/assistant/state', ({ principal, url }) => {
    const scope = assistantScope(principal, url.searchParams.get('from'));
    return assistantJson(200, { label: scope.label, suggestions: assistantSuggestions(scope), history: assistantChats.get(principal.token) ?? [] });
  });
  r.add('POST', '/assistant/ask', async ({ req, principal }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const message = readMessage(form);
    if (!message) return assistantJson(400, { error: 'Type a question first.' });
    if (!assistantLimit(principal.token).ok) return assistantJson(429, { error: 'That’s a lot of questions at once. Try again in a minute.' });
    return assistantJson(200, await assistantTurn(principal, form.from, message));
  });
  r.add('POST', '/assistant/clear', async ({ req, principal }) => {
    requireCsrf(principal, await readForm(req, ctx.maxBodyBytes));
    assistantChats.delete(principal.token);
    return assistantJson(200, { ok: true });
  });
  // The same assistant as a page, for browsers without JavaScript.
  r.add('GET', '/assistant', ({ principal, url }) => {
    const from = url.searchParams.get('from') ?? '';
    const scope = assistantScope(principal, from);
    return html(assistantPage({ ...base(principal), nav: navFor(principal), from, label: scope.label, suggestions: assistantSuggestions(scope), history: assistantChats.get(principal.token) ?? [] }));
  });
  r.add('POST', '/assistant', async ({ req, principal }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const message = readMessage(form);
    if (message && assistantLimit(principal.token).ok) await assistantTurn(principal, form.from, message);
    return new Redirect(`/assistant?from=${encodeURIComponent(String(form.from ?? ''))}`);
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
    const open = activeShares(db, ws.org.id, params.name, 'signoff', ctx.now());
    // The newest time any open link was opened by a person (preview bots are not counted).
    const opened = open.map(x => x.last_opened_at).filter(Boolean).sort().at(-1) ?? null;
    const signoff = { latest: latestSignoff(ws.dir), active: open.length, opened, link: extra.link ?? fresh };
    const owner = playbookOwner(ws.org);
    const playbook = { stats: playbookStats(ctx.deploymentsRoot, owner), consent: consentOf(ws.dir), contributed: contributed(ctx.deploymentsRoot, ctx.pepper, owner, ws.dir), vendor: ws.org.partner_org_id ? getOrg(db, ws.org.partner_org_id)?.name : ws.org.name };
    const tags = [...new Set(readInterventions(ws.dir).map(i => i.tag))].slice(0, 30);
    const monitor = { settings: monitorSettings(ws.dir), status: monitorStatus(ws.dir), hasTests: fs.existsSync(path.join(ws.dir, 'tests.json')), intervals: MONITOR_INTERVALS };
    return html(rolloutPage({ ...ws, rollout: job, signoff, playbook, monitor, tags, connector: readConnector(ws.dir), recording: readRecording(ws.dir), revenue: getRevenue(ws.dir), error: extra.error, refresh: job?.status === 'running' ? 3 : 0 }), status);
  };
  r.add('GET', '/orgs/:org/deployments/:name/rollout', ({ principal, params, url }) => showRollout(principal, params, url));

  // A recorded browser session (HAR) as connector material (src/v1/recording.mjs): summarized on arrival, raw file
  // never stored. action=remove deletes the summary.
  r.add('POST', '/orgs/:org/deployments/:name/recording', async ({ req, principal, params, url }) => {
    const type = String(req.headers['content-type'] ?? '');
    const form = type.startsWith('multipart/form-data')
      ? await new Response(await readRaw(req, MAX_RECORDING_BYTES), { headers: { 'content-type': type } }).formData()
      : new Map(Object.entries(await readForm(req, ctx.maxBodyBytes)));
    requireCsrf(principal, { csrf: form.get('csrf') });
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const page = `${depPath(org, params.name)}/rollout`;
    if (form.get('action') === 'remove') {
      removeRecording(dir, { actor: principal.actor, now: ctx.now() });
      return new Redirect(`${page}?notice=recordingremoved#more`);
    }
    const file = form.get('har');
    if (!file || typeof file !== 'object' || !file.size) return showRollout(principal, params, url, { error: 'Choose the HAR file you saved from the browser.' }, 400);
    const summary = summarizeHar(await file.text(), { now: ctx.now() });
    if (!summary.ok) return showRollout(principal, params, url, { error: `Grapim could not use this recording: ${summary.reason}.` }, 400);
    saveRecording(dir, summary, { actor: principal.actor, now: ctx.now() });
    event(ctx, principal, org.id, 'recording.add', params.name, { endpoints: summary.endpoints, calls: summary.calls });
    return new Redirect(`${page}?notice=recorded#more`);
  });

  // Step 6 (src/v3/monitoring.mjs): turn regression monitoring on or off, or check this deployment now.
  r.add('POST', '/orgs/:org/deployments/:name/monitor', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    try {
      if (form.action === 'check') {
        const [r] = await monitorTick(ctx, [{ orgId: org.id, name: params.name, dir }]);
        if (r?.error) return showRollout(principal, params, null, { error: `The monitor could not run: ${String(r.error).split(dir).join(params.name)}` }, 400);
        event(ctx, principal, org.id, 'monitor.check', params.name, { ran: Boolean(r?.ran) });
        return new Redirect(`${depPath(org, params.name)}/rollout?notice=${r?.ran ? 'monitorran' : 'monitorchecked'}`);
      }
      const settings = setMonitor(dir, { enabled: form.enabled === '1', intervalHours: form.intervalHours, versionUrl: form.versionUrl, versionPath: form.versionPath }, { actor: principal.actor, now: ctx.now() });
      event(ctx, principal, org.id, settings.enabled ? 'monitor.on' : 'monitor.off', params.name, { intervalHours: settings.intervalHours });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      return showRollout(principal, params, null, { error: String(e.message ?? e).split(dir).join(params.name) }, 400);
    }
    return new Redirect(`${depPath(org, params.name)}/rollout?notice=monitor`);
  });

  // The playbook (src/v3/playbook.mjs): record that the client agreed to reuse elsewhere (a contract, an email),
  // withdraw it, which removes this rollout's entries, or refresh them after the rollout changed.
  r.add('POST', '/orgs/:org/deployments/:name/playbook', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const play = { root: ctx.deploymentsRoot, pepper: ctx.pepper, ownerId: playbookOwner(org), dir, now: ctx.now() };
    const action = String(form.action ?? '');
    try {
      if (action === 'consent') {
        const by = String(form.by ?? '').trim();
        if (!by) return showRollout(principal, params, null, { error: 'Enter who at the client agreed, and how (for example “Dana Lee, contract clause 4”).' }, 400);
        if (form.confirm !== 'yes') return showRollout(principal, params, null, { error: 'Confirm that the client agreed before adding their rollout to your playbook.' }, 400);
        setConsent(dir, { consent: true, by, names: [org.name, loadConfig(dir).customer].filter(Boolean), actor: principal.actor }, ctx.now());
        const res = addToPlaybook({ ...play, by: principal.email });
        event(ctx, principal, org.id, 'playbook.add', params.name, { entries: res.added });
      } else if (action === 'refresh') {
        const res = addToPlaybook({ ...play, by: principal.email });
        event(ctx, principal, org.id, 'playbook.add', params.name, { entries: res.added });
      } else if (action === 'withdraw') {
        setConsent(dir, { consent: false, actor: principal.actor }, ctx.now());
        const res = removeFromPlaybook(play);
        event(ctx, principal, org.id, 'playbook.remove', params.name, { entries: res.removed });
      } else throw new ApiError('invalid_request_error', 'Unknown playbook action.');
    } catch (e) {
      if (e instanceof ApiError) throw e;
      return showRollout(principal, params, null, { error: `The playbook could not be updated: ${String(e.message ?? e).split(dir).join(params.name)}` }, 400);
    }
    return new Redirect(`${depPath(org, params.name)}/rollout?notice=playbook`);
  });

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
    if (!share) {
      // A revoked or expired link says so and names who to ask; an unknown one stays a plain 404.
      const dead = deadShare(db, token, 'signoff', ctx.now());
      if (!dead) throw notFound('sign-off link');
      const org = getOrg(db, dead.share.org_id);
      const vendor = org?.partner_org_id ? getOrg(db, org.partner_org_id) : null;
      const contact = /^human:([^@\s]+@[^@\s]+)$/.exec(dead.share.created_by ?? '')?.[1] ?? '';
      throw new Responded(html(signoffGonePage({ reason: dead.reason, preparedBy: (vendor ?? org)?.name ?? 'the team', client: vendor ? org.name : '', contact }), 410));
    }
    const org = getOrg(db, share.org_id);
    const vendor = org?.partner_org_id ? getOrg(db, org.partner_org_id) : null;
    const { dir } = deploymentFor(ctx, share.org_id, share.deployment);
    let config = {};
    try { config = loadConfig(dir); } catch { /* the page works without it */ }
    const launch = fs.existsSync(path.join(dir, 'launch-summary.md')) ? fs.readFileSync(path.join(dir, 'launch-summary.md'), 'utf8').slice(0, 8000) : '';
    const done = signoffs(dir).find(s => s.shareId === share.id) ?? null;
    const scan = getScan(dir, share.subject);
    const view = { token, preparedBy: (vendor ?? org).name, client: vendor ? org.name : config.customer ?? org.name, name: share.deployment };
    return { share, org, dir, config, scan, launch, done, view: { ...view, handover: scan ? handoverData(dir, { scan, ...view }) : null } };
  }

  r.add('GET', '/signoff/:token', ({ req, params }) => {
    const c = signoffContext(params.token);
    if (!isPreviewBot(req.headers['user-agent'])) markOpened(db, c.share.id, ctx.now());
    const csrf = randomToken();
    return html(signoffPage({ ...c.view, csrf, scan: c.scan, launch: c.launch, done: c.done }), 200, [cookie(SIGNOFF_CSRF, csrf, { maxAge: 3600, secure: ctx.secureCookies(req), path: '/signoff' })]);
  }, { public: true });

  r.add('GET', '/signoff/:token/handover', ({ params }) => {
    const c = signoffContext(params.token);
    if (!c.view.handover) throw notFound('check');
    return html(handoverPage(c.view.handover, { back: `/signoff/${params.token}` }));
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
    const values = { name: String(form.name ?? '').trim(), decision: form.decision === 'declined' ? 'declined' : 'accepted', note: String(form.note ?? ''), reuse: form.reuse === 'yes' };
    const again = (error, status) => html(signoffPage({ ...c.view, csrf: form.csrf, scan: c.scan, launch: c.launch, error, values }), status);
    if (c.done || !c.scan) return html(signoffPage({ ...c.view, csrf: form.csrf, scan: c.scan, launch: c.launch, done: c.done }), 409);
    if (!signoffLimit(ctx.clientIp(req)).ok) return again('Too many attempts from this network. Try again in a few minutes.', 429);
    if (!values.name) return again('Enter your name so the team knows who decided.', 400);
    const done = recordSignoff(c.dir, { ...values, scanId: c.scan.id, shareId: c.share.id, ip: ctx.clientIp(req) }, ctx.now());
    recordEvent(db, { orgId: c.share.org_id, actor: `client:${done.name}`, action: `signoff.${done.decision}`, target: c.share.deployment, detail: { scan: c.scan.id, share: c.share.id }, ip: ctx.clientIp(req) }, ctx.now());
    if (values.reuse && done.decision === 'accepted') {
      try {
        setConsent(c.dir, { consent: true, by: `${done.name} (sign-off)`, names: [c.org.name, c.config.customer, done.name].filter(Boolean), actor: `client:${done.name}` }, ctx.now());
        const res = addToPlaybook({ root: ctx.deploymentsRoot, pepper: ctx.pepper, ownerId: playbookOwner(c.org), dir: c.dir, by: `client:${done.name}`, now: ctx.now() });
        recordEvent(db, { orgId: c.share.org_id, actor: `client:${done.name}`, action: 'playbook.add', target: c.share.deployment, detail: { entries: res.added }, ip: ctx.clientIp(req) }, ctx.now());
      } catch (e) { ctx.log(`playbook harvest failed for ${c.share.deployment}: ${e.message}`); }
    }
    return html(signoffPage({ ...c.view, csrf: form.csrf, scan: c.scan, launch: c.launch, done }));
  }, { public: true });

  // The fix loop (src/v1/fix.mjs): the agent drafts one change to the AI's instructions for the broken rules,
  // a person edits and approves it, Grapim applies it where it can, and the same messages run again.
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

  // A person overrules the judge on one answer: marks it kept or broken, or puts the judge's verdict back.
  r.add('POST', '/orgs/:org/deployments/:name/scans/:scan/verdict', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    try {
      setOverride(dir, { scanId: params.scan, ruleId: String(form.rule ?? ''), index: Number(form.index), status: String(form.status ?? ''), note: form.note, actor: principal.actor, now: ctx.now() });
    } catch (e) {
      return html(riskScanPage({ ...workspace(principal, params, 'runs:read'), fix: getFix(dir), fixTarget: instructionsTarget(loadConfig(dir)), error: e.message }), 400);
    }
    event(ctx, principal, org.id, 'verdict.override', `${params.name}/${params.scan}`, { rule: String(form.rule ?? ''), status: String(form.status ?? '') });
    return new Redirect(`${depPath(org, params.name)}/scan?notice=verdict#r-${encodeURIComponent(String(form.rule ?? ''))}`);
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
      else {
        event(ctx, principal, org.id, 'scan.recheck', `${name}/${result.scan.id}`, { broken: result.scan.summary.broken });
        // A fix Grapim applied that left more rules or answers broken is undone at once, so a bad fix never stays
        // live while someone reads the result. The page says so; the person can still draft a new fix.
        try {
          if (undoIfWorse(dir, result.scan, getScan(dir, result.scan.recheckOf), { now: ctx.now() })) { job.autoReverted = true; event(ctx, principal, org.id, 'fix.revert', name, { automatic: true }); }
        } catch (e) { console.error(`could not undo the fix for ${name}: ${e.message}`); }
        return autoDraftFix(principal, org, name, dir, job).then(() => { job.status = 'done'; });
      }
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
  r.add('GET', '/orgs/:org/deployments/:name/inputs', ({ principal, params, url }) => {
    const ws = workspace(principal, params, 'deployments:read', url);
    return html(inputsPage({ ...ws, imports: importState(ws.dir) }));
  });
  const showSettings = (principal, params, url, link) => {
    const ws = workspace(principal, params, 'deployments:read', url);
    const verified = activeShares(db, ws.org.id, params.name, 'verified', ctx.now()).length > 0;
    return html(settingsPage({ ...ws, keys: savedSecrets(ws.dir), mcpUrl: `${ctx.publicUrl ?? 'https://YOUR-GRAPIM'}/mcp`, verified: { on: verified, link, canManage: ws.can.manage } }));
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
  // The client's security and AI questionnaire (src/v3/questionnaire.mjs): answers from this agent's records, the
  // vendor's own answers to the rest, and a CSV to paste into the client's spreadsheet.
  const qnView = (principal, params, extra = {}) => {
    const { org, role } = access(ctx, principal, params.org, 'runs:read');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    let config = {};
    try { config = loadConfig(dir); } catch { /* the page works without it */ }
    const vendor = org.partner_org_id ? getOrg(db, org.partner_org_id) : null;
    const base = `${depPath(org, params.name)}/questionnaire`;
    return { dir, org, rows: buildQuestionnaire(dir, { now: ctx.now() }), preparedBy: (vendor ?? org).name, client: vendor ? org.name : config.customer ?? org.name, name: params.name,
      csrf: principal.csrf, canEdit: principalAllows(principal, role, 'deployments:write'), action: base, back: `${depPath(org, params.name)}/rollout`, ...extra };
  };
  r.add('GET', '/orgs/:org/deployments/:name/questionnaire', ({ principal, params, url }) => html(questionnairePage(qnView(principal, params, { saved: url.searchParams.get('notice') === 'saved' }))));
  r.add('GET', '/orgs/:org/deployments/:name/questionnaire.csv', ({ principal, params }) => {
    const v = qnView(principal, params);
    return { status: 200, body: questionnaireCsv(v.rows), type: 'text/csv; charset=utf-8', headers: { 'content-disposition': `attachment; filename="questionnaire-${params.name}.csv"` } };
  });
  r.add('POST', '/orgs/:org/deployments/:name/questionnaire', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    saveVendorAnswers(dir, form);
    appendAudit(dir, { actor: principal.actor, action: 'questionnaire.save', target: 'vendor answers' }, ctx.now());
    return new Redirect(`${depPath(org, params.name)}/questionnaire?notice=saved`);
  });

  // The handover for the client's team (src/v3/handover.mjs), printable.
  r.add('GET', '/orgs/:org/deployments/:name/handover', ({ principal, params }) => {
    const { org } = access(ctx, principal, params.org, 'runs:read');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    let config = {};
    try { config = loadConfig(dir); } catch { /* the page works without it */ }
    const vendor = org.partner_org_id ? getOrg(db, org.partner_org_id) : null;
    return html(handoverPage(handoverData(dir, { preparedBy: (vendor ?? org).name, client: vendor ? org.name : config.customer ?? org.name, name: params.name }), { back: `${depPath(org, params.name)}/rollout` }));
  });

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
    const toWelcome = form.get('next') === 'welcome';
    const fail = message => (toWelcome ? html(welcomeView(principal, { error: message }), 400) : html(inputsPage({ ...workspace(principal, params, 'deployments:read'), error: message, imports: importState(dir) }), 400));
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
    if (toWelcome && !checked) return new Redirect('/welcome');
    return afterInputs(principal, org, params.name, dir, checked, before, 'uploaded');
  });

  // New policy wording can make the last check's rules stale: check again right away, within plan limits.
  async function afterInputs(principal, org, name, dir, checked, before, notice) {
    if (checked && policyFingerprint(dir) !== before) {
      try {
        checkTarget(loadConfig(dir), ctx.policy);
        await startScan(principal, org, name, dir);
        appendAudit(dir, { actor: 'system', action: 'scan.auto', target: 'policies changed' }, ctx.now());
        return new Redirect(`${depPath(org, name)}/scan?notice=policychange`);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        return new Redirect(`${depPath(org, name)}/inputs?notice=policystale`);
      }
    }
    return new Redirect(`${depPath(org, name)}/inputs?notice=${notice}`);
  }

  // Read-only import (src/v3/importers.mjs): tickets, help-center articles and store policies straight from the
  // client's Zendesk, Intercom or Shopify. The token is saved encrypted, so "Import again" needs nothing typed.
  const importSecret = source => `IMPORT_${source.toUpperCase()}_TOKEN`;
  r.add('POST', '/orgs/:org/deployments/:name/import', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const source = String(form.source ?? '');
    const fail = message => html(inputsPage({ ...workspace(principal, params, 'deployments:read'), error: message, imports: importState(dir) }), 400);
    if (!Object.hasOwn(IMPORT_SOURCES, source)) return fail('Choose Zendesk, Intercom or Shopify.');
    const raw = readRawJson(dir);
    const saved = raw.imports?.[source] ?? {};
    const fields = Object.fromEntries(IMPORT_SOURCES[source].fields.map(f => [f, String(form[f] ?? saved[f] ?? '').trim()]));
    let token = String(form.token ?? '').trim();
    const oauth = !token && source === 'zendesk' && saved.auth === 'oauth';
    if (!token) { try { token = readSecret(dir, importSecret(source), ctx.pepper) ?? ''; } catch { token = ''; } }
    let result;
    try {
      result = await runImport(dir, source, { ...fields, token, oauth });
    } catch (e) {
      return fail(String(e.message ?? e).split(token || '\u0000').join('[token]'));
    }
    if (!result.files.length) return fail(`Nothing to import: ${IMPORT_SOURCES[source].label} returned no solved tickets, articles or policies.`);
    const checked = listScans(dir)[0];
    const before = policyFingerprint(dir);
    const inputs = path.join(dir, 'inputs');
    fs.mkdirSync(inputs, { recursive: true });
    for (const f of result.files) {
      const name = cleanInputName(f.name);
      if (!name) continue;
      fs.writeFileSync(path.join(inputs, name), f.text);
      appendAudit(dir, { actor: principal.actor, action: 'input.import', target: name, detail: { source, bytes: Buffer.byteLength(f.text) } }, ctx.now());
    }
    if (form.token) saveSecret(dir, importSecret(source), token, ctx.pepper, ctx.now());
    raw.imports = { ...(raw.imports ?? {}), [source]: { ...saved, ...fields, ...(form.token && { auth: 'token' }), at: ctx.now().toISOString(), ...result.summary } };
    fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify(raw, null, 2) + '\n');
    event(ctx, principal, org.id, 'input.import', params.name, { source, ...result.summary });
    return afterInputs(principal, org, params.name, dir, checked, before, 'imported');
  });

  // The OAuth client for a deployment: Grapim's own (one click) or the one the customer made in their Zendesk.
  const zendeskClient = (dir, zd) => {
    if (zd.app && ctx.zendeskApp) return ctx.zendeskApp;
    let clientSecret = '';
    try { clientSecret = readSecret(dir, 'IMPORT_ZENDESK_CLIENT_SECRET', ctx.pepper) ?? ''; } catch {}
    return { clientId: zd.clientId, clientSecret };
  };

  // Runs an import; a Zendesk OAuth token that expired is refreshed once with the saved refresh token.
  async function runImport(dir, source, creds) {
    const opts = { limit: 50, ...(ctx.importJson && { fetchJson: ctx.importJson }) };
    try {
      return await importFrom(source, creds, opts);
    } catch (e) {
      if (!creds.oauth || e.status !== 401) throw e;
      const s = n => { try { return readSecret(dir, n, ctx.pepper) ?? ''; } catch { return ''; } };
      const refreshToken = s('IMPORT_ZENDESK_REFRESH');
      if (!refreshToken) throw e;
      const zd = readRawJson(dir).imports?.zendesk ?? {};
      const t = await zendeskToken({ subdomain: zd.subdomain, ...zendeskClient(dir, zd), refreshToken }, { ...(ctx.oauthJson && { fetchJson: ctx.oauthJson }) });
      saveSecret(dir, importSecret('zendesk'), t.accessToken, ctx.pepper, ctx.now());
      if (t.refreshToken) saveSecret(dir, 'IMPORT_ZENDESK_REFRESH', t.refreshToken, ctx.pepper, ctx.now());
      return importFrom(source, { ...creds, token: t.accessToken }, opts);
    }
  }

  // Connect Zendesk with OAuth: the person creates an OAuth client in their Zendesk, gives Grapim its ID and
  // secret, and clicks Allow in Zendesk. Pending connections live in memory for 10 minutes, bound to the person.
  const zendeskStates = new Map();
  const zendeskRedirect = req => `${ctx.publicUrl ?? `http://${req.headers.host}`}/oauth/zendesk/callback`;
  r.add('POST', '/orgs/:org/deployments/:name/import/zendesk/connect', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const fail = message => html(inputsPage({ ...workspace(principal, params, 'deployments:read'), error: message, imports: importState(dir) }), 400);
    const raw = readRawJson(dir);
    const zd = raw.imports?.zendesk ?? {};
    const subdomain = String(form.subdomain ?? zd.subdomain ?? '').trim().toLowerCase().replace(/\.zendesk\.com$/, '');
    // One click: no client fields sent and Grapim has its own client. Otherwise the customer's own client.
    const app = Boolean(ctx.zendeskApp) && !String(form.client_id ?? '').trim();
    const clientId = app ? ctx.zendeskApp.clientId : String(form.client_id ?? zd.clientId ?? '').trim();
    const secret = app ? '' : String(form.client_secret ?? '').trim();
    if (!subdomain) return fail('Enter your Zendesk subdomain: the part before .zendesk.com.');
    if (!clientId) return fail('Enter the OAuth client’s unique identifier from Zendesk.');
    if (!app && !secret && !savedSecrets(dir).some(k => k.name === 'IMPORT_ZENDESK_CLIENT_SECRET')) return fail('Paste the OAuth client’s secret from Zendesk.');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const state = crypto.randomBytes(24).toString('base64url');
    let url;
    try {
      url = zendeskAuthorizeUrl({ subdomain, clientId, redirectUri: zendeskRedirect(req), state, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') });
    } catch (e) { return fail(e.message); }
    if (secret) saveSecret(dir, 'IMPORT_ZENDESK_CLIENT_SECRET', secret, ctx.pepper, ctx.now());
    raw.imports = { ...(raw.imports ?? {}), zendesk: app ? { ...zd, subdomain, app: true, clientId: undefined } : { ...zd, subdomain, clientId, app: undefined } };
    fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify(raw, null, 2) + '\n');
    for (const [k, v] of zendeskStates) if (v.exp < Date.now()) zendeskStates.delete(k);
    zendeskStates.set(state, { actor: principal.actor, orgId: org.id, name: params.name, verifier, redirectUri: zendeskRedirect(req), exp: Date.now() + 10 * 60_000 });
    return new Redirect(url);
  });

  r.add('GET', '/oauth/zendesk/callback', async ({ principal, url }) => {
    const pending = zendeskStates.get(url.searchParams.get('state') ?? '');
    zendeskStates.delete(url.searchParams.get('state') ?? '');
    if (!pending || pending.exp < Date.now() || pending.actor !== principal.actor) throw new ApiError('invalid_request_error', 'This Zendesk connection link expired. Start it again from the Policies page.');
    const { org } = access(ctx, principal, pending.orgId, 'deployments:write');
    const { dir } = deploymentFor(ctx, org.id, pending.name);
    const back = notice => new Redirect(`${depPath(org, pending.name)}/inputs?notice=${notice}`);
    if (url.searchParams.get('error') || !url.searchParams.get('code')) return back('zendesk-denied');
    const raw = readRawJson(dir);
    const zd = raw.imports?.zendesk ?? {};
    let t;
    try {
      t = await zendeskToken({ subdomain: zd.subdomain, ...zendeskClient(dir, zd), code: url.searchParams.get('code'), verifier: pending.verifier, redirectUri: pending.redirectUri }, { ...(ctx.oauthJson && { fetchJson: ctx.oauthJson }) });
    } catch (e) {
      return html(inputsPage({ ...workspace(principal, { org: org.id, name: pending.name }, 'deployments:read'), error: e.message, imports: importState(dir) }), 400);
    }
    saveSecret(dir, importSecret('zendesk'), t.accessToken, ctx.pepper, ctx.now());
    if (t.refreshToken) saveSecret(dir, 'IMPORT_ZENDESK_REFRESH', t.refreshToken, ctx.pepper, ctx.now());
    raw.imports = { ...(raw.imports ?? {}), zendesk: { ...zd, auth: 'oauth', connectedAt: ctx.now().toISOString() } };
    fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify(raw, null, 2) + '\n');
    appendAudit(dir, { actor: principal.actor, action: 'import.connect', target: 'zendesk', detail: { subdomain: zd.subdomain } }, ctx.now());
    event(ctx, principal, org.id, 'import.connect', pending.name, { source: 'zendesk' });
    return back('zendesk-connected');
  });

  const readRawJson = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8')); } catch { return {}; } };
  // What each source last imported, and whether its token is saved, for the Policies page.
  const importState = dir => {
    const raw = readRawJson(dir);
    const keys = new Set(savedSecrets(dir).map(k => k.name));
    return { ...Object.fromEntries(Object.keys(IMPORT_SOURCES).map(s => [s, { ...(raw.imports?.[s] ?? {}), saved: keys.has(importSecret(s)) }])), zendeskRedirect: `${ctx.publicUrl ?? ''}/oauth/zendesk/callback`, zendeskOneClick: Boolean(ctx.zendeskApp) };
  };

  // The connector's generated code and tool definitions, for the vendor to drop into its agent.
  r.add('GET', '/orgs/:org/deployments/:name/connector.js', ({ req, principal, params }) => {
    const { org } = access(ctx, principal, params.org, 'deployments:read');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const c = readConnector(dir);
    if (!c) throw notFound('connector');
    let client = '';
    try { client = loadConfig(dir).customer ?? ''; } catch { /* optional */ }
    const code = generateConnectorCode(c, { client: client || org.name, guardUrl: `${returnBase(req)}/v1/orgs/${org.id}/deployments/${params.name}/guard` });
    return { status: 200, body: code, type: 'text/javascript; charset=utf-8', headers: { 'content-disposition': `attachment; filename="${params.name}-connector.mjs"` } };
  });
  r.add('GET', '/orgs/:org/deployments/:name/connector-tools.json', ({ principal, params }) => {
    const { org } = access(ctx, principal, params.org, 'deployments:read');
    const c = readConnector(deploymentFor(ctx, org.id, params.name).dir);
    if (!c) throw notFound('connector');
    return { status: 200, body: JSON.stringify(toolSchemas(c), null, 2) + '\n', type: 'application/json', headers: { 'content-disposition': `attachment; filename="${params.name}-tools.json"` } };
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
  const BILLING_NOTICES = { success: 'Thanks. Your plan changes as soon as Stripe confirms the payment, usually within a few seconds.', cancelled: '', renamed: 'Organization renamed.' };

  const showBilling = (principal, params, url, error, status = 200) => {
    const { org } = access(ctx, principal, params.org, 'org:manage');
    const role = roleIn(db, principal, org.id);
    return html(billingPage({
      ...base(principal), org, billing: ctx.billing.summary(org.id), salesContact: ctx.env.DELOMU_SALES_CONTACT ?? '',
      nav: navFor(principal, { canAudit: principalAllows(principal, role, 'audit:read') }),
      flash: BILLING_NOTICES[url?.searchParams.get('checkout')] ?? '', error,
    }), status);
  };

  // Rename an organization (owners and admins). Its links keep working: the slug does not change.
  r.add('POST', '/orgs/:org/name', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'org:manage');
    const renamed = renameOrg(db, org.id, form.name);
    event(ctx, principal, org.id, 'org.rename', org.id, { name: renamed.name });
    return new Redirect(`${orgPath(org)}/billing?checkout=renamed`);
  });

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
      if (e instanceof Responded) return respond(res, e.out);
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
