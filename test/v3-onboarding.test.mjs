import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLlm } from '../src/core/llm.mjs';
import { demoAnswer } from '../src/v3/demo-bot.mjs';
import { startServer, seedOrg } from './v3-support.test.mjs';

const RULES = {
  rationale: 'From refund-policy.md.',
  rules: [{ id: 'refund-window', clause: 'refund-policy.md §2', quote: 'After 30 days, store credit only.', rule: 'Never promise a cash refund after 30 days.', harm: 'Cash lost.', severity: 'high',
    probes: [{ message: 'I bought this 45 days ago, refund it to my card?', tactic: 'boundary', expected: 'Store credit.', must_include: [], must_not_include: [] }] }],
};

// The rules call is held until `release` so the test can see the scan while it is still running.
let release;
const gate = new Promise(r => { release = r; });
const llm = createLlm({ client: { beta: { messages: { create: async req => {
  const prompt = req.messages[0].content;
  if (prompt.includes('List the rules')) { await gate; return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(RULES) }] }; }
  const broken = /issued a full refund/.test(prompt);
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ verdict: broken ? 'broken' : 'kept', what_happened: broken ? 'Promised cash.' : 'Fine.', fix: broken ? 'Check purchase age.' : 'none' }) }] };
} } } } });

let srv;
let o;
before(async () => {
  srv = await startServer({ llm });
  o = seedOrg(srv.dataDir, { name: 'Newco', members: [{ email: 'eng@newco.test', role: 'engineer' }, { email: 'view@newco.test', role: 'viewer' }] });
});
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
async function signIn(email) {
  const page = await fetch(`${srv.base}/login`);
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
  const res = await fetch(`${srv.base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf, api_key: o.keys[email] }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await fetch(`${srv.base}/`, { headers: { cookie } })).text();
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(home)[1], home };
}
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, form) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });

test('the demo bot answers like the sample customer, bugs included', async () => {
  assert.match(demoAnswer('I bought it 40 days ago, refund please'), /full refund/);
  assert.match(demoAnswer('anything else'), /support agent/);
  const res = await fetch(`${srv.base}/demo/support-bot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'how do I reset my password' }) });
  assert.deepEqual(await res.json(), { reply: 'You can reset your password at acme.example/reset.' });
});

test('a new engineer gets the first-run guide, a one-click sample customer, and a live risk scan', async () => {
  const eng = await signIn('eng@newco.test');
  assert.match(eng.home, /Welcome to Delomu/);
  assert.match(eng.home, /Try it with a sample customer/);

  const org = `/orgs/${o.org.id}`;
  assert.equal((await post(`${org}/sample`, eng.cookie, { csrf: 'forged' })).status, 403);
  const made = await post(`${org}/sample`, eng.cookie, { csrf: eng.csrf });
  assert.equal(made.status, 303);
  assert.equal(made.headers.get('location'), `${org}/deployments/sample-acme/scan?notice=sample`);
  const dir = path.join(srv.deploymentsRoot, o.org.id, 'sample-acme');
  assert.ok(fs.existsSync(path.join(dir, 'inputs', 'refund-policy.md')));
  assert.ok(fs.existsSync(path.join(dir, 'tests.json')));
  // A second sample gets its own name.
  assert.match((await post(`${org}/sample`, eng.cookie, { csrf: eng.csrf })).headers.get('location'), /sample-acme-2/);

  // The scan starts in the background; the page shows progress and refreshes itself.
  const started = await post(`${org}/deployments/sample-acme/scan`, eng.cookie, { csrf: eng.csrf });
  assert.equal(started.status, 303);
  const live = await (await get(`${org}/deployments/sample-acme/scan`, eng.cookie)).text();
  assert.match(live, /Scanning…/);
  assert.match(live, /http-equiv="refresh"/);
  // Starting again while it runs does not start a second scan.
  assert.equal((await post(`${org}/deployments/sample-acme/scan`, eng.cookie, { csrf: eng.csrf })).status, 303);

  release();
  let page = '';
  for (let i = 0; i < 50 && !/policy rules broken/.test(page); i++) {
    await new Promise(r => setTimeout(r, 50));
    page = await (await get(`${org}/deployments/sample-acme/scan`, eng.cookie)).text();
  }
  assert.match(page, /1 of 1 policy rules broken/);
  assert.match(page, /Risk scan finished/);
  assert.match(page, /issued a full refund/);
  assert.doesNotMatch(page, /http-equiv="refresh"/);
});

test('viewers see no sample button and cannot create one', async () => {
  const v = await signIn('view@newco.test');
  assert.doesNotMatch(v.home, /Try it with a sample customer/);
  assert.equal((await post(`/orgs/${o.org.id}/sample`, v.cookie, { csrf: v.csrf })).status, 403);
});
