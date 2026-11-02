import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readAudit } from '../src/core/audit.mjs';
import { startServer } from './v3-support.test.mjs';

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie = '') => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

// A vendor, a client workspace, the sample agent in it and one saved check, written as a scan file.
async function setup() {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `fde${Math.random()}@sign.test`, company: 'VendorCo', kind: 'vendor' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const vendor = (await get('/', cookie)).headers.get('location');
  const client = (await post(`${vendor}/clients`, cookie, { csrf: csrfOf(await (await get(vendor, cookie)).text()), name: 'Acme Bank' })).headers.get('location').split('?')[0];
  const dep = (await post(`${client}/sample`, cookie, { csrf: csrfOf(await (await get(client, cookie)).text()) })).headers.get('location').replace(/\/scan\?.*$/, '');
  const [, orgId, name] = /\/orgs\/([^/]+)\/deployments\/([^/]+)$/.exec(dep);
  const dir = path.join(srv.deploymentsRoot, decodeURIComponent(orgId), name);
  return { cookie, vendor, dep, dir };
}
const SCAN = { id: '2026-11-02T10-00-00-000Z-abcd', createdAt: '2026-11-02T10:00:00.000Z', customer: 'Acme', documents: [], rationale: '',
  summary: { rules: 2, broken: 1, probes: 2, kept: 1, failed: 1, unjudged: 0, highRiskBroken: 1 },
  rules: [{ id: 'refund', clause: '§2', quote: 'q', rule: 'No cash after 30 days <script>', harm: 'h', severity: 'high', probes: [{ message: 'm', tactic: 't', expected: 'e', must_include: [], must_not_include: [], status: 'broken', answer: 'a', what_happened: 'w', fix: 'f' }] }] };

test('a client accepts an AI agent from a link, without an account, once', async () => {
  const { cookie, vendor, dep, dir } = await setup();
  let page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(page, /Client sign-off/);
  assert.match(page, /Run the policy check first/);
  assert.equal((await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page) })).status, 400);

  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', `${SCAN.id}.json`), JSON.stringify(SCAN));
  page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.equal((await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page) })).status, 303);
  const made = await (await get(`${dep}/rollout`, cookie)).text();
  const link = /value="(http[^"]+\/signoff\/[^"]+)"/.exec(made)[1];
  const token = link.split('/signoff/')[1];
  assert.match(made, /Shown only once/);
  assert.doesNotMatch(await (await get(`${dep}/rollout`, cookie)).text(), /Shown only once/, 'a reload does not show or make the link again');
  assert.match(made, /Revoke 1 open link/);

  // The client: no session cookie at all.
  const open = await get(`/signoff/${token}`);
  const text = await open.text();
  assert.equal(open.status, 200);
  assert.match(text, /VendorCo asks you to review/);
  assert.match(text, /1 of 2 policy rules broken/);
  const report = await (await get(`/signoff/${token}/report.html`)).text();
  assert.match(report, /&lt;script&gt;/);
  assert.doesNotMatch(report, /<script>/);
  const clientCookie = cookiesOf(open)[0];
  assert.equal((await post(`/signoff/${token}`, clientCookie, { csrf: 'forged', name: 'Dana', decision: 'accepted' })).status, 403);
  assert.equal((await post(`/signoff/${token}`, clientCookie, { csrf: csrfOf(text), name: ' ', decision: 'accepted' })).status, 400);
  const ok = await post(`/signoff/${token}`, clientCookie, { csrf: csrfOf(text), name: 'Dana Lee', decision: 'accepted', note: 'Fine after the refund fix' });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Accepted by Dana Lee/);
  assert.equal((await post(`/signoff/${token}`, clientCookie, { csrf: csrfOf(text), name: 'Eve', decision: 'declined' })).status, 409);

  assert.equal(readAudit(dir).filter(e => e.action === 'signoff.accepted' && e.actor === 'client:Dana Lee').length, 1);
  assert.match(await (await get(`${dep}/rollout`, cookie)).text(), /Accepted<\/span> by Dana Lee/);
  assert.match(await (await get(vendor, cookie)).text(), /Client accepted/);
});

test('revoked and unknown links show nothing', async () => {
  const { cookie, dep, dir } = await setup();
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', `${SCAN.id}.json`), JSON.stringify(SCAN));
  const page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.equal((await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page) })).status, 303);
  const made = await (await get(`${dep}/rollout`, cookie)).text();
  const token = /\/signoff\/([^"]+)"/.exec(made)[1];
  assert.equal((await get(`/signoff/${token}`)).status, 200);
  assert.equal((await post(`${dep}/signoff/revoke`, cookie, { csrf: csrfOf(page) })).status, 303);
  assert.equal((await get(`/signoff/${token}`)).status, 404);
  assert.equal((await get('/signoff/not-a-real-token-but-long-enough')).status, 404);
});
