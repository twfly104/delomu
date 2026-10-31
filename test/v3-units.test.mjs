import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from '../src/v3/db.mjs';
import { createOrg } from '../src/v3/accounts.mjs';
import { MATRIX, ROLES, roleAllows } from '../src/v3/rbac.mjs';
import { checkPepper } from '../src/v3/keys.mjs';
import { checkProviderUrl, pkcePair } from '../src/v3/oidc.mjs';
import { createRateLimiter } from '../src/v3/ratelimit.mjs';
import { eventsCsv } from '../src/v3/events.mjs';
import { checkDeploymentName, deploymentDir } from '../src/v3/workspace.mjs';
import { createServer, start } from '../src/v3/server.mjs';
import { createRouter } from '../src/v3/http.mjs';
import { bootstrap } from '../src/v3/bootstrap.mjs';
import { tmp, PEPPER } from './v3-support.test.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bin = path.join(root, 'bin', 'delomu.mjs');

test('migrations run once and record the schema version', () => {
  const dir = tmp('mig');
  const db = openDb(dir);
  const version = migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, version);
  db.close();
  const again = openDb(dir);
  assert.equal(again.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, version);
  // Constraints hold: unknown kinds and partner links on partner orgs are rejected.
  assert.throws(() => createOrg(again, { name: 'x', kind: 'vendor' }), /kind/);
  const p = createOrg(again, { name: 'Same' });
  const q = createOrg(again, { name: 'Same' });
  assert.notEqual(p.slug, q.slug);
  assert.throws(() => createOrg(again, { name: 'c', partnerOrgId: p.id }), /partner org/);
  again.close();
});

test('rbac: the matrix is monotonic (owner >= admin >= engineer/reviewer >= viewer)', () => {
  for (const perm of Object.keys(MATRIX)) {
    assert.ok(roleAllows('owner', perm), perm);
    if (roleAllows('viewer', perm)) for (const r of ROLES) assert.ok(roleAllows(r, perm), `${r} ${perm}`);
    if (roleAllows('engineer', perm) || roleAllows('reviewer', perm)) assert.ok(roleAllows('admin', perm), perm);
  }
  assert.equal(roleAllows('owner', 'no:such'), false);
});

test('config guards: pepper length, provider URLs, deployment names', () => {
  assert.throws(() => checkPepper(undefined), /DELOMU_KEY_PEPPER/);
  assert.throws(() => checkPepper('short'), /at least 16/);
  assert.throws(() => createServer({ dataDir: tmp('x'), deploymentsRoot: tmp('y'), env: {} }), /DELOMU_KEY_PEPPER/);
  assert.throws(() => createServer({ dataDir: tmp('x'), deploymentsRoot: tmp('y'), pepper: PEPPER, publicUrl: 'ftp://x' }), /http or https/);

  assert.equal(checkProviderUrl('https://login.example.com').hostname, 'login.example.com');
  assert.ok(checkProviderUrl('http://127.0.0.1:9000'));
  assert.throws(() => checkProviderUrl('http://login.example.com'), /https/);
  assert.throws(() => checkProviderUrl('javascript:alert(1)'), /https/);

  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(verifier, challenge);

  for (const ok of ['a', 'support-bot', 'v2-rollout-9']) assert.equal(checkDeploymentName(ok), ok);
  for (const bad of ['', '.', '..', 'A', 'a_b', 'a b', 'lpt1', 'com9', 'aux', '-a', 'a-', null]) assert.throws(() => checkDeploymentName(bad), /name/, String(bad));
  const base = tmp('root');
  assert.equal(deploymentDir(base, 'org_0123456789abcdef', 'bot'), path.join(base, 'org_0123456789abcdef', 'bot'));
});

test('rate limiter refills over time', () => {
  let t = 0;
  const take = createRateLimiter({ capacity: 2, refillPerSec: 1, now: () => t });
  assert.ok(take('k').ok);
  assert.ok(take('k').ok);
  const denied = take('k');
  assert.equal(denied.ok, false);
  assert.equal(denied.retryAfterSec, 1);
  assert.ok(take('other').ok, 'buckets are per credential');
  t = 1000;
  assert.ok(take('k').ok);
  assert.throws(() => createRateLimiter({ capacity: 0 }), /positive/);
});

test('CSV export quotes, neutralises formulas and reports broken chains', () => {
  const csv = eventsCsv(
    [{ id: 'evt_1', ts: 't', actor: 'human:a', action: 'member.add', target: '=HYPERLINK("x")', detail: { a: 'b,c' }, ip: '::1' }],
    [{ name: 'bot', entries: [{ seq: 1, ts: 't', actor: 'agent', action: 'x', target: '+1', detail: {} }], verify: { ok: false, brokenAt: 1, reason: 'entry was modified' } }],
  );
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(lines[1].includes('"{""a"":""b,c""}"'));
  assert.ok(lines[2].includes("'+1"));
  assert.ok(lines[2].endsWith('broken at 1: entry was modified'));
});

test('bootstrap creates the first org only once', () => {
  const dataDir = tmp('boot');
  const r = bootstrap({ dataDir, org: 'First', email: 'Owner@First.test', pepper: PEPPER });
  assert.equal(r.member.role, 'owner');
  assert.equal(r.member.email, 'owner@first.test');
  assert.match(r.secret, /^dk_/);
  assert.throws(() => bootstrap({ dataDir, org: 'Second', email: 'x@y.test', pepper: PEPPER }), /already set up/);
  assert.throws(() => bootstrap({ dataDir: tmp('boot2'), org: 'X', email: 'bad', pepper: PEPPER }), /email/);
  assert.throws(() => bootstrap({ dataDir: tmp('boot3'), org: 'X', email: 'a@b.test', pepper: 'short' }), /PEPPER/);
});

test('CLI: admin bootstrap prints the key once; serve answers /healthz', async () => {
  const dataDir = tmp('cli');
  const env = { ...process.env, DELOMU_KEY_PEPPER: PEPPER, DELOMU_HOST: '127.0.0.1' };
  const boot = spawnSync(process.execPath, [bin, 'admin', 'bootstrap', '--org', 'Cli Co', '--email', 'a@cli.test', '--kind', 'partner', '--data', dataDir], { env, encoding: 'utf8' });
  assert.equal(boot.status, 0, boot.stderr);
  assert.match(boot.stdout, /partner org "Cli Co"/);
  assert.match(boot.stdout, /dk_[A-Za-z0-9_-]{43}/);
  const usage = spawnSync(process.execPath, [bin, 'admin', 'nope'], { env, encoding: 'utf8' });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /usage: delomu admin bootstrap/);

  const child = spawn(process.execPath, [bin, 'serve', '--port', '0', '--data', dataDir], { env });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', d => { out += d; const m = /127\.0\.0\.1:(\d+)/.exec(out); if (m) resolve(m[1]); });
      child.on('exit', code => reject(new Error(`serve exited ${code}`)));
    });
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    child.kill();
  }
});

test('router: a dot in a route is literal, not "any character"', () => {
  const r = createRouter();
  r.add('GET', '/v1/orgs/:org/audit_events.csv', () => 'csv');
  assert.deepEqual(r.match('GET', '/v1/orgs/org_1/audit_events.csv').params, { org: 'org_1' });
  assert.equal(r.match('GET', '/v1/orgs/org_1/audit_eventsXcsv'), null);
});

test('createServer and start(port) read the data folder from the environment, like the Docker image', async () => {
  const dataDir = tmp('envdata');
  const server = await start(0, { host: '127.0.0.1', env: { DELOMU_DATA: dataDir, DELOMU_KEY_PEPPER: PEPPER }, log: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/healthz`);
    assert.equal(res.status, 200);
    assert.ok(fs.existsSync(path.join(dataDir, 'delomu.db')));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  assert.throws(() => createServer({ env: { DELOMU_KEY_PEPPER: PEPPER } }), /DELOMU_DATA/);
});
