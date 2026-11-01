import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLlm } from '../src/core/llm.mjs';
import { checkConversation, liveSummary, setLiveSettings, getLiveSettings, listConversations } from '../src/v1/live.mjs';
import { startServer, seedOrg } from './v3-support.test.mjs';

const RULE = { id: 'refund-window', clause: 'refund-policy.md §2', quote: 'After 30 days, store credit only.', rule: 'Never promise a cash refund after 30 days.', harm: 'Cash lost.', severity: 'high' };
const NOW = new Date('2026-11-01T12:00:00Z');

// A deployment folder with one finished scan, which is where live monitoring takes its rules from.
function scanned() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-live-'));
  fs.mkdirSync(path.join(dir, 'scans'));
  fs.writeFileSync(path.join(dir, 'scans', '2026-10-31-x.json'), JSON.stringify({ id: '2026-10-31-x', rules: [{ ...RULE, probes: [] }] }));
  return dir;
}

// Breaks the refund rule whenever the answer promises a full refund; records every prompt it sees.
function fakeLlm() {
  const prompts = [];
  return {
    prompts,
    json: async ({ prompt }) => {
      prompts.push(prompt);
      const broken = /full refund/.test(prompt.split('<answer>')[1] ?? '');
      return { ok: true, data: { violations: broken ? [{ rule_id: 'refund-window', what_happened: 'Promised cash at day 45.', fix: 'Check the purchase date.' }, { rule_id: 'made-up', what_happened: 'x', fix: 'x' }] : [] } };
    },
  };
}

test('live: needs a risk scan, and both sides of the conversation', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-live-'));
  assert.match((await checkConversation(empty, { message: 'a', answer: 'b' }, { llm: fakeLlm() })).reason, /risk scan first/);
  assert.match((await checkConversation(scanned(), { message: 'hi', answer: ' ' }, { llm: fakeLlm() })).reason, /both/);
});

test('live: judges against the scan rules, scrubs personal data, keeps unknown rules out', async () => {
  const dir = scanned();
  const llm = fakeLlm();
  const bad = await checkConversation(dir, { message: 'Bought 45 days ago, refund to jane@acme.test please', answer: 'Sure, I issued a full refund.', id: 'T-9' }, { llm, now: NOW });
  assert.equal(bad.record.status, 'flagged');
  assert.deepEqual(bad.record.violations.map(v => [v.rule, v.clause, v.severity]), [['refund-window', 'refund-policy.md §2', 'high']]);
  assert.equal(bad.record.externalId, 'T-9');
  assert.doesNotMatch(bad.record.message, /jane@acme/);
  assert.doesNotMatch(llm.prompts[0], /jane@acme/, 'the model never sees the email either');
  assert.match(llm.prompts[0], /<rule id="refund-window"/);

  const good = await checkConversation(dir, { message: 'Refund after 45 days?', answer: 'After 30 days we can offer store credit.' }, { llm, now: NOW });
  assert.equal(good.record.status, 'ok');

  const s = liveSummary(dir, NOW);
  assert.deepEqual(s.week, { checked: 2, flagged: 1, unjudged: 0 });
  assert.equal(s.rules[0].count, 1);
  assert.equal(s.checkedThisMonth, 2);
  assert.equal(listConversations(dir, '2026-11')[0].id, good.record.id, 'newest first');
});

test('live: a broken high-risk rule alerts once an hour, never failing the check', async () => {
  const dir = scanned();
  assert.throws(() => setLiveSettings(dir, { webhook: 'http://hooks.example' }), /https/);
  setLiveSettings(dir, { webhook: 'https://hooks.example/abc' });
  assert.equal(getLiveSettings(dir).webhook, 'https://hooks.example/abc');
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200 }; };
  const input = { message: 'refund after 45 days?', answer: 'Yes, full refund.' };
  await checkConversation(dir, input, { llm: fakeLlm(), now: NOW, fetchImpl });
  await checkConversation(dir, input, { llm: fakeLlm(), now: new Date(NOW.getTime() + 10 * 60_000), fetchImpl });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /high-risk rule/);
  await checkConversation(dir, input, { llm: fakeLlm(), now: new Date(NOW.getTime() + 61 * 60_000), fetchImpl });
  assert.equal(sent.length, 2);

  const logs = [];
  const down = async () => ({ ok: false, status: 500 });
  const r = await checkConversation(dir, input, { llm: fakeLlm(), now: new Date(NOW.getTime() + 200 * 60_000), fetchImpl: down, log: m => logs.push(m) });
  assert.equal(r.record.status, 'flagged');
  assert.match(logs[0], /not delivered/);
});

// ---- Through the server ------------------------------------------------------------------------------

const RULES = { rationale: 'From refund-policy.md.', rules: [{ ...RULE, probes: [{ message: 'I bought this 45 days ago, refund it to my card?', tactic: 'boundary', expected: 'Store credit.', must_include: [], must_not_include: [] }] }] };
const llm = createLlm({ client: { beta: { messages: { create: async req => {
  const prompt = req.messages[0].content;
  let out;
  if (prompt.includes('List the rules')) out = RULES;
  else if (prompt.includes('<rule id=')) out = { violations: /full refund/.test(prompt.split('<answer>')[1]) ? [{ rule_id: 'refund-window', what_happened: 'Promised cash.', fix: 'Check purchase age.' }] : [] };
  else out = { verdict: /full refund/.test(prompt) ? 'broken' : 'kept', what_happened: 'x', fix: 'none' };
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(out) }] };
} } } } });

let srv;
let o;
before(async () => {
  srv = await startServer({ llm });
  o = seedOrg(srv.dataDir, { name: 'Liveco', members: [{ email: 'eng@live.test', role: 'engineer' }, { email: 'view@live.test', role: 'viewer' }] });
});
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
async function signIn(email) {
  const page = await fetch(`${srv.base}/login`);
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
  const res = await fetch(`${srv.base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf, api_key: o.keys[email] }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await fetch(`${srv.base}/`, { headers: { cookie } })).text();
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(home)[1] };
}
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, form) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
const until = async (fn, test) => { let v; for (let i = 0; i < 100; i++) { v = await fn(); if (test(v)) return v; await new Promise(r => setTimeout(r, 50)); } return v; };

test('live through the server: sample traffic, the API, the page, viewers and the plan limit', async () => {
  const eng = await signIn('eng@live.test');
  const org = `/orgs/${o.org.id}`;
  const dep = `${org}/deployments/sample-acme`;
  await post(`${org}/sample`, eng.cookie, { csrf: eng.csrf });

  // Before a scan the page explains what is needed.
  assert.match(await (await get(`${dep}/live`, eng.cookie)).text(), /Run the check first/);
  await post(`${dep}/scan`, eng.cookie, { csrf: eng.csrf });
  await until(async () => (await get(`${dep}/scan`, eng.cookie)).text(), t => /policy rules broken/.test(t));

  // Sample traffic replays the customer's tickets through their AI and judges every answer.
  assert.equal((await post(`${dep}/live/replay`, eng.cookie, { csrf: eng.csrf })).status, 303);
  const page = await until(async () => (await get(`${dep}/live`, eng.cookie)).text(), t => /Sample traffic checked/.test(t));
  assert.match(page, /Conversations checked/);
  assert.match(page, /Broke a rule/);
  assert.match(page, /Never promise a cash refund after 30 days/);
  assert.match(page, /conversations:write/);

  // The API: a help desk posts one exchange, then lists the flagged ones.
  const api = `${srv.base}/v1/orgs/${o.org.id}/deployments/sample-acme/conversations`;
  const auth = { authorization: `Bearer ${o.keys['eng@live.test']}`, 'content-type': 'application/json' };
  const made = await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'Day 45, refund to card?', answer: 'Done, full refund issued.', id: 'zd-77' }) });
  assert.equal(made.status, 201);
  const rec = await made.json();
  assert.equal(rec.object, 'conversation');
  assert.equal(rec.status, 'flagged');
  const flagged = await (await fetch(`${api}?status=flagged`, { headers: auth })).json();
  assert.ok(flagged.data.some(c => c.externalId === 'zd-77'));
  assert.equal((await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'only one side' }) })).status, 400);

  // Viewers can read the page but not send conversations or change alerts.
  const v = await signIn('view@live.test');
  const vPage = await (await get(`${dep}/live`, v.cookie)).text();
  assert.doesNotMatch(vPage, /Check one conversation/);
  assert.equal((await post(`${dep}/live/check`, v.cookie, { csrf: v.csrf, message: 'a', answer: 'b' })).status, 403);
  assert.equal((await fetch(api, { method: 'POST', headers: { ...auth, authorization: `Bearer ${o.keys['view@live.test']}` }, body: '{}' })).status, 403);

  // Free includes 200 live conversations a month; the next one is refused with an upgrade link.
  const file = path.join(srv.deploymentsRoot, o.org.id, 'sample-acme', 'live', `${new Date().toISOString().slice(0, 7)}.jsonl`);
  fs.appendFileSync(file, '{}\n'.repeat(200));
  const over = await fetch(api, { method: 'POST', headers: auth, body: JSON.stringify({ message: 'hi', answer: 'hello' }) });
  assert.equal(over.status, 402);
  assert.equal((await over.json()).error.code, 'plan_limit_conversations');
});
