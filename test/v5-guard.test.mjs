import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAudit } from '../src/core/audit.mjs';
import { DEFAULT_GUARD_MODEL, guardModel } from '../src/core/llm.mjs';
import { guardReply } from '../src/v1/guard.mjs';
import { countConversations, listConversations } from '../src/v1/live.mjs';
import { api, fakeTarget, seedOrg, startServer, targetConfig } from './v3-support.test.mjs';

const RULE = { id: 'refund-window', clause: 'refund-policy.md §2', quote: 'After 30 days, store credit only.', rule: 'Never promise a cash refund after 30 days.', harm: 'Cash lost.', severity: 'high' };
const NOW = new Date('2026-11-01T12:00:00Z');
const SAFE = 'After 30 days we can offer store credit for this order.';

const writeScan = dir => {
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', '2026-10-31-x.json'), JSON.stringify({ id: '2026-10-31-x', rules: [{ ...RULE, probes: [] }] }));
};
function scanned(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-guard-'));
  writeScan(dir);
  if (config) fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify(config));
  return dir;
}

// Breaks the refund rule when the reply promises a full refund. mode: 'rewrite' (gives a safe reply),
// 'block' (no safe reply), 'refuse' or 'throw'. Records every call.
function fakeLlm(state = { mode: 'rewrite' }) {
  const calls = [];
  return {
    state, calls,
    json: async req => {
      calls.push(req);
      if (state.mode === 'throw') throw new Error('upstream 529 overloaded');
      if (state.mode === 'refuse') return { ok: false, reason: 'refusal' };
      const broken = /full refund/.test(req.prompt.split('<answer>')[1] ?? '');
      return { ok: true, data: {
        violations: broken ? [{ rule_id: 'refund-window', what_happened: 'Promised cash at day 45.' }, { rule_id: 'made-up', what_happened: 'x' }] : [],
        safe_reply: broken && state.mode === 'rewrite' ? SAFE : '',
      } };
    },
  };
}

const BAD = { message: 'Bought 45 days ago, refund to jane@acme.test please', reply: 'Sure, I issued a full refund.' };

test('guard: a reply that keeps the rules is allowed, and still counts and is audited', async () => {
  const dir = scanned();
  const r = await guardReply(dir, { message: 'Refund after 45 days?', reply: 'We can offer store credit.' }, { llm: fakeLlm(), now: NOW });
  assert.equal(r.decision, 'allow');
  assert.deepEqual(r.violations, []);
  assert.equal(r.safeReply, undefined);
  assert.equal(r.unjudged, undefined);
  assert.equal(countConversations(dir, '2026-11'), 1);
  assert.equal(listConversations(dir, '2026-11')[0].source, 'guard');
  assert.ok(readAudit(dir).some(e => e.action === 'guard.check' && e.target === r.id));
});

test('guard: a broken rule with a safe reply is rewritten; personal data never reaches the model', async () => {
  const dir = scanned({ agentKind: 'billing' });
  const llm = fakeLlm();
  const r = await guardReply(dir, BAD, { llm, now: NOW });
  assert.equal(r.decision, 'rewrite');
  assert.equal(r.safeReply, SAFE);
  assert.deepEqual(r.violations, [{ rule: 'refund-window', clause: 'refund-policy.md §2', severity: 'high', what_happened: 'Promised cash at day 45.' }]);
  assert.equal(llm.calls.length, 1, 'one model call');
  assert.doesNotMatch(llm.calls[0].prompt, /jane@acme/);
  assert.match(llm.calls[0].prompt, /<rule id="refund-window"/);
  assert.match(llm.calls[0].system, /billing AI/, 'uses the agent kind wording');
  assert.ok(llm.calls[0].schema.properties.safe_reply);
  const stored = listConversations(dir, '2026-11')[0];
  assert.equal(stored.status, 'flagged');
  assert.equal(stored.decision, 'rewrite');
  assert.doesNotMatch(stored.message, /jane@acme/);
});

test('guard: a broken rule with no safe reply is blocked', async () => {
  const r = await guardReply(scanned(), BAD, { llm: fakeLlm({ mode: 'block' }), now: NOW });
  assert.equal(r.decision, 'block');
  assert.equal(r.safeReply, undefined);
  assert.equal(r.violations.length, 1);
});

test('guard: fails open with no scan, on a refusal, on a model error and on a slow model', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-guard-'));
  const llm = fakeLlm();
  const none = await guardReply(empty, BAD, { llm, now: NOW });
  assert.equal(none.decision, 'allow');
  assert.equal(none.unjudged, true);
  assert.match(none.reason, /risk scan/);
  assert.equal(llm.calls.length, 0, 'no model call without rules');
  assert.equal(countConversations(empty, '2026-11'), 0);

  const refused = await guardReply(scanned(), BAD, { llm: fakeLlm({ mode: 'refuse' }), now: NOW });
  assert.deepEqual([refused.decision, refused.unjudged], ['allow', true]);
  assert.match(refused.reason, /refused/);

  const dir = scanned();
  const logs = [];
  const broken = await guardReply(dir, BAD, { llm: fakeLlm({ mode: 'throw' }), now: NOW, log: m => logs.push(m) });
  assert.deepEqual([broken.decision, broken.unjudged, broken.violations], ['allow', true, []]);
  assert.match(logs[0], /529/);
  assert.equal(listConversations(dir, '2026-11')[0].status, 'unjudged');

  const slow = { json: () => new Promise(() => {}) };
  const late = await guardReply(scanned(), BAD, { llm: slow, now: NOW, timeoutMs: 20 });
  assert.deepEqual([late.decision, late.unjudged], ['allow', true]);
});

test('guard: model defaults to Haiku and DELOMU_GUARD_MODEL overrides it', () => {
  assert.equal(DEFAULT_GUARD_MODEL, 'claude-haiku-5-5');
  assert.equal(guardModel({}), 'claude-haiku-5-5');
  assert.equal(guardModel({ DELOMU_GUARD_MODEL: 'claude-sonnet-5-5' }), 'claude-sonnet-5-5');
});

// ---- Through the server ------------------------------------------------------------------------------

const state = { mode: 'rewrite' };
let srv;
let target;
let o;
before(async () => {
  srv = await startServer({ llm: fakeLlm(state) });
  target = await fakeTarget();
  o = seedOrg(srv.dataDir, { name: 'Guardco', members: [
    { email: 'owner@guard.test', role: 'owner' },
    { email: 'eng@guard.test', role: 'engineer' },
    { email: 'view@guard.test', role: 'viewer' },
    { email: 'narrow@guard.test', role: 'engineer', scopes: ['conversations:write'] },
    { email: 'scoped@guard.test', role: 'engineer', scopes: ['guard:check'] },
  ] });
});
after(async () => { await srv.close(); await target.close(); });

test('guard through the API: decisions, fail-open, scope, idempotency and the plan limit', async () => {
  const eng = o.keys['eng@guard.test'];
  const base = `/v1/orgs/${o.org.id}/deployments`;
  assert.equal((await api(srv.base, 'POST', base, { key: eng, body: { name: 'bot', config: targetConfig(target.url) } })).status, 201);
  const url = `${base}/bot/guard`;

  // No scan yet: allowed, unjudged.
  state.mode = 'rewrite';
  let r = await api(srv.base, 'POST', url, { key: eng, body: BAD });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.object, r.json.decision, r.json.unjudged], ['guard_check', 'allow', true]);

  writeScan(path.join(srv.deploymentsRoot, o.org.id, 'bot'));
  r = await api(srv.base, 'POST', url, { key: eng, body: BAD });
  assert.deepEqual([r.json.decision, r.json.safeReply], ['rewrite', SAFE]);
  assert.equal((await api(srv.base, 'POST', url, { key: eng, body: { message: 'hi', reply: 'Hello!' } })).json.decision, 'allow');
  state.mode = 'block';
  assert.equal((await api(srv.base, 'POST', url, { key: eng, body: BAD })).json.decision, 'block');
  state.mode = 'throw';
  r = await api(srv.base, 'POST', url, { key: eng, body: BAD });
  assert.deepEqual([r.status, r.json.decision, r.json.unjudged], [200, 'allow', true]);
  state.mode = 'rewrite';

  // Bad input is the caller's bug, not a model failure.
  assert.equal((await api(srv.base, 'POST', url, { key: eng, body: { message: 'hi' } })).status, 400);

  // Org events record each intervention.
  const events = await api(srv.base, 'GET', `/v1/orgs/${o.org.id}/audit_events?limit=100`, { key: o.keys['owner@guard.test'] });
  assert.ok(events.json.data.some(e => e.action === 'guard.rewrite'));

  // Idempotency-Key replays the first decision instead of judging again.
  const headers = { 'idempotency-key': 'guard-1' };
  const a = await api(srv.base, 'POST', url, { key: eng, body: BAD, headers });
  const b = await api(srv.base, 'POST', url, { key: eng, body: BAD, headers });
  assert.equal(b.text, a.text);
  assert.equal(b.headers.get('idempotent-replayed'), 'true');

  // Scope: viewers and keys without guard:check are refused; a key with only guard:check works.
  assert.equal((await api(srv.base, 'POST', url, { key: o.keys['view@guard.test'], body: BAD })).status, 403);
  assert.equal((await api(srv.base, 'POST', url, { key: o.keys['narrow@guard.test'], body: BAD })).status, 403);
  assert.equal((await api(srv.base, 'POST', url, { key: o.keys['scoped@guard.test'], body: BAD })).status, 200);

  // Guard checks count toward the plan's live conversations; past Free's 200 they are refused with 402.
  const file = path.join(srv.deploymentsRoot, o.org.id, 'bot', 'live', `${new Date().toISOString().slice(0, 7)}.jsonl`);
  fs.appendFileSync(file, '{}\n'.repeat(200));
  const over = await api(srv.base, 'POST', url, { key: eng, body: BAD });
  assert.equal(over.status, 402);
  assert.equal(over.json.error.code, 'plan_limit_conversations');
});

test('guard: the per-key rate limit applies', async () => {
  const s = await startServer({ llm: fakeLlm(), rateLimit: { capacity: 2, refillPerSec: 0.01 } });
  try {
    const x = seedOrg(s.dataDir, { name: 'Ratey', members: [{ email: 'e@rate.test', role: 'engineer' }] });
    const url = `/v1/orgs/${x.org.id}/deployments/none/guard`;
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await api(s.base, 'POST', url, { key: x.keys['e@rate.test'], body: BAD })).status);
    assert.equal(codes[2], 429);
  } finally {
    await s.close();
  }
});
