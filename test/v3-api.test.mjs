import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { registerApplier, createDraft } from '../src/core/drafts.mjs';
import { MATRIX, ROLES } from '../src/v3/rbac.mjs';
import { api, startServer, seedOrg, fakeTarget, CASES_CSV, targetConfig, PEPPER } from './v3-support.test.mjs';

let srv;
let target;
let P; // partner org
let C1; // customer org managed by P
let C2; // unrelated customer org

before(async () => {
  srv = await startServer();
  target = await fakeTarget();
  P = seedOrg(srv.dataDir, { name: 'Partner Co', kind: 'partner', members: [
    { email: 'p-owner@partner.test', role: 'owner' }, { email: 'p-admin@partner.test', role: 'admin' }, { email: 'p-eng@partner.test', role: 'engineer' },
  ] });
  C1 = seedOrg(srv.dataDir, { name: 'Customer One', partnerOrgId: P.org.id, members: ROLES.map(role => ({ email: `${role}@one.test`, role })) });
  C2 = seedOrg(srv.dataDir, { name: 'Customer Two', members: [{ email: 'owner@two.test', role: 'owner' }] });
});

after(async () => {
  await srv.close();
  await target.close();
});

const k1 = role => C1.keys[`${role}@one.test`];
const o1 = () => `/v1/orgs/${C1.org.id}`;

test('health check answers without auth', async () => {
  const r = await api(srv.base, 'GET', '/healthz');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
});

test('authentication: missing, malformed and unknown keys get one consistent error object', async () => {
  for (const headers of [{}, { authorization: 'Basic abc' }, { authorization: 'Bearer nope' }, { authorization: `Bearer dk_${'A'.repeat(43)}` }]) {
    const r = await api(srv.base, 'GET', '/v1/orgs', { headers });
    assert.equal(r.status, 401);
    assert.equal(r.json.error.type, 'authentication_error');
    assert.equal(typeof r.json.error.message, 'string');
  }
});

test('errors: unknown endpoint, wrong method, bad JSON, wrong content type, oversized body', async () => {
  const key = k1('owner');
  let r = await api(srv.base, 'GET', '/v1/nothing', { key });
  assert.equal(r.status, 404);
  assert.equal(r.json.error.type, 'not_found_error');
  r = await api(srv.base, 'DELETE', o1(), { key });
  assert.equal(r.status, 405);
  assert.equal(r.headers.get('allow'), 'GET');
  r = await api(srv.base, 'POST', `${o1()}/members`, { key, raw: '{bad', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error.message, /not valid JSON/);
  r = await api(srv.base, 'POST', `${o1()}/members`, { key, raw: '[1]', headers: { 'content-type': 'application/json' } });
  assert.match(r.json.error.message, /JSON object/);
  r = await api(srv.base, 'POST', `${o1()}/members`, { key, raw: 'email=x', headers: { 'content-type': 'text/plain' } });
  assert.equal(r.status, 400);
  r = await api(srv.base, 'POST', `${o1()}/members`, { key, body: { email: 'x'.repeat(1024 * 1024 + 10) } });
  assert.equal(r.status, 413);
  assert.equal(r.json.error.code, 'body_too_large');
});

// One representative call per permission. Allowed calls must not be refused; denied calls must be 403.
const PERMISSION_CALLS = {
  'org:read': role => ['GET', o1()],
  'org:manage': role => ['PUT', `${o1()}/sso`, { issuer: 'https://idp.one.test', client_id: `c-${role}`, allowed_domains: ['one.test'] }],
  'members:read': () => ['GET', `${o1()}/members`],
  'members:manage': role => ['POST', `${o1()}/members`, { email: `added-by-${role}@one.test`, role: 'viewer' }],
  'keys:manage': () => ['GET', `${o1()}/api_keys`],
  'deployments:read': () => ['GET', `${o1()}/deployments`],
  'deployments:write': role => ['POST', `${o1()}/deployments`, { name: `rbac-${role}`, config: targetConfig(target.url) }],
  'runs:read': () => ['GET', `${o1()}/deployments/rbac-owner/runs`],
  'runs:create': () => ['POST', `${o1()}/deployments/rbac-owner/runs`, {}],
  'conversations:write': () => ['POST', `${o1()}/deployments/rbac-owner/conversations`, {}],
  'guard:check': () => ['POST', `${o1()}/deployments/rbac-owner/guard`, {}],
  'drafts:read': () => ['GET', `${o1()}/deployments/rbac-owner/drafts`],
  'drafts:review': () => ['POST', `${o1()}/deployments/rbac-owner/drafts/2026-01-01-none-abcdef/review`, { decision: 'reject' }],
  'audit:read': () => ['GET', `${o1()}/audit_events`],
  'usage:read': () => ['GET', `${o1()}/usage`],
};

test('RBAC: every role gets exactly the permissions in the matrix', async () => {
  assert.deepEqual(Object.keys(PERMISSION_CALLS).sort(), Object.keys(MATRIX).sort());
  for (const role of ROLES) { // owner first, so rbac-owner exists for the deployment-scoped calls
    for (const [permission, call] of Object.entries(PERMISSION_CALLS)) {
      const [method, url, body] = call(role);
      const r = await api(srv.base, method, url, { key: k1(role), body });
      const allowed = MATRIX[permission].includes(role);
      if (allowed) assert.notEqual(r.status, 403, `${role} should have ${permission} (${r.text})`);
      else {
        assert.equal(r.status, 403, `${role} must not have ${permission}`);
        assert.equal(r.json.error.type, 'permission_error');
      }
      assert.ok(r.status < 500 || r.status === 501, `${role} ${permission}: ${r.text}`);
    }
  }
});

test('members: admins cannot grant owner; the last owner stays; owners can promote', async () => {
  const add = await api(srv.base, 'POST', `${o1()}/members`, { key: k1('admin'), body: { email: 'boss@one.test', role: 'owner' } });
  assert.equal(add.status, 403);
  const owner = C1.users['owner@one.test'];
  let r = await api(srv.base, 'PATCH', `${o1()}/members/${owner}`, { key: k1('owner'), body: { role: 'admin' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error.message, /at least one owner/);
  r = await api(srv.base, 'PATCH', `${o1()}/members/${C1.users['viewer@one.test']}`, { key: k1('owner'), body: { role: 'superuser' } });
  assert.equal(r.json.error.param, 'role');
  r = await api(srv.base, 'POST', `${o1()}/members`, { key: k1('owner'), body: { email: 'not-an-email', role: 'viewer' } });
  assert.equal(r.json.error.param, 'email');
  const co = await api(srv.base, 'POST', `${o1()}/members`, { key: k1('owner'), body: { email: 'co-owner@one.test', role: 'viewer' } });
  r = await api(srv.base, 'PATCH', `${o1()}/members/${co.json.user_id}`, { key: k1('owner'), body: { role: 'owner' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.role, 'owner');
  // With two owners, an admin still cannot demote either of them.
  assert.equal((await api(srv.base, 'PATCH', `${o1()}/members/${co.json.user_id}`, { key: k1('admin'), body: { role: 'viewer' } })).status, 403);
  assert.equal((await api(srv.base, 'PATCH', `${o1()}/members/user_nope`, { key: k1('owner'), body: { role: 'viewer' } })).status, 404);
});

test('cross-org isolation: other tenants see 404 everywhere, and listing shows only your orgs', async () => {
  const c2 = C2.keys['owner@two.test'];
  const urls = ['', '/members', '/api_keys', '/deployments', '/deployments/rbac-owner', '/deployments/rbac-owner/runs', '/deployments/rbac-owner/drafts', '/audit_events', '/audit_events.csv', '/usage', '/sso'];
  for (const u of urls) {
    for (const key of [c2, P.keys['p-eng@partner.test']]) {
      const r = await api(srv.base, 'GET', `${o1()}${u}`, { key });
      assert.equal(r.status, 404, `GET ${u}`);
      assert.equal(r.json.error.type, 'not_found_error');
    }
  }
  for (const [method, u, body] of [['POST', '/members', { email: 'x@two.test', role: 'owner' }], ['POST', '/deployments', { name: 'steal', config: targetConfig(target.url) }], ['DELETE', `/members/${C1.users['owner@one.test']}`]]) {
    const r = await api(srv.base, method, `${o1()}${u}`, { key: c2, body });
    assert.equal(r.status, 404, `${method} ${u}`);
  }
  // A customer cannot reach its partner or a sibling; made-up ids look the same as real ones.
  for (const id of [P.org.id, C2.org.id, 'org_0000000000000000', '../etc']) {
    assert.equal((await api(srv.base, 'GET', `/v1/orgs/${encodeURIComponent(id)}`, { key: k1('owner') })).status, 404);
  }
  const list = await api(srv.base, 'GET', '/v1/orgs', { key: k1('owner') });
  assert.deepEqual(list.json.data.map(o => o.id), [C1.org.id]);
});

test('partner access: partner admins manage their customer orgs, and only those', async () => {
  const pa = P.keys['p-admin@partner.test'];
  const list = await api(srv.base, 'GET', '/v1/orgs', { key: pa });
  const ids = list.json.data.map(o => o.id);
  assert.ok(ids.includes(P.org.id) && ids.includes(C1.org.id));
  assert.ok(!ids.includes(C2.org.id));
  assert.equal((await api(srv.base, 'GET', `/v1/orgs/${C2.org.id}`, { key: pa })).status, 404);
  assert.equal((await api(srv.base, 'GET', `${o1()}/members`, { key: pa })).status, 200);

  // Partner engineers do not cross the boundary; partner engineers' own org works.
  const pe = P.keys['p-eng@partner.test'];
  assert.deepEqual((await api(srv.base, 'GET', '/v1/orgs', { key: pe })).json.data.map(o => o.id), [P.org.id]);

  const created = await api(srv.base, 'POST', '/v1/orgs', { key: pa, body: { name: 'Customer Three' } });
  assert.equal(created.status, 201);
  assert.equal(created.json.kind, 'customer');
  assert.equal(created.json.partner_org_id, P.org.id);
  const reg = await api(srv.base, 'POST', `/v1/orgs/${created.json.id}/deployments`, { key: pa, body: { name: 'pilot', config: targetConfig(target.url) } });
  assert.equal(reg.status, 201);
  assert.equal(fs.existsSync(path.join(srv.deploymentsRoot, created.json.id, 'pilot', 'delomu.json')), true);

  // Partner admins act as "admin" in customer orgs: no owner grants, no keys in someone else's org.
  assert.equal((await api(srv.base, 'POST', `/v1/orgs/${created.json.id}/members`, { key: pa, body: { email: 'o@three.test', role: 'owner' } })).status, 403);
  assert.equal((await api(srv.base, 'POST', `/v1/orgs/${created.json.id}/members`, { key: pa, body: { email: 'a@three.test', role: 'admin' } })).status, 201);
  assert.equal((await api(srv.base, 'POST', `/v1/orgs/${created.json.id}/api_keys`, { key: pa, body: { name: 'x' } })).status, 403);
  // Customers and partner engineers cannot create orgs.
  assert.equal((await api(srv.base, 'POST', '/v1/orgs', { key: k1('owner'), body: { name: 'Nope' } })).status, 403);
  assert.equal((await api(srv.base, 'POST', '/v1/orgs', { key: pe, body: { name: 'Nope' } })).status, 403);
});

test('API keys: shown once, stored only as a peppered hash, scoped, revocable', async () => {
  const owner = k1('owner');
  const created = await api(srv.base, 'POST', `${o1()}/api_keys`, { key: owner, body: { name: 'ci', scopes: ['deployments:read'] } });
  assert.equal(created.status, 201);
  const secret = created.json.secret;
  assert.match(secret, /^dk_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.json.prefix, secret.slice(0, 11));

  const listed = await api(srv.base, 'GET', `${o1()}/api_keys`, { key: owner, headers: {} });
  const row = listed.json.data.find(k => k.id === created.json.id);
  assert.equal(row.secret, undefined);
  assert.equal(row.hash, undefined);
  assert.ok(!listed.text.includes(secret));

  // The database holds HMAC-SHA256(pepper, key), never the key itself.
  const dbBytes = ['delomu.db', 'delomu.db-wal'].map(f => path.join(srv.dataDir, f)).filter(fs.existsSync).map(f => fs.readFileSync(f).toString('latin1')).join('');
  assert.ok(!dbBytes.includes(secret));
  assert.ok(dbBytes.includes(crypto.createHmac('sha256', PEPPER).update(secret).digest('hex')));

  // Scopes restrict the key below its owner's role.
  assert.equal((await api(srv.base, 'GET', `${o1()}/deployments`, { key: secret })).status, 200);
  assert.equal((await api(srv.base, 'GET', `${o1()}/members`, { key: secret })).status, 403);
  const used = (await api(srv.base, 'GET', `${o1()}/api_keys`, { key: owner })).json.data.find(k => k.id === created.json.id);
  assert.ok(used.last_used_at);

  // Bad scopes, and scopes above the creator's role, are refused.
  assert.equal((await api(srv.base, 'POST', `${o1()}/api_keys`, { key: owner, body: { name: 'x', scopes: ['root'] } })).json.error.param, 'scopes');
  assert.equal((await api(srv.base, 'POST', `${o1()}/api_keys`, { key: owner, body: { name: 'x', scopes: [] } })).status, 400);
  const keyAdmin = await api(srv.base, 'POST', `${o1()}/api_keys`, { key: owner, body: { name: 'km', scopes: ['keys:manage'] } });
  const child = await api(srv.base, 'POST', `${o1()}/api_keys`, { key: keyAdmin.json.secret, body: { name: 'child' } });
  assert.deepEqual(child.json.scopes, ['keys:manage'], 'a restricted key cannot mint an unrestricted one');
  assert.equal((await api(srv.base, 'POST', `${o1()}/api_keys`, { key: keyAdmin.json.secret, body: { name: 'c2', scopes: ['members:manage'] } })).status, 403);

  // Revocation takes effect immediately.
  const revoked = await api(srv.base, 'DELETE', `${o1()}/api_keys/${created.json.id}`, { key: owner });
  assert.ok(revoked.json.revoked_at);
  assert.equal((await api(srv.base, 'GET', `${o1()}/deployments`, { key: secret })).status, 401);
  assert.equal((await api(srv.base, 'DELETE', `${o1()}/api_keys/key_nope`, { key: owner })).status, 404);
  // Keys of other orgs cannot be revoked through this org.
  assert.equal((await api(srv.base, 'DELETE', `/v1/orgs/${C2.org.id}/api_keys/${created.json.id}`, { key: owner })).status, 404);
});

test('removing a member revokes their keys', async () => {
  const s = seedOrg(srv.dataDir, { name: 'Scratch', members: [{ email: 'o@scratch.test', role: 'owner' }, { email: 'a@scratch.test', role: 'admin' }] });
  const owner = s.keys['o@scratch.test'];
  const leaver = s.keys['a@scratch.test'];
  const orgUrl = `/v1/orgs/${s.org.id}`;
  assert.equal((await api(srv.base, 'GET', orgUrl, { key: leaver })).status, 200);
  // Admins cannot remove owners.
  assert.equal((await api(srv.base, 'DELETE', `${orgUrl}/members/${s.users['o@scratch.test']}`, { key: leaver })).status, 403);
  const del = await api(srv.base, 'DELETE', `${orgUrl}/members/${s.users['a@scratch.test']}`, { key: owner });
  assert.equal(del.json.deleted, true);
  assert.equal((await api(srv.base, 'GET', orgUrl, { key: leaver })).status, 401);
  const keys = (await api(srv.base, 'GET', `${orgUrl}/api_keys`, { key: owner })).json.data;
  assert.ok(keys.find(k => k.user_id === s.users['a@scratch.test']).revoked_at);
  assert.equal((await api(srv.base, 'DELETE', `${orgUrl}/members/${s.users['a@scratch.test']}`, { key: owner })).status, 404);
  assert.equal((await api(srv.base, 'DELETE', `${orgUrl}/members/${s.users['o@scratch.test']}`, { key: owner })).status, 400);
});

test('idempotency: retries replay the first response; reuse with another body is refused', async () => {
  const key = k1('owner');
  const headers = { 'idempotency-key': 'add-member-1' };
  const body = { email: 'idem@one.test', role: 'viewer' };
  const a = await api(srv.base, 'POST', `${o1()}/members`, { key, body, headers });
  const b = await api(srv.base, 'POST', `${o1()}/members`, { key, body, headers });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.text, a.text);
  assert.equal(b.headers.get('idempotent-replayed'), 'true');
  const members = (await api(srv.base, 'GET', `${o1()}/members?limit=100`, { key })).json.data;
  assert.equal(members.filter(m => m.email === 'idem@one.test').length, 1);

  const c = await api(srv.base, 'POST', `${o1()}/members`, { key, body: { ...body, role: 'admin' }, headers });
  assert.equal(c.status, 422);
  assert.equal(c.json.error.type, 'idempotency_error');

  // Client errors are stored and replayed too; a different key's namespace is separate.
  const e1 = await api(srv.base, 'POST', `${o1()}/members`, { key, body: { email: 'bad' }, headers: { 'idempotency-key': 'bad-1' } });
  const e2 = await api(srv.base, 'POST', `${o1()}/members`, { key, body: { email: 'bad' }, headers: { 'idempotency-key': 'bad-1' } });
  assert.equal(e1.status, 400);
  assert.equal(e2.headers.get('idempotent-replayed'), 'true');
  const other = await api(srv.base, 'POST', `${o1()}/members`, { key: k1('admin'), body: { email: 'idem2@one.test', role: 'viewer' }, headers });
  assert.equal(other.status, 201);
  assert.equal((await api(srv.base, 'POST', `${o1()}/members`, { key, body, headers: { 'idempotency-key': 'x'.repeat(300) } })).status, 400);
});

test('cursor pagination walks a list exactly once', async () => {
  const key = k1('owner');
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const r = await api(srv.base, 'GET', `${o1()}/members?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { key });
    assert.equal(r.json.object, 'list');
    assert.ok(r.json.data.length <= 2);
    seen.push(...r.json.data.map(m => m.user_id));
    cursor = r.json.has_more ? r.json.next_cursor : null;
    pages++;
  } while (cursor);
  const all = (await api(srv.base, 'GET', `${o1()}/members?limit=100`, { key })).json.data.map(m => m.user_id);
  assert.deepEqual(seen, all);
  assert.ok(pages >= 3);
  assert.equal((await api(srv.base, 'GET', `${o1()}/members?limit=0`, { key })).json.error.param, 'limit');
  assert.equal((await api(srv.base, 'GET', `${o1()}/members?cursor=zzz`, { key })).json.error.param, 'cursor');
});

test('deployment names are validated and paths cannot escape the org folder', async () => {
  const key = k1('owner');
  for (const name of ['../evil', '..', 'a/b', 'a\\b', 'UPPER', 'con', 'nul', '-x', 'x-', '', 'a.b', 'x'.repeat(64), '%2e%2e', 7]) {
    const r = await api(srv.base, 'POST', `${o1()}/deployments`, { key, body: { name, config: targetConfig(target.url) } });
    assert.equal(r.status, 400, JSON.stringify(name));
    assert.equal(r.json.error.param, 'name');
  }
  for (const seg of ['..%2F..%2Fevil', '..%5C..%5Cevil', 'a%2Fb', '%00']) {
    const r = await api(srv.base, 'GET', `${o1()}/deployments/${seg}/runs`, { key });
    assert.equal(r.status, 400, seg);
  }
  const entries = fs.readdirSync(srv.deploymentsRoot);
  assert.ok(entries.every(e => /^org_[0-9a-f]{16}$/.test(e)), entries.join(','));
  assert.ok(!fs.existsSync(path.join(srv.deploymentsRoot, 'evil')));
  assert.ok(!fs.existsSync(path.join(path.dirname(srv.deploymentsRoot), 'evil')));
});

test('targets: shell commands and foreign env vars are refused on a shared server', async () => {
  const key = k1('owner');
  let r = await api(srv.base, 'POST', `${o1()}/deployments`, { key, body: { name: 'shell', config: { target: { type: 'command', command: 'whoami' } } } });
  assert.equal(r.status, 403);
  const leaky = targetConfig(target.url);
  leaky.target.headers = { 'x-steal': '${DELOMU_KEY_PEPPER}' };
  r = await api(srv.base, 'POST', `${o1()}/deployments`, { key, body: { name: 'leaky', config: leaky } });
  assert.equal(r.status, 403);
  assert.match(r.json.error.message, /CUSTOMER_/);
  r = await api(srv.base, 'POST', `${o1()}/deployments`, { key, body: { name: 'noconfig' } });
  assert.equal(r.json.error.param, 'config');
  r = await api(srv.base, 'POST', `${o1()}/deployments`, { key, body: { name: 'badurl', config: { target: { type: 'http', url: 'file:///etc/passwd' } } } });
  assert.equal(r.status, 400);
});

test('deployments: register, run, list runs, open the report, review drafts, audit and CSV export', async () => {
  const eng = k1('engineer');
  const reg = await api(srv.base, 'POST', `${o1()}/deployments`, { key: eng, body: { name: 'support-bot', config: targetConfig(target.url), cases: CASES_CSV } });
  assert.equal(reg.status, 201);
  assert.equal(reg.json.tests, 2);
  assert.equal((await api(srv.base, 'POST', `${o1()}/deployments`, { key: eng, body: { name: 'support-bot', config: targetConfig(target.url) } })).status, 409);
  const dir = path.join(srv.deploymentsRoot, C1.org.id, 'support-bot');

  const run = await api(srv.base, 'POST', `${o1()}/deployments/support-bot/runs`, { key: eng, body: {} });
  assert.equal(run.status, 201, run.text);
  assert.equal(run.json.judge, 'off');
  assert.equal(run.json.summary.pass, 1);
  assert.equal(run.json.summary.verdict, 'accepted');
  assert.equal((await api(srv.base, 'POST', `${o1()}/deployments/support-bot/runs`, { key: eng, body: { judge: 'yes' } })).json.error.param, 'judge');
  assert.equal((await api(srv.base, 'POST', `${o1()}/deployments/missing/runs`, { key: eng, body: {} })).status, 404);

  const runs = await api(srv.base, 'GET', `${o1()}/deployments/support-bot/runs`, { key: k1('viewer') });
  assert.deepEqual(runs.json.data.map(r => r.id), [run.json.id]);
  assert.equal((await api(srv.base, 'GET', `${o1()}/deployments/support-bot/runs/${run.json.id}`, { key: k1('viewer') })).json.id, run.json.id);
  const report = await api(srv.base, 'GET', `${o1()}/deployments/support-bot/runs/${run.json.id}/report.html`, { key: k1('viewer') });
  assert.equal(report.status, 200);
  assert.match(report.headers.get('content-type'), /text\/html/);
  assert.match(report.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(report.text, /Acceptance report/);
  assert.equal((await api(srv.base, 'GET', `${o1()}/deployments/support-bot/runs/..%2F..%2Fdelomu.json/report.html`, { key: eng })).status, 404);

  // Drafts: the agent proposes, a person reviews through the API.
  const applied = [];
  registerApplier('v3-test-note', (d, content) => { applied.push(content); return 'noted'; });
  const a = createDraft(dir, { kind: 'v3-test-note', step: 4, content: { text: 'original' }, rationale: 'why' });
  const b = createDraft(dir, { kind: 'v3-test-note', step: 4, content: { text: 'second' } });
  const c = createDraft(dir, { kind: 'v3-unregistered-kind', step: 4, content: {} });
  const base = `${o1()}/deployments/support-bot/drafts`;
  assert.equal((await api(srv.base, 'GET', `${base}?status=pending`, { key: k1('viewer') })).json.data.length, 3);
  assert.equal((await api(srv.base, 'GET', `${base}?status=weird`, { key: k1('viewer') })).json.error.param, 'status');
  assert.equal((await api(srv.base, 'GET', `${base}/${a.id}`, { key: k1('viewer') })).json.rationale, 'why');
  assert.equal((await api(srv.base, 'POST', `${base}/${a.id}/review`, { key: k1('viewer'), body: { decision: 'approve' } })).status, 403);

  const ok = await api(srv.base, 'POST', `${base}/${a.id}/review`, { key: k1('reviewer'), body: { decision: 'approve', content: { text: 'edited' }, note: 'tightened' } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.status, 'approved');
  assert.equal(ok.json.edited, true);
  assert.equal(ok.json.reviewedBy, 'reviewer@one.test');
  assert.deepEqual(applied, [{ text: 'edited' }]);
  assert.equal((await api(srv.base, 'POST', `${base}/${a.id}/review`, { key: k1('reviewer'), body: { decision: 'reject' } })).status, 409);
  assert.equal((await api(srv.base, 'POST', `${base}/${b.id}/review`, { key: k1('reviewer'), body: { decision: 'reject', content: {} } })).json.error.param, 'content');
  assert.equal((await api(srv.base, 'POST', `${base}/${b.id}/review`, { key: k1('reviewer'), body: { decision: 'maybe' } })).json.error.param, 'decision');
  assert.equal((await api(srv.base, 'POST', `${base}/${b.id}/review`, { key: k1('reviewer'), body: { decision: 'reject', note: 'no' } })).json.status, 'rejected');
  const noApplier = await api(srv.base, 'POST', `${base}/${c.id}/review`, { key: k1('reviewer'), body: { decision: 'approve' } });
  assert.equal(noApplier.status, 400);
  assert.match(noApplier.json.error.message, /no applier/);
  assert.ok(!noApplier.json.error.message.includes(srv.deploymentsRoot), 'server paths are not leaked');
  assert.equal((await api(srv.base, 'GET', `${base}/..%2Fx`, { key: k1('viewer') })).status, 404);
  assert.equal((await api(srv.base, 'GET', `${base}/2026-01-01-x-000000`, { key: k1('viewer') })).status, 404);

  // Per-deployment hash-chained audit, with verification.
  const audit = await api(srv.base, 'GET', `${o1()}/deployments/support-bot/audit?limit=100`, { key: k1('reviewer') });
  assert.equal(audit.json.verify.ok, true);
  const actions = audit.json.data.map(e => `${e.actor} ${e.action}`);
  assert.ok(actions.includes('human:reviewer@one.test draft.approved'));
  assert.ok(actions.includes('human:engineer@one.test deployment.register'));
  assert.equal((await api(srv.base, 'GET', `${o1()}/deployments/support-bot/audit`, { key: k1('viewer') })).status, 403);

  // Org events, newest first, and the CSV export with formula cells neutralised.
  await api(srv.base, 'POST', `${o1()}/members`, { key: k1('owner'), body: { email: '=cmd@one.test', role: 'viewer' } });
  const events = await api(srv.base, 'GET', `${o1()}/audit_events?limit=100`, { key: k1('admin') });
  const names = events.json.data.map(e => e.action);
  for (const a of ['run.create', 'draft.approved', 'draft.rejected', 'deployment.register', 'api_key.create', 'api_key.revoke', 'member.add']) assert.ok(names.includes(a), a);
  assert.equal(events.json.data[0].action, 'member.add');
  assert.equal(events.json.data[0].detail.via.slice(0, 11), 'api_key:dk_');
  const csv = await api(srv.base, 'GET', `${o1()}/audit_events.csv`, { key: k1('admin') });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="audit-customer-one.csv"/);
  assert.match(csv.text, /^source,id,ts,actor,action,target,detail,ip,chain\r\n/);
  assert.match(csv.text, /deployment:support-bot,\d+,.*intact/);
  assert.ok(csv.text.includes("'=cmd@one.test"));
  assert.ok(!/,=cmd@one\.test/.test(csv.text));
});

test('usage comes from v2 when installed, otherwise 501', async () => {
  const r = await api(srv.base, 'GET', `${o1()}/usage?month=2026-10`, { key: k1('owner') });
  if (fs.existsSync(new URL('../src/v2/monitor.mjs', import.meta.url))) assert.equal(r.status, 200, r.text);
  else {
    assert.equal(r.status, 501);
    assert.equal(r.json.error.code, 'not_implemented');
  }
  assert.equal((await api(srv.base, 'GET', `${o1()}/usage?month=26-1`, { key: k1('owner') })).json.error.param, 'month');
});

test('rate limit: a burst past the bucket gets 429 with Retry-After', async () => {
  const s = await startServer({ rateLimit: { capacity: 3, refillPerSec: 0.01 } });
  try {
    const o = seedOrg(s.dataDir, { name: 'Limited', members: [{ email: 'a@limited.test', role: 'owner' }] });
    const key = o.keys['a@limited.test'];
    for (let i = 0; i < 3; i++) assert.equal((await api(s.base, 'GET', '/v1/orgs', { key })).status, 200);
    const r = await api(s.base, 'GET', '/v1/orgs', { key });
    assert.equal(r.status, 429);
    assert.equal(r.json.error.type, 'rate_limit_error');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  } finally {
    await s.close();
  }
});

test('a restricted key without org:read cannot list orgs', async () => {
  const created = await api(srv.base, 'POST', `${o1()}/api_keys`, { key: k1('owner'), body: { name: 'deploy-only', scopes: ['deployments:read'] } });
  const r = await api(srv.base, 'GET', '/v1/orgs', { key: created.json.secret });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.type, 'permission_error');
});

test('concurrent approvals of one draft apply it exactly once', async () => {
  const key = k1('owner');
  assert.equal((await api(srv.base, 'POST', `${o1()}/deployments`, { key, body: { name: 'race', config: targetConfig(target.url) } })).status, 201);
  const dir = path.join(srv.deploymentsRoot, C1.org.id, 'race');
  let applies = 0;
  registerApplier('v3-slow-note', async () => { applies++; await new Promise(resolve => setTimeout(resolve, 100)); return 'slow'; });
  const d = createDraft(dir, { kind: 'v3-slow-note', step: 4, content: {} });
  const url = `${o1()}/deployments/race/drafts/${d.id}/review`;
  const [a, b] = await Promise.all([1, 2].map(() => api(srv.base, 'POST', url, { key, body: { decision: 'approve' } })));
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(applies, 1);
});

test('behind a trusted proxy, the audit IP is the address the proxy saw, not one the client wrote', async () => {
  const s = await startServer({ trustProxy: true });
  try {
    const o = seedOrg(s.dataDir, { name: 'Proxied', members: [{ email: 'a@proxied.test', role: 'owner' }] });
    const key = o.keys['a@proxied.test'];
    const headers = { 'x-forwarded-for': '6.6.6.6, 10.1.2.3' };
    assert.equal((await api(s.base, 'POST', `/v1/orgs/${o.org.id}/members`, { key, headers, body: { email: 'b@proxied.test', role: 'viewer' } })).status, 201);
    const events = (await api(s.base, 'GET', `/v1/orgs/${o.org.id}/audit_events`, { key })).json.data;
    assert.equal(events[0].ip, '10.1.2.3');
  } finally {
    await s.close();
  }
});
