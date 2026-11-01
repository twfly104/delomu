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

test('llm: provider choice from the environment', async () => {
  const { pickProvider } = await import('../src/core/llm.mjs');
  assert.equal(pickProvider({}), 'anthropic');
  assert.equal(pickProvider({ LLAMA_API_KEY: 'x' }), 'meta');
  assert.equal(pickProvider({ MODEL_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' }), 'anthropic');
  assert.equal(pickProvider({ ANTHROPIC_API_KEY: 'y', DELOMU_LLM_PROVIDER: 'Meta' }), 'meta');
  assert.throws(() => pickProvider({ DELOMU_LLM_PROVIDER: 'openai' }), /must be/);
});

test('llm: Meta provider request shape, retries, refusals and auth errors', async () => {
  const { AuthError } = await import('../src/core/llm.mjs');
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
  const env = { MODEL_API_KEY: 'k-123' };
  const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
  const ok = content => reply(200, { choices: [{ finish_reason: 'stop', message: { content } }] });

  const calls = [];
  const queue = [reply(429, { error: { message: 'slow down' } }, { 'retry-after': '0.01' }), ok('{"a":"b"}')];
  const fetch = async (url, init) => { calls.push({ url, init }); return queue.shift(); };
  const llm = createLlm({ provider: 'meta', model: 'claude-opus-5-5', env, fetch });
  assert.equal(llm.model, 'muse-spark-1.3');
  assert.deepEqual(await llm.json({ system: 's', prompt: 'p', schema, effort: 'low' }), { ok: true, data: { a: 'b' } });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://api.meta.ai/v1/chat/completions');
  assert.equal(calls[1].init.headers.authorization, 'Bearer k-123');
  const body = JSON.parse(calls[1].init.body);
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.messages.map(m => m.role), ['system', 'user']);

  const once = r => createLlm({ provider: 'meta', env, fetch: async () => r });
  assert.deepEqual(await once(reply(200, { choices: [{ finish_reason: 'content_filter', message: {} }] })).json({ system: 's', prompt: 'p', schema }), { ok: false, reason: 'refusal' });
  assert.deepEqual(await once(reply(200, { choices: [{ finish_reason: 'length', message: { content: '{"a"' } }] })).json({ system: 's', prompt: 'p', schema }), { ok: false, reason: 'max_tokens' });
  await assert.rejects(once(reply(401, { error: { message: 'bad key' } })).json({ system: 's', prompt: 'p', schema }), AuthError);
  await assert.rejects(once(reply(400, { error: { message: 'bad schema' } })).json({ system: 's', prompt: 'p', schema }), /HTTP 400\): bad schema/);
  await assert.rejects(createLlm({ provider: 'meta', env: {}, fetch }).json({ system: 's', prompt: 'p', schema }), AuthError);
  assert.throws(() => createLlm({ provider: 'meta', model: 'muse-spark-1.3-contributor', env }), /training/);

  // An unknown model lists the ones the key can use; DELOMU_META_URL moves both calls to another base.
  const urls = [];
  const notFound = createLlm({ provider: 'meta', env: { ...env, DELOMU_META_URL: 'https://llm.example/v1/' }, fetch: async url => {
    urls.push(url);
    return url.endsWith('/models')
      ? reply(200, { data: [{ id: 'model-a' }, { id: 'model-b-contributor' }, { id: 'model-c' }] })
      : reply(404, { error: { message: 'The requested model was not found.' } });
  } });
  await assert.rejects(notFound.json({ system: 's', prompt: 'p', schema }), /set DELOMU_META_MODEL to one of: model-a, model-c\.$/);
  assert.deepEqual(urls, ['https://llm.example/v1/chat/completions', 'https://llm.example/v1/models']);
});
