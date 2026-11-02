import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLlm } from '../src/core/llm.mjs';
import { policiesChanged, policyFingerprint } from '../src/v1/policies.mjs';
import { startServer, tmp } from './v3-support.test.mjs';

test('the policy fingerprint ignores ticket exports and notices any wording change', () => {
  const dir = tmp('pol');
  assert.equal(policyFingerprint(dir), null);
  fs.mkdirSync(path.join(dir, 'inputs'));
  fs.writeFileSync(path.join(dir, 'inputs', 'refunds.md'), 'Refunds within 30 days.');
  const a = policyFingerprint(dir);
  fs.writeFileSync(path.join(dir, 'inputs', 'tickets.csv'), 'id,input\n1,hi\n');
  assert.equal(policyFingerprint(dir), a);
  const scan = { createdAt: new Date().toISOString(), policyHash: a };
  assert.equal(policiesChanged(dir, scan), false);
  fs.writeFileSync(path.join(dir, 'inputs', 'refunds.md'), 'Refunds within 14 days.');
  assert.equal(policiesChanged(dir, scan), true);
  assert.equal(policiesChanged(dir, null), false);
  // An old check without a hash: changed only when a policy file is newer than the check.
  assert.equal(policiesChanged(dir, { createdAt: '2000-01-01T00:00:00.000Z' }), true);
  assert.equal(policiesChanged(dir, { createdAt: '2999-01-01T00:00:00.000Z' }), false);
});

const llm = createLlm({ client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } } });
const srv = await startServer({ llm, env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());
const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const upload = (url, cookie, csrf, name, text) => {
  const body = new FormData();
  body.set('csrf', csrf);
  body.append('files', new Blob([text], { type: 'text/markdown' }), name);
  return fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie }, body });
};

test('uploading changed policies to a checked agent runs the check again', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'cx@pol.test', company: 'Pol' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await get('/', cookie)).text();
  const orgPath = /action="(\/orgs\/[^"/]+)\/sample"/.exec(home)[1];
  const sample = await fetch(`${srv.base}${orgPath}/sample`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrfOf(home) }) });
  const dep = sample.headers.get('location').replace(/\/scan\?.*$/, '');
  const dir = path.join(srv.deploymentsRoot, decodeURIComponent(orgPath.split('/').pop()), dep.split('/').pop());
  const csrf = csrfOf(await (await get(`${dep}/inputs`, cookie)).text());

  // No check yet: an upload is just an upload.
  assert.match((await upload(`${dep}/inputs`, cookie, csrf, 'extra.md', 'One more rule.')).headers.get('location'), /notice=uploaded/);

  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  const scan = { id: '2026-11-02T10-00-00-000Z-abcd', createdAt: '2026-11-02T10:00:00.000Z', policyHash: policyFingerprint(dir), documents: [], rationale: '', summary: { rules: 1, broken: 0, probes: 1, kept: 1, failed: 0, unjudged: 0, highRiskBroken: 0 }, rules: [] };
  fs.writeFileSync(path.join(dir, 'scans', `${scan.id}.json`), JSON.stringify(scan));
  // The same bytes again change nothing.
  assert.match((await upload(`${dep}/inputs`, cookie, csrf, 'extra.md', 'One more rule.')).headers.get('location'), /notice=uploaded/);
  // New wording: the check runs again.
  const changed = await upload(`${dep}/inputs`, cookie, csrf, 'extra.md', 'One more rule, now stricter.');
  assert.match(changed.headers.get('location'), /\/scan\?notice=policychange/);
  // The check really started (this fake model refuses, so it ends as a failed check).
  assert.match(await (await get(changed.headers.get('location'), cookie)).text(), /Checking|found nothing to test/);
});
