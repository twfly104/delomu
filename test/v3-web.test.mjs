import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { registerApplier, createDraft, listDrafts } from '../src/core/drafts.mjs';
import { appendAudit } from '../src/core/audit.mjs';
import { api, startServer, seedOrg, fakeTarget, CASES_CSV, targetConfig } from './v3-support.test.mjs';

const EVIL = '<script>alert("x")</script>';

let srv;
let target;
let o;
let dir;
const applied = [];

before(async () => {
  srv = await startServer();
  target = await fakeTarget();
  o = seedOrg(srv.dataDir, { name: `Acme ${EVIL}`, members: [
    { email: 'owner@acme.test', role: 'owner' }, { email: 'rev@acme.test', role: 'reviewer' }, { email: 'view@acme.test', role: 'viewer' },
  ] });
  const key = o.keys['owner@acme.test'];
  assert.equal((await api(srv.base, 'POST', `/v1/orgs/${o.org.id}/deployments`, { key, body: { name: 'bot', config: targetConfig(target.url), cases: CASES_CSV } })).status, 201);
  assert.equal((await api(srv.base, 'POST', `/v1/orgs/${o.org.id}/deployments/bot/runs`, { key, body: {} })).status, 201);
  dir = path.join(srv.deploymentsRoot, o.org.id, 'bot');
  registerApplier('v3-web-note', (d, content) => { applied.push(content); return 'ok'; });
});

after(async () => {
  await srv.close();
  await target.close();
});

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);

// Signs in through the login form with an API key; returns { cookie, csrf } for later requests.
async function signIn(email) {
  const page = await fetch(`${srv.base}/login`);
  const loginCookie = cookiesOf(page)[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
  const res = await fetch(`${srv.base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: loginCookie },
    body: new URLSearchParams({ csrf, api_key: o.keys[email] }),
  });
  assert.equal(res.status, 303);
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await fetch(`${srv.base}/`, { headers: { cookie } });
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(await home.text())[1] };
}

const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, form) => fetch(srv.base + url, {
  method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
});

test('signed-out visitors see the public page at / and are sent to sign in elsewhere; pages carry security headers', async () => {
  const res = await get('/', '');
  assert.equal(res.status, 200);
  const landing = await res.text();
  assert.match(landing, /Go&#8209;live never waits on your client’s legal team\. <span>Their rules, tested and signed off\.<\/span><\/h1>/);
  // Every picture on the page is a recording of the product, served from this server with byte ranges.
  for (const src of landing.matchAll(/(?:src|poster)="(\/media\/[^"]+)"/g)) assert.equal((await get(src[1], '')).status, 200, src[1]);
  assert.match(res.headers.get('content-security-policy'), /media-src 'self'/);
  const range = await fetch(`${srv.base}/media/rollout.mp4`, { headers: { range: 'bytes=0-99' } });
  assert.equal(range.status, 206);
  assert.match(range.headers.get('content-range'), /^bytes 0-99\/\d+$/);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  assert.equal((await fetch(`${srv.base}/media/rollout.mp4`, { headers: { range: 'bytes=99999999-' } })).status, 416);
  assert.equal((await get('/media/nope.mp4', '')).status, 404);
  const pricing = await (await get('/pricing', '')).text();
  assert.match(pricing, /\$499<span>\/month/);
  assert.match(pricing, /\$1,500<span>\/month/);
  assert.doesNotMatch(landing, /class="lp-prices/, 'pricing has its own page');
  assert.match(landing, /href="\/login"/);
  assert.equal((await get('/orgs/anything', '')).headers.get('location'), '/login');
  const login = await fetch(`${srv.base}/login`);
  assert.match(login.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(login.headers.get('x-frame-options'), 'DENY');
  assert.match(login.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax/);
  assert.equal((await post('/logout', '', { csrf: 'x' })).status, 401);
  assert.equal((await get('/nowhere', '')).status, 404);
});

test('API-key sign-in needs the login form token and a valid key', async () => {
  const page = await fetch(`${srv.base}/login`);
  const loginCookie = cookiesOf(page)[0];
  const form = { csrf: 'forged', api_key: o.keys['owner@acme.test'] };
  const forged = await fetch(`${srv.base}/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: loginCookie }, body: new URLSearchParams(form) });
  assert.equal(forged.status, 403);
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
  const bad = await fetch(`${srv.base}/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: loginCookie }, body: new URLSearchParams({ csrf, api_key: 'dk_wrong' }) });
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /not valid/);
});

test('every page escapes org names, draft text and audit values', async () => {
  createDraft(dir, { kind: 'v3-web-note', step: 4, content: { text: EVIL }, rationale: `Because ${EVIL}` });
  appendAudit(dir, { actor: 'agent', action: 'note', target: EVIL });
  const { cookie } = await signIn('owner@acme.test');
  for (const url of ['/', `/orgs/${o.org.id}`, `/orgs/${o.org.id}/deployments/bot/scan`, `/orgs/${o.org.id}/deployments/bot/drafts`, `/orgs/${o.org.id}/audit`]) {
    const res = await get(url, cookie);
    assert.equal(res.status, 200, url);
    const body = await res.text();
    assert.ok(!body.includes('<script>'), `unescaped script on ${url}`);
    assert.ok(body.includes('&lt;script&gt;') || url.endsWith('/bot/scan'), `expected escaped text on ${url}`);
  }
});

test('deployment page lists runs with working report links; audit page shows chain status', async () => {
  const { cookie } = await signIn('view@acme.test');
  const page = await (await get(`/orgs/${o.org.id}/deployments/bot/overview`, cookie)).text();
  const link = /href="([^"]+\/report\.html)"/.exec(page)[1];
  const report = await get(link, cookie);
  assert.equal(report.status, 200);
  assert.match(await report.text(), /Acceptance report/);
  assert.equal((await get(`/orgs/${o.org.id}/deployments/bot/runs/..%2F..%2Fdelomu.json/report.html`, cookie)).status, 404);
  // Viewers have no audit access.
  assert.equal((await get(`/orgs/${o.org.id}/audit`, cookie)).status, 403);
  const owner = await signIn('owner@acme.test');
  assert.match(await (await get(`/orgs/${o.org.id}/audit`, owner.cookie)).text(), /Intact/);
});

test('draft review: approve with an edit, reject, CSRF required, viewers cannot review', async () => {
  const a = createDraft(dir, { kind: 'v3-web-note', step: 4, content: { text: 'draft a' } });
  const b = createDraft(dir, { kind: 'v3-web-note', step: 4, content: { text: 'draft b' } });
  const reviewUrl = id => `/orgs/${o.org.id}/deployments/bot/drafts/${id}/review`;

  const viewer = await signIn('view@acme.test');
  const viewPage = await (await get(`/orgs/${o.org.id}/deployments/bot/drafts`, viewer.cookie)).text();
  assert.ok(!viewPage.includes(reviewUrl(a.id)), 'viewers get no review form');
  assert.equal((await post(reviewUrl(a.id), viewer.cookie, { csrf: viewer.csrf, decision: 'approve' })).status, 403);

  const rev = await signIn('rev@acme.test');
  const page = await (await get(`/orgs/${o.org.id}/deployments/bot/drafts`, rev.cookie)).text();
  assert.ok(page.includes(reviewUrl(a.id)));
  assert.equal((await post(reviewUrl(a.id), rev.cookie, { decision: 'approve' })).status, 403, 'missing CSRF token');
  assert.equal((await post(reviewUrl(a.id), rev.cookie, { csrf: viewer.csrf, decision: 'approve' })).status, 403, 'another session\'s token');

  const badJson = await post(reviewUrl(a.id), rev.cookie, { csrf: rev.csrf, decision: 'approve', content: '{oops' });
  assert.equal(badJson.status, 400);
  assert.match(await badJson.text(), /not valid JSON/);

  const ok = await post(reviewUrl(a.id), rev.cookie, { csrf: rev.csrf, decision: 'approve', content: '{"text":"edited by a person"}', note: 'fixed tone' });
  assert.equal(ok.status, 303);
  assert.deepEqual(applied.at(-1), { text: 'edited by a person' });
  const rej = await post(reviewUrl(b.id), rev.cookie, { csrf: rev.csrf, decision: 'reject', note: 'not needed' });
  assert.equal(rej.status, 303);
  const byId = Object.fromEntries(listDrafts(dir).map(d => [d.id, d]));
  assert.equal(byId[a.id].status, 'approved');
  assert.equal(byId[a.id].edited, true);
  assert.equal(byId[a.id].reviewedBy, 'rev@acme.test');
  assert.equal(byId[b.id].status, 'rejected');
  const again = await post(reviewUrl(a.id), rev.cookie, { csrf: rev.csrf, decision: 'reject' });
  assert.equal(again.status, 409);
});

test('sessions: other orgs are invisible, logout needs CSRF and ends the session', async () => {
  const other = seedOrg(srv.dataDir, { name: 'Other', members: [{ email: 'x@other.test', role: 'owner' }] });
  const owner = await signIn('owner@acme.test');
  assert.equal((await get(`/orgs/${other.org.id}`, owner.cookie)).status, 404);
  assert.equal((await post('/logout', owner.cookie, { csrf: 'nope' })).status, 403);
  const out = await post('/logout', owner.cookie, { csrf: owner.csrf });
  assert.equal(out.status, 303);
  assert.match(out.headers.getSetCookie()[0], /Max-Age=0/);
  assert.match(await (await get('/', owner.cookie)).text(), /Go&#8209;live never waits on your client’s legal team\. <span>Their rules, tested and signed off\.<\/span><\/h1>/, 'after logout / is the public page');
  assert.ok(!fs.readdirSync(srv.deploymentsRoot).includes(other.org.id));
});

test('approving without changing the text is not recorded as a human edit', async () => {
  const d = createDraft(dir, { kind: 'v3-web-note', step: 4, content: { text: 'as drafted', n: 1 } });
  const rev = await signIn('rev@acme.test');
  const unchanged = JSON.stringify({ n: 1, text: 'as drafted' }, null, 2);
  const res = await post(`/orgs/${o.org.id}/deployments/bot/drafts/${d.id}/review`, rev.cookie, { csrf: rev.csrf, decision: 'approve', content: unchanged });
  assert.equal(res.status, 303);
  const reviewed = listDrafts(dir).find(x => x.id === d.id);
  assert.equal(reviewed.status, 'approved');
  assert.equal(reviewed.edited, undefined);
});

test('revoking the API key used to sign in ends that web session', async () => {
  const s = seedOrg(srv.dataDir, { name: 'Revoke Co', members: [{ email: 'o@revoke.test', role: 'owner' }, { email: 'e@revoke.test', role: 'engineer' }] });
  const page = await fetch(`${srv.base}/login`);
  const loginCookie = cookiesOf(page)[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
  const res = await fetch(`${srv.base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: loginCookie },
    body: new URLSearchParams({ csrf, api_key: s.keys['e@revoke.test'] }),
  });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  assert.equal((await get(`/orgs/${s.org.id}`, cookie)).status, 200);

  const owner = s.keys['o@revoke.test'];
  const keys = (await api(srv.base, 'GET', `/v1/orgs/${s.org.id}/api_keys`, { key: owner })).json.data;
  const used = keys.find(k => k.user_id === s.users['e@revoke.test']);
  assert.equal((await api(srv.base, 'DELETE', `/v1/orgs/${s.org.id}/api_keys/${used.id}`, { key: owner })).status, 200);
  assert.equal((await get(`/orgs/${s.org.id}`, cookie)).headers.get('location'), '/login');
});

test('the UI typeface is served from this server, and nothing else under /fonts', async () => {
  const res = await get('/fonts/Geist-Variable.woff2');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'font/woff2');
  assert.match(res.headers.get('cache-control'), /immutable/);
  assert.equal((await get('/fonts/..%2Fweb.mjs')).status, 404);
  assert.equal((await get('/fonts/other.woff2')).status, 404);
});
