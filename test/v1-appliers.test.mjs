// v1 appliers: approved drafts of the five shared kinds change the right files, re-validate
// reviewer-edited content, and leave the draft pending when the content is not valid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../src/commands/v1.mjs';
import { createDraft, reviewDraft, getDraft } from '../src/core/drafts.mjs';
import { readAudit } from '../src/core/audit.mjs';
import { parseCsv } from '../src/csv.mjs';
import { applyCases } from '../src/v1/appliers.mjs';

const CONFIG = { customer: 'Acme', name: 'rollout', target: { type: 'command', command: 'old' }, decisions: [{ date: '2026-10-01', decision: 'Accept at 90%', reason: 'kickoff' }] };

function deployment(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-v1-apply-'));
  for (const [rel, value] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  return dir;
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const json = (dir, f) => JSON.parse(read(dir, f));

async function approve(dir, kind, content, edited) {
  const d = createDraft(dir, { kind, step: 1, content });
  return reviewDraft(dir, d.id, { decision: 'approve', by: 'sam', content: edited });
}

const row = (id, extra = {}) => ({ id, input: `question ${id}`, expected: 'answers it', must_include: '', must_not_include: '', regex: '', tags: 'billing', ...extra });

test('mapping applier writes mapping.json; invalid content keeps the draft pending', async () => {
  const dir = deployment({ 'delomu.json': CONFIG });
  const content = { systems: [{ name: 'Bot', purpose: 'p' }], entities: [{ name: 'Ticket', system: 'Bot', fields: [{ name: 'id', meaning: 'm', example: 'T-1' }] }], openQuestions: [] };
  const d = await approve(dir, 'mapping', content);
  assert.equal(d.status, 'approved');
  assert.deepEqual(json(dir, 'mapping.json'), content);

  const bad = createDraft(dir, { kind: 'mapping', content: { systems: [], entities: [], openQuestions: [] } });
  await assert.rejects(reviewDraft(dir, bad.id, { decision: 'approve', by: 'sam' }), /mapping draft is not valid: mapping names no systems/);
  assert.equal(getDraft(dir, bad.id).status, 'pending');
});

test('integration applier replaces only the target, creating delomu.json if needed; edits are re-validated', async () => {
  const dir = deployment({ 'delomu.json': CONFIG });
  const target = { type: 'http', url: 'https://bot.example/chat', headers: { Authorization: 'Bearer ${BOT_KEY}' }, body: { q: '{{input}}' } };
  await approve(dir, 'integration', { target, notes: '' });
  const config = json(dir, 'delomu.json');
  assert.deepEqual(config.target, target);
  assert.deepEqual(config.decisions, CONFIG.decisions);

  const fresh = deployment();
  await approve(fresh, 'integration', { target: { type: 'command', command: 'node bot.mjs' }, notes: 'n' });
  assert.equal(json(fresh, 'delomu.json').target.command, 'node bot.mjs');

  const d = createDraft(dir, { kind: 'integration', content: { target, notes: '' } });
  const edited = { target: { ...target, headers: { Authorization: 'Bearer hunter2' } }, notes: '' };
  await assert.rejects(reviewDraft(dir, d.id, { decision: 'approve', by: 'sam', content: edited }), /must take its value from/);
  assert.equal(getDraft(dir, d.id).status, 'pending');

  // GET cannot carry the test input (the adapter sends it only in the body), so an edit to GET is refused.
  const g = createDraft(dir, { kind: 'integration', content: { target, notes: '' } });
  await assert.rejects(reviewDraft(dir, g.id, { decision: 'approve', by: 'sam', content: { target: { ...target, method: 'GET' }, notes: '' } }), /method must be POST, PUT or PATCH/);
  assert.equal(getDraft(dir, g.id).status, 'pending');
});

test('cases applier creates cases.csv with a header when missing, then rebuilds tests.json', async () => {
  const dir = deployment({ 'delomu.json': CONFIG });
  const d = await approve(dir, 'cases', { rows: [row('a', { input: 'Comma, "quote"\nnewline', must_include: 'x|y' }), row('b')] });
  assert.equal(d.status, 'approved');
  assert.equal(read(dir, 'cases.csv').split('\n')[0], 'id,input,expected,must_include,must_not_include,regex,tags');
  assert.equal(parseCsv(read(dir, 'cases.csv'))[0].input, 'Comma, "quote"\nnewline');
  const tests = json(dir, 'tests.json').tests;
  assert.deepEqual(tests.map(t => t.id), ['a', 'b']);
  assert.deepEqual(tests[0].checks.map(c => c.type), ['contains', 'contains', 'judge']);
  const audit = readAudit(dir).at(-1);
  assert.match(audit.detail.summary, /appended 2 cases; tests.json has 2 tests/);
});

test('cases applier appends in the existing column order, widens a header that lacks a needed column, and rejects taken ids', () => {
  const dir = deployment({ 'delomu.json': CONFIG, 'cases.csv': 'tags,id,input,expected\nold,o1,old q,old a' });
  applyCases(dir, { rows: [row('n1')] });
  assert.equal(read(dir, 'cases.csv'), 'tags,id,input,expected\nold,o1,old q,old a\nbilling,n1,question n1,answers it\n');

  applyCases(dir, { rows: [row('n2', { regex: '\\d+ days' })] });
  const text = read(dir, 'cases.csv');
  assert.equal(text.split('\n')[0], 'tags,id,input,expected,must_include,must_not_include,regex');
  assert.deepEqual(parseCsv(text).map(r => r.id), ['o1', 'n1', 'n2']);
  assert.equal(parseCsv(text)[2].regex, '\\d+ days');

  assert.throws(() => applyCases(dir, { rows: [row('o1')] }), /id "o1" is already used/);
  assert.throws(() => applyCases(dir, { rows: [row('z', { expected: '' })] }), /needs at least one check/);
  assert.throws(() => applyCases(dir, { rows: [row('z1'), row('z1')] }), /already used/);
  assert.throws(() => applyCases(dir, { rows: [] }), /no rows/);
  assert.equal(json(dir, 'tests.json').tests.length, 3);
});

test('fixes applier writes fixes.md with model and customer text HTML-escaped', async () => {
  const dir = deployment({ 'delomu.json': CONFIG });
  await approve(dir, 'fixes', { groups: [{ cause: 'Ignores <script>alert(1)</script> window', caseIds: ['late-refund'], fix: 'Add rule\nfor 30 days', owner: 'ai-product' }] });
  const md = read(dir, 'fixes.md');
  assert.match(md, /## 1\. Ignores &lt;script&gt;alert\(1\)&lt;\/script&gt; window/);
  assert.match(md, /- Fix: Add rule for 30 days/);
  assert.doesNotMatch(md, /<script>/);
  await assert.rejects(approve(dir, 'fixes', { groups: [{ cause: 'c', caseIds: [], fix: 'f', owner: 'o' }] }), /at least one case id/);
});

test('launch-report applier writes launch-summary.md and merges new decisions once', async () => {
  const dir = deployment({ 'delomu.json': CONFIG });
  const content = {
    summary: 'Ready to launch.',
    risks: ['Warranty | questions go to humans.'],
    decisions: [
      { date: '2026-10-01', decision: 'Accept at 90%', reason: 'kickoff' },
      { date: '2026-10-31', decision: 'Launch on Nov 3', reason: 'Pass rate 95% >= 90%.' },
    ],
  };
  await approve(dir, 'launch-report', content);
  await approve(dir, 'launch-report', content);
  const decisions = json(dir, 'delomu.json').decisions;
  assert.deepEqual(decisions.map(d => d.decision), ['Accept at 90%', 'Launch on Nov 3']);
  const md = read(dir, 'launch-summary.md');
  assert.match(md, /# Launch summary\n\nReady to launch\./);
  assert.match(md, /\| 2026-10-31 \| Launch on Nov 3 \| Pass rate 95% &gt;= 90%\. \|/);

  const noConfig = deployment();
  await assert.rejects(approve(noConfig, 'launch-report', content), /no delomu.json/);
  await assert.rejects(approve(dir, 'launch-report', { ...content, summary: '' }), /summary is empty/);
});
