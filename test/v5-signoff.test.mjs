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
  assert.doesNotMatch(page, /signoff\/link/); // no sign-off panel before a check exists
  assert.equal((await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page), waiver: 'Client asked to see the open findings' })).status, 400);

  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', `${SCAN.id}.json`), JSON.stringify(SCAN));
  page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.equal((await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page), waiver: 'Client asked to see the open findings' })).status, 303);
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
  // Accept opens only after every rule was reviewed on this link (src/v3/review.mjs).
  const early = await post(`/signoff/${token}`, clientCookie, { csrf: csrfOf(text), name: 'Dana Lee', decision: 'accepted' });
  assert.equal(early.status, 400);
  assert.match(await early.text(), /Review every rule before you accept: 0 of 1 done/);
  assert.match(text, /Start the review: 1 rules|Start the review/);
  const step = await (await get(`/signoff/${token}/review/1`, clientCookie)).text();
  assert.match(step, /Rule 1 of 1/);
  const reviewed = await post(`/signoff/${token}/review/1`, clientCookie, { csrf: csrfOf(text), rule: 'refund', state: 'ok', name: 'Dana Lee' });
  assert.equal(reviewed.status, 303);
  assert.match(reviewed.headers.get('location'), /#decide$/);
  assert.equal(readAudit(dir).filter(e => e.action === 'signoff.review' && e.detail.rule === 'refund').length, 1);
  const ok = await post(`/signoff/${token}`, clientCookie, { csrf: csrfOf(text), name: 'Dana Lee', decision: 'accepted', note: 'Fine after the refund fix' });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Accepted by Dana Lee/);
  assert.equal((await post(`/signoff/${token}`, clientCookie, { csrf: csrfOf(text), name: 'Eve', decision: 'declined' })).status, 409);

  assert.equal(readAudit(dir).filter(e => e.action === 'signoff.accepted' && e.actor === 'client:Dana Lee').length, 1);
  assert.match(await (await get(`${dep}/rollout`, cookie)).text(), /Accepted<\/span> by Dana Lee/);
  assert.match(await (await get(vendor, cookie)).text(), /Client accepted/);
});

test('revoked links say so and who to ask, without the check; unknown links show nothing', async () => {
  const { cookie, dep, dir } = await setup();
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', `${SCAN.id}.json`), JSON.stringify(SCAN));
  const page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.equal((await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page), waiver: 'Client asked to see the open findings' })).status, 303);
  const made = await (await get(`${dep}/rollout`, cookie)).text();
  const token = /\/signoff\/([^"]+)"/.exec(made)[1];
  assert.equal((await get(`/signoff/${token}`)).status, 200);
  assert.equal((await post(`${dep}/signoff/revoke`, cookie, { csrf: csrfOf(page) })).status, 303);
  const gone = await get(`/signoff/${token}`);
  assert.equal(gone.status, 410);
  const goneText = await gone.text();
  assert.match(goneText, /VendorCo replaced or withdrew this link/);
  assert.match(goneText, /mailto:fde[\d.]+@sign\.test/);
  assert.doesNotMatch(goneText, /policy rules broken|name="decision"/);
  assert.equal((await get(`/signoff/${token}/report.html`)).status, 410);
  assert.equal((await post(`/signoff/${token}`, '', { csrf: 'x', name: 'Eve', decision: 'accepted' })).status, 410);
  assert.equal((await get('/signoff/not-a-real-token-but-long-enough')).status, 404);
});

test('the vendor sees when the client opened the link; chat link previews do not count', async () => {
  const { cookie, dep, dir } = await setup();
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', `${SCAN.id}.json`), JSON.stringify(SCAN));
  let page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(page, /broke 1 of 2 rules/, 'before a link: says the check broke rules');
  await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page), waiver: 'Client asked to see the open findings' });
  page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(page, /data-copy hidden/, 'a copy button, shown only when JS runs');
  const token = /\/signoff\/([^"]+)"/.exec(page)[1];
  page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(page, /Not opened yet/);
  await fetch(`${srv.base}/signoff/${token}`, { headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)' } });
  assert.match(await (await get(`${dep}/rollout`, cookie)).text(), /Not opened yet/);
  await fetch(`${srv.base}/signoff/${token}`, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' } });
  page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(page, /Opened (just now|\d+ (s|sec|min)[^<]*ago)/);
  assert.match(page, /Waiting for the client’s decision · 1 open link/);
});

test('the client sees the ask, the sender and the decision before the handover detail', async () => {
  const { cookie, dep, dir } = await setup();
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', `${SCAN.id}.json`), JSON.stringify(SCAN));
  const page = await (await get(`${dep}/rollout`, cookie)).text();
  await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page), waiver: 'Client asked to see the open findings' });
  const token = /\/signoff\/([^"]+)"/.exec(await (await get(`${dep}/rollout`, cookie)).text())[1];
  const text = await (await get(`/signoff/${token}`)).text();
  assert.match(text, /Sent by <a href="mailto:fde[\d.]+@sign\.test">/);
  assert.match(text, /href="#decide"/);
  const decide = text.indexOf('id="decide"');
  assert.ok(decide > 0 && decide < text.indexOf('The rules this agent keeps'), 'the decision comes before the handover detail');
});

test('possessives read right for names ending in s', async () => {
  const { possessive } = await import('../src/v3/html.mjs');
  assert.equal(possessive('Northwind Agents'), 'Northwind Agents’');
  assert.equal(possessive('Linden'), 'Linden’s');
});

test('a check that kept every rule offers the client sign-off as the next step', async () => {
  const { cookie, dep, dir } = await setup();
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  const kept = { ...SCAN, summary: { ...SCAN.summary, broken: 0, kept: 2, failed: 0, highRiskBroken: 0 }, rules: SCAN.rules.map(r => ({ ...r, probes: r.probes.map(p => ({ ...p, status: 'kept' })) })) };
  fs.writeFileSync(path.join(dir, 'scans', `${SCAN.id}.json`), JSON.stringify(kept));
  let page = await (await get(`${dep}/scan`, cookie)).text();
  assert.match(page, /Ready for .* sign-off/);
  assert.match(page, /signoff\/link"/);
  assert.equal((await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page), waiver: 'Client asked to see the open findings' })).status, 303);
  page = await (await get(`${dep}/scan`, cookie)).text();
  assert.match(page, /A sign-off link is out \(1 open\)/);
  assert.doesNotMatch(page, /Create the sign-off link/);

  fs.writeFileSync(path.join(dir, 'scans', `${SCAN.id}.json`), JSON.stringify(SCAN));
  assert.doesNotMatch(await (await get(`${dep}/scan`, cookie)).text(), /Ready for .* sign-off/, 'not while a rule is broken');
});
