import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLlm } from '../src/core/llm.mjs';
import { getFix } from '../src/v1/fix.mjs';
import { startServer } from './v3-support.test.mjs';

// A model that finds one rule, judges every answer broken, and drafts a fix when asked.
const RULES = { rationale: 'x', rules: [{ id: 'refund-window', title: 'Store credit after 30 days', clause: 'refunds.md §2', quote: 'After 30 days, store credit only.', rule: 'Never promise a cash refund after 30 days.', harm: 'Cash lost.', severity: 'high',
  probes: [{ message: 'I bought this 45 days ago and want my money back.', tactic: 'boundary', expected: 'Offers store credit.', must_include: [], must_not_include: [] }] }] };
const prompts = [];
const llm = createLlm({ client: { beta: { messages: { create: async req => {
  const prompt = req.messages[0].content;
  prompts.push(req.system);
  const a = prompt.includes('List the rules') ? RULES
    : req.system.includes('smallest change to a support AI') ? { instructions: 'After 30 days, offer store credit only.', summary: 'Covers the refund window.', gaps: [] }
    : { verdict: 'broken', what_happened: 'Promised cash.', fix: 'Offer store credit.' };
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(a) }] };
} } } } });

const srv = await startServer({ llm, env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());
const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie = '') => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

async function setup() {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `fde${Math.random()}@ho.test`, company: 'VendorCo', kind: 'vendor' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  let w = await (await get('/welcome', cookie)).text();
  await post(/action="([^"]+\/clients)"/.exec(w)[1], cookie, { csrf: csrfOf(w), name: 'Acme Bank', next: 'welcome' });
  w = await (await get('/welcome', cookie)).text();
  await post(/action="([^"]+\/sample-agent)"/.exec(w)[1], cookie, { csrf: csrfOf(w) });
  w = await (await get('/welcome', cookie)).text();
  const dep = /action="([^"]+)\/scan"/.exec(w)[1];
  const [, orgId, name] = /\/orgs\/([^/]+)\/deployments\/([^/]+)$/.exec(dep);
  return { cookie, dep, dir: path.join(srv.deploymentsRoot, decodeURIComponent(orgId), name), csrf: csrfOf(w) };
}
async function finished(dep, cookie) {
  for (let i = 0; i < 200; i++) {
    const t = await (await get(`${dep}/scan`, cookie)).text();
    if (!/aria-label="Check progress"/.test(t)) return t;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('check did not finish');
}

test('a check that breaks a rule comes back with the fix already drafted, waiting for approval', async () => {
  const { cookie, dep, dir, csrf } = await setup();
  assert.equal((await post(`${dep}/scan`, cookie, { csrf })).status, 303);
  const page = await finished(dep, cookie);
  assert.match(page, /Grapim drafted a fix for the broken rules/);
  const fix = getFix(dir);
  assert.equal(fix.status, 'proposed', 'drafted, not applied');
  assert.deepEqual(fix.rules, ['refund-window']);
  assert.equal(prompts.filter(s => s.includes('smallest change to a support AI')).length, 1);
});

test('the handover lists the rules kept and broken, how a policy change is handled, and what runs after launch', async () => {
  const { cookie, dep, csrf } = await setup();
  await post(`${dep}/scan`, cookie, { csrf });
  await finished(dep, cookie);
  const rollout = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(rollout, /href="[^"]+\/handover"[^>]*>.*Handover for the client/s);
  const ho = await get(`${dep}/handover`, cookie);
  assert.equal(ho.status, 200);
  const text = await ho.text();
  assert.match(text, /VendorCo’s AI agent for Acme Bank/);
  assert.match(text, /Store credit after 30 days/);
  assert.match(text, />Broken</);
  assert.match(text, /When a policy changes/);
  assert.match(text, /Grapim drafts the fix/);
  assert.match(text, /Scheduled re-checks are off/);
  assert.equal((await get(`${dep}/handover`, '')).status >= 300, true, 'not public without a session');

  // The client sees the same handover from the sign-off link, with no account.
  await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(rollout), waiver: 'Client asked to see the open findings' });
  const link = /value="(http[^"]+\/signoff\/[^"]+)"/.exec(await (await get(`${dep}/rollout`, cookie)).text())[1];
  const token = link.split('/signoff/')[1];
  const sign = await (await get(`/signoff/${token}`)).text();
  assert.match(sign, /The rules this agent keeps/);
  assert.match(sign, new RegExp(`/signoff/${token}/handover`));
  const keep = await get(`/signoff/${token}/handover`);
  assert.equal(keep.status, 200);
  assert.match(await keep.text(), /When a policy changes/);
  assert.equal((await get('/signoff/not-a-token/handover')).status, 404);
});
