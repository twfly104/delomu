// The web UI: sign in (SSO or API key), organizations, deployments, runs with report links, draft
// review and the audit page. Cookie sessions; every state-changing form POST checks a CSRF token.
// Authorization goes through the same operations.mjs checks as the JSON API.

import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { accessibleOrgs, getOrgBySlug } from './accounts.mjs';
import { recordEvent, listEvents } from './events.mjs';
import { ApiError, cookie, createRouter, notFound, parseCookies, readForm, send } from './http.mjs';
import { authenticateKey } from './keys.mjs';
import { auditPage, deploymentPage, deploymentsPage, draftsPage, errorPage, loginPage, orgPath, orgsPage } from './html.mjs';
import { access, deploymentAudits, deploymentFor, draftOf, draftsOf, event, reviewDeploymentDraft } from './operations.mjs';
import { principalAllows, roleIn } from './rbac.mjs';
import { createSession, deleteSession, getSession, randomToken, sameSecret, SESSION_COOKIE, SESSION_TTL_MS } from './sessions.mjs';
import { OidcError } from './oidc.mjs';
import { finishLogin, getOidcConfig, LOGIN_TTL_MS, startLogin, STATE_COOKIE } from './sso.mjs';
import { listDeployments, listRuns, reportFile } from './workspace.mjs';

const LOGIN_CSRF_COOKIE = 'delomu_login_csrf';
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'";
const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

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

function routes(ctx) {
  const r = createRouter();
  const { db } = ctx;
  const page = (principal, fn) => fn({ user: principal, csrf: principal.csrf });

  r.add('GET', '/login', ({ req }) => {
    const token = randomToken();
    return html(loginPage({ csrf: token }), 200, [cookie(LOGIN_CSRF_COOKIE, token, { maxAge: 3600, secure: ctx.secureCookies(req) })]);
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
    const noSso = () => html(loginPage({ csrf: '', error: 'No organization with that slug uses single sign-on.' }), 404);
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
    const orgs = accessibleOrgs(db, principal, roleIn(db, principal, principal.homeOrgId));
    return html(page(principal, p => orgsPage({ ...p, orgs })));
  });

  r.add('GET', '/orgs/:org', ({ principal, params }) => {
    const { org, role } = access(ctx, principal, params.org, 'deployments:read');
    const deployments = listDeployments(db, ctx.deploymentsRoot, org.id);
    return html(page(principal, p => deploymentsPage({ ...p, org, deployments, canAudit: principalAllows(principal, role, 'audit:read') })));
  });

  r.add('GET', '/orgs/:org/deployments/:name', ({ principal, params }) => {
    const { org } = access(ctx, principal, params.org, 'runs:read');
    const { dir } = deploymentFor(ctx, org.id, params.name);
    const pending = draftsOf(ctx, org.id, params.name, 'pending').length;
    return html(page(principal, p => deploymentPage({ ...p, org, name: params.name, runs: listRuns(dir), pending })));
  });

  r.add('GET', '/orgs/:org/deployments/:name/runs/:run/report.html', ({ principal, params }) => {
    const { org } = access(ctx, principal, params.org, 'runs:read');
    const file = reportFile(deploymentFor(ctx, org.id, params.name).dir, params.run);
    if (!file) throw notFound('run');
    return { status: 200, body: fs.readFileSync(file, 'utf8'), csp: REPORT_CSP };
  });

  const draftsView = (principal, params, error) => {
    const { org, role } = access(ctx, principal, params.org, 'drafts:read');
    const drafts = draftsOf(ctx, org.id, params.name);
    return page(principal, p => draftsPage({ ...p, org, name: params.name, drafts, canReview: principalAllows(principal, role, 'drafts:review'), error }));
  };

  r.add('GET', '/orgs/:org/deployments/:name/drafts', ({ principal, params }) => html(draftsView(principal, params)));

  r.add('POST', '/orgs/:org/deployments/:name/drafts/:draft/review', async ({ req, principal, params }) => {
    const form = await readForm(req, ctx.maxBodyBytes);
    requireCsrf(principal, form);
    const { org } = access(ctx, principal, params.org, 'drafts:review');
    let content;
    if (form.decision === 'approve' && typeof form.content === 'string') {
      try {
        content = JSON.parse(form.content);
      } catch {
        return html(draftsView(principal, params, 'The edited content is not valid JSON; nothing was changed.'), 400);
      }
      // The form always posts the textarea; only a real change counts as a human edit in the audit trail.
      if (isDeepStrictEqual(content, draftOf(ctx, org.id, params.name, params.draft).content)) content = undefined;
    }
    try {
      await reviewDeploymentDraft(ctx, principal, org.id, params.name, params.draft, { decision: form.decision, note: form.note ?? '', content });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status >= 500 || e.status === 404) throw e;
      return html(draftsView(principal, params, e.message), e.status);
    }
    return new Redirect(`${orgPath(org)}/deployments/${encodeURIComponent(params.name)}/drafts`);
  });

  r.add('GET', '/orgs/:org/audit', ({ principal, params, url }) => {
    const { org } = access(ctx, principal, params.org, 'audit:read');
    const events = listEvents(db, org.id, new URLSearchParams({ limit: '100', ...(url.searchParams.get('cursor') ? { cursor: url.searchParams.get('cursor') } : {}) })).data;
    return html(page(principal, p => auditPage({ ...p, org, events, audits: deploymentAudits(ctx, org.id) })));
  });

  return r;
}

// Returns a handler for non-/v1 paths, or answers 404 itself.
export function createWebHandler(ctx) {
  const router = routes(ctx);

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
      respond(res, { status: err.status, body: errorPage({ status: err.status, message: err.message, user: principal, csrf: principal?.csrf }), headers: err.headers });
    }
  };
}

function respond(res, out) {
  const headers = { 'set-cookie': out.cookies ?? [] };
  if (out instanceof Redirect) {
    send(res, 303, '', { ...headers, location: out.location });
    return;
  }
  send(res, out.status, out.body, { ...headers, ...out.headers, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': out.csp ?? PAGE_CSP });
}
