// The JSON API under /v1. Bearer API keys only (no cookies, so no CSRF surface). Every response is JSON
// except the report and CSV export; every error is { error: { type, message, code?, param? } }.
// POSTs honour Idempotency-Key; lists are cursor-paged; each key is rate limited.

import fs from 'node:fs';
import { accessibleOrgs, addMember, createOrg, getMember, listMembers, removeMember, setMemberRole } from './accounts.mjs';
import { tx } from './db.mjs';
import { allEvents, eventsCsv, listEvents } from './events.mjs';
import { ApiError, createRouter, forbidden, notFound, paginate, readJson, send, sendError } from './http.mjs';
import { beginIdempotent, checkIdempotencyKey } from './idempotency.mjs';
import { authenticateKey, checkScopes, createApiKey, listKeys, revokeKey } from './keys.mjs';
import {
  access, deploymentAudits, deploymentFor, draftOf, draftsOf, event, orgUsage, reviewDeploymentDraft, startRun,
} from './operations.mjs';
import { isManager, principalAllows, roleIn } from './rbac.mjs';
import { checkOidcConfig, getOidcConfig, setOidcConfig } from './sso.mjs';
import { deploymentAudit, listDeployments, listRuns, registerDeployment, reportFile } from './workspace.mjs';

const REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";

const ok = (json, status = 200) => ({ status, json });

function routes(ctx) {
  const r = createRouter();
  const { db } = ctx;

  r.add('GET', '/v1/orgs', ({ principal, url }) => {
    const homeRole = roleIn(db, principal, principal.homeOrgId);
    if (!principalAllows(principal, homeRole, 'org:read')) throw forbidden('This key does not allow org:read.');
    return ok(paginate(accessibleOrgs(db, principal, homeRole), url.searchParams));
  });

  r.add('POST', '/v1/orgs', ({ principal, body }) => {
    const { org: home, role } = access(ctx, principal, principal.homeOrgId, 'org:manage');
    if (home.kind !== 'partner' || !isManager(role)) throw forbidden('Only partner owners and admins can create customer orgs.');
    const org = createOrg(db, { name: body.name, kind: 'customer', partnerOrgId: home.id }, ctx.now());
    event(ctx, principal, home.id, 'org.create', org.id, { name: org.name });
    event(ctx, principal, org.id, 'org.create', org.id, { name: org.name, partner_org_id: home.id });
    return ok(org, 201);
  });

  r.add('GET', '/v1/orgs/:org', ({ principal, params }) => ok(access(ctx, principal, params.org, 'org:read').org));

  r.add('GET', '/v1/orgs/:org/sso', ({ principal, params }) => {
    access(ctx, principal, params.org, 'org:manage');
    const config = getOidcConfig(db, params.org);
    if (!config) throw notFound('SSO configuration');
    return ok(config);
  });

  r.add('PUT', '/v1/orgs/:org/sso', ({ principal, params, body }) => {
    access(ctx, principal, params.org, 'org:manage');
    const saved = setOidcConfig(db, params.org, checkOidcConfig(body), ctx.now());
    event(ctx, principal, params.org, 'sso.update', params.org, { issuer: saved.issuer, allowed_domains: saved.allowed_domains });
    return ok(saved);
  });

  r.add('GET', '/v1/orgs/:org/members', ({ principal, params, url }) => {
    access(ctx, principal, params.org, 'members:read');
    return ok(paginate(listMembers(db, params.org), url.searchParams, 'user_id'));
  });

  r.add('POST', '/v1/orgs/:org/members', ({ principal, params, body }) => {
    const { role } = access(ctx, principal, params.org, 'members:manage');
    const member = addMember(db, params.org, { email: body.email, role: body.role }, role, ctx.now());
    event(ctx, principal, params.org, 'member.add', member.email, { role: member.role });
    return ok(member, 201);
  });

  r.add('PATCH', '/v1/orgs/:org/members/:user', ({ principal, params, body }) => {
    const { role } = access(ctx, principal, params.org, 'members:manage');
    const member = tx(db, () => setMemberRole(db, params.org, params.user, body.role, role));
    if (!member) throw notFound('member');
    event(ctx, principal, params.org, 'member.update', member.email, { role: member.role });
    return ok(member);
  });

  r.add('DELETE', '/v1/orgs/:org/members/:user', ({ principal, params }) => {
    const { role } = access(ctx, principal, params.org, 'members:manage');
    const member = tx(db, () => removeMember(db, params.org, params.user, role, ctx.now()));
    if (!member) throw notFound('member');
    event(ctx, principal, params.org, 'member.remove', member.email);
    return ok({ ...member, deleted: true });
  });

  r.add('GET', '/v1/orgs/:org/api_keys', ({ principal, params, url }) => {
    access(ctx, principal, params.org, 'keys:manage');
    return ok(paginate(listKeys(db, params.org), url.searchParams));
  });

  r.add('POST', '/v1/orgs/:org/api_keys', ({ principal, params, body }) => {
    const { role } = access(ctx, principal, params.org, 'keys:manage');
    if (params.org !== principal.homeOrgId || !getMember(db, params.org, principal.userId)) {
      throw forbidden('API keys can only be created in an org you are a direct member of.');
    }
    // A restricted key can only mint keys at most as restricted as itself.
    const scopes = checkScopes(body.scopes) ?? principal.scopes;
    for (const s of scopes ?? []) if (!principalAllows(principal, role, s)) throw forbidden(`You cannot grant the ${s} scope.`);
    const { key, secret } = createApiKey(db, { orgId: params.org, userId: principal.userId, name: body.name, scopes }, ctx.pepper, ctx.now());
    event(ctx, principal, params.org, 'api_key.create', key.id, { prefix: key.prefix, scopes: key.scopes });
    return ok({ ...key, secret }, 201);
  });

  r.add('DELETE', '/v1/orgs/:org/api_keys/:key', ({ principal, params }) => {
    access(ctx, principal, params.org, 'keys:manage');
    const key = revokeKey(db, params.org, params.key, ctx.now());
    if (!key) throw notFound('API key');
    event(ctx, principal, params.org, 'api_key.revoke', key.id, { prefix: key.prefix });
    return ok(key);
  });

  r.add('GET', '/v1/orgs/:org/deployments', ({ principal, params, url }) => {
    access(ctx, principal, params.org, 'deployments:read');
    return ok(paginate(listDeployments(db, ctx.deploymentsRoot, params.org), url.searchParams, 'name'));
  });

  r.add('POST', '/v1/orgs/:org/deployments', ({ principal, params, body }) => {
    access(ctx, principal, params.org, 'deployments:write');
    const d = registerDeployment(db, ctx.deploymentsRoot, params.org, { name: body.name, config: body.config, cases: body.cases },
      { actor: principal.actor, policy: ctx.policy }, ctx.now());
    event(ctx, principal, params.org, 'deployment.register', d.name, { tests: d.tests });
    return ok(d, 201);
  });

  r.add('GET', '/v1/orgs/:org/deployments/:name', ({ principal, params }) => {
    access(ctx, principal, params.org, 'deployments:read');
    return ok(deploymentFor(ctx, params.org, params.name).deployment);
  });

  r.add('GET', '/v1/orgs/:org/deployments/:name/runs', ({ principal, params, url }) => {
    access(ctx, principal, params.org, 'runs:read');
    return ok(paginate(listRuns(deploymentFor(ctx, params.org, params.name).dir), url.searchParams));
  });

  r.add('POST', '/v1/orgs/:org/deployments/:name/runs', async ({ principal, params, body }) => {
    access(ctx, principal, params.org, 'runs:create');
    return ok(await startRun(ctx, principal, params.org, params.name, { judge: body.judge ?? false }), 201);
  });

  r.add('GET', '/v1/orgs/:org/deployments/:name/runs/:run', ({ principal, params }) => {
    access(ctx, principal, params.org, 'runs:read');
    const run = listRuns(deploymentFor(ctx, params.org, params.name).dir).find(x => x.id === params.run);
    if (!run) throw notFound('run');
    return ok(run);
  });

  r.add('GET', '/v1/orgs/:org/deployments/:name/runs/:run/report.html', ({ principal, params }) => {
    access(ctx, principal, params.org, 'runs:read');
    const file = reportFile(deploymentFor(ctx, params.org, params.name).dir, params.run);
    if (!file) throw notFound('run');
    return { status: 200, text: fs.readFileSync(file, 'utf8'), headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': REPORT_CSP } };
  });

  r.add('GET', '/v1/orgs/:org/deployments/:name/drafts', ({ principal, params, url }) => {
    access(ctx, principal, params.org, 'drafts:read');
    return ok(paginate(draftsOf(ctx, params.org, params.name, url.searchParams.get('status') ?? undefined), url.searchParams));
  });

  r.add('GET', '/v1/orgs/:org/deployments/:name/drafts/:draft', ({ principal, params }) => {
    access(ctx, principal, params.org, 'drafts:read');
    return ok(draftOf(ctx, params.org, params.name, params.draft));
  });

  r.add('POST', '/v1/orgs/:org/deployments/:name/drafts/:draft/review', async ({ principal, params, body }) => {
    access(ctx, principal, params.org, 'drafts:review');
    return ok(await reviewDeploymentDraft(ctx, principal, params.org, params.name, params.draft, body));
  });

  r.add('GET', '/v1/orgs/:org/deployments/:name/audit', ({ principal, params, url }) => {
    access(ctx, principal, params.org, 'audit:read');
    const { entries, verify } = deploymentAudit(deploymentFor(ctx, params.org, params.name).dir);
    return ok({ ...paginate(entries.slice().reverse(), url.searchParams, 'seq'), verify });
  });

  r.add('GET', '/v1/orgs/:org/audit_events', ({ principal, params, url }) => {
    access(ctx, principal, params.org, 'audit:read');
    return ok(listEvents(db, params.org, url.searchParams));
  });

  r.add('GET', '/v1/orgs/:org/audit_events.csv', ({ principal, params }) => {
    const { org } = access(ctx, principal, params.org, 'audit:read');
    event(ctx, principal, org.id, 'audit.export', org.id);
    return {
      status: 200,
      text: eventsCsv(allEvents(db, org.id), deploymentAudits(ctx, org.id)),
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="audit-${org.slug}.csv"` },
    };
  });

  r.add('GET', '/v1/orgs/:org/usage', async ({ principal, params, url }) => {
    access(ctx, principal, params.org, 'usage:read');
    const month = url.searchParams.get('month') ?? ctx.now().toISOString().slice(0, 7);
    const usage = await orgUsage(ctx, params.org, month);
    if (!usage) throw new ApiError('api_error', 'Usage metering is not installed on this server (needs Delomu v2).', { status: 501, code: 'not_implemented' });
    return ok({ object: 'usage', ...usage });
  });

  return r;
}

function authenticate(ctx, req) {
  const header = String(req.headers.authorization ?? '');
  const m = /^Bearer (\S+)$/.exec(header);
  if (!m) throw new ApiError('authentication_error', 'Send your API key as "Authorization: Bearer dk_...".');
  const key = authenticateKey(ctx.db, m[1], ctx.pepper, ctx.now());
  if (!key) throw new ApiError('authentication_error', 'Invalid or revoked API key.');
  const user = ctx.db.prepare('SELECT email FROM users WHERE id = ?').get(key.user_id);
  return {
    userId: key.user_id, email: user.email, homeOrgId: key.org_id, scopes: key.scopes,
    actor: `human:${user.email}`, via: `api_key:${key.prefix}`, ip: ctx.clientIp(req), limitId: key.id,
  };
}

// Handles one /v1 request end to end; never throws.
export function createApiHandler(ctx) {
  const router = routes(ctx);

  return async function handleApi(req, res, url) {
    try {
      const principal = authenticate(ctx, req);
      const limit = ctx.rateLimit(principal.limitId);
      if (!limit.ok) {
        throw new ApiError('rate_limit_error', 'Too many requests for this API key; slow down.', { headers: { 'retry-after': String(limit.retryAfterSec) } });
      }
      const found = router.match(req.method, url.pathname);
      if (!found) throw notFound('endpoint');
      if (found.allowed) throw new ApiError('invalid_request_error', `Use ${found.allowed.join(' or ')} for this endpoint.`, { status: 405, headers: { allow: found.allowed.join(', ') } });

      const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method);
      const { text, body } = hasBody ? await readJson(req, ctx.maxBodyBytes) : { text: '', body: {} };
      const idemKey = req.method === 'POST' ? checkIdempotencyKey(req.headers['idempotency-key']) : null;
      let idem = null;
      if (idemKey) {
        idem = beginIdempotent(ctx.db, { scope: principal.limitId, key: idemKey, method: req.method, path: url.pathname, body: text }, ctx.now());
        if (idem.replay) {
          send(res, idem.replay.status, idem.replay.body, { 'content-type': 'application/json; charset=utf-8', 'idempotent-replayed': 'true' });
          return;
        }
      }

      let out;
      try {
        out = await found.handler({ principal, params: found.params, body, url, req });
      } catch (e) {
        const err = toApiError(e, ctx);
        idem?.finish(err.status, JSON.stringify(err.toJSON()) + '\n');
        throw err;
      }
      if (out.json !== undefined) {
        const payload = JSON.stringify(out.json) + '\n';
        idem?.finish(out.status, payload);
        send(res, out.status, payload, { 'content-type': 'application/json; charset=utf-8' });
      } else {
        send(res, out.status, out.text, out.headers);
      }
    } catch (e) {
      sendError(res, toApiError(e, ctx));
    }
  };
}

export function toApiError(e, ctx) {
  if (e instanceof ApiError) return e;
  ctx.log(`unexpected error: ${e.stack ?? e}`);
  return new ApiError('api_error', 'Something went wrong on the server.');
}
