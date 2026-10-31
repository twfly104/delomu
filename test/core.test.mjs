import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendAudit, readAudit, verifyAudit } from '../src/core/audit.mjs';
import { createDraft, listDrafts, getDraft, reviewDraft, registerApplier } from '../src/core/drafts.mjs';
import { createLlm } from '../src/core/llm.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-core-'));

test('audit: chain verifies, and any edit or deletion is detected', () => {
  const dir = tmp();
  for (let i = 0; i < 3; i++) appendAudit(dir, { actor: 'agent', action: 'x', target: `t${i}` });
  assert.deepEqual(verifyAudit(dir), { ok: true, count: 3 });

  const file = path.join(dir, 'audit.jsonl');
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(file, lines.map((l, i) => (i === 1 ? l.replace('"t1"', '"tX"') : l)).join('\n') + '\n');
  assert.equal(verifyAudit(dir).brokenAt, 2);

  fs.writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
  assert.equal(verifyAudit(dir).ok, false);
  assert.throws(() => appendAudit(dir, { action: 'x' }), /actor/);
});

test('drafts: create, list, approve with edits, reject, and audit trail', async () => {
  const dir = tmp();
  const applied = [];
  registerApplier('test-kind', (d, content) => { applied.push(content); return 'applied'; });

  const a = createDraft(dir, { kind: 'test-kind', step: 3, content: { n: 1 }, rationale: 'because' });
  const b = createDraft(dir, { kind: 'test-kind', step: 3, content: { n: 2 } });
  assert.equal(listDrafts(dir, { status: 'pending' }).length, 2);

  await assert.rejects(reviewDraft(dir, a.id, { decision: 'approve' }), /reviewer/);
  const done = await reviewDraft(dir, a.id, { decision: 'approve', by: 'alex', content: { n: 10 } });
  assert.equal(done.status, 'approved');
  assert.equal(done.edited, true);
  assert.deepEqual(applied, [{ n: 10 }]);
  await assert.rejects(reviewDraft(dir, a.id, { decision: 'reject', by: 'alex' }), /already approved/);

  await reviewDraft(dir, b.id, { decision: 'reject', by: 'alex', note: 'wrong' });
  assert.deepEqual(applied, [{ n: 10 }]);
  assert.equal(getDraft(dir, b.id).status, 'rejected');
  assert.throws(() => getDraft(dir, '../etc'), /invalid/);

  const actions = readAudit(dir).map(e => `${e.actor} ${e.action}`);
  assert.deepEqual(actions, ['agent draft.create', 'agent draft.create', 'human:alex draft.approved', 'human:alex draft.rejected']);
  assert.equal(verifyAudit(dir).ok, true);

  const c = createDraft(dir, { kind: 'unknown-kind', content: {} });
  await assert.rejects(reviewDraft(dir, c.id, { decision: 'approve', by: 'alex' }), /no applier/);
});

test('llm: request shape, parsed data, refusal and max_tokens', async () => {
  const calls = [];
  const fake = r => ({ beta: { messages: { create: async req => { calls.push(req); return r; } } } });
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };

  const ok = await createLlm({ client: fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":"b"}' }] }) })
    .json({ system: 's', prompt: 'p', schema, effort: 'low' });
  assert.deepEqual(ok, { ok: true, data: { a: 'b' } });
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.equal(calls[0].output_config.effort, 'low');
  assert.equal(calls[0].fallbacks, 'default');

  assert.deepEqual(await createLlm({ client: fake({ stop_reason: 'refusal', content: [] }) }).json({ system: 's', prompt: 'p', schema }), { ok: false, reason: 'refusal' });
  assert.deepEqual(await createLlm({ client: fake({ stop_reason: 'max_tokens', content: [] }) }).json({ system: 's', prompt: 'p', schema }), { ok: false, reason: 'max_tokens' });
});
