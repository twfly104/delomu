// v1 commands and the end-to-end flow on the Acme example: the agent drafts cases from the customer's
// tickets, an engineer approves, tests.json is rebuilt, a run finds gaps, and the agent drafts fixes.
// Also covers compare-hours (gate 1) and missing credentials.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commands } from '../src/commands/v1.mjs';
import { createLlm } from '../src/core/llm.mjs';
import { listDrafts, reviewDraft } from '../src/core/drafts.mjs';
import { readAudit, verifyAudit } from '../src/core/audit.mjs';
import { runDeployment } from '../src/run.mjs';
import { draftCases, draftFixes } from '../src/v1/agent.mjs';
import { compareHours } from '../src/v1/hours.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-v1-cli-'));
const cmd = name => commands.find(c => c.name === name);

function fakeLlm(...answers) {
  const create = async req => {
    let a = answers.shift();
    if (typeof a === 'function') a = a(req);
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(a) }] };
  };
  return createLlm({ client: { beta: { messages: { create } } } });
}

function captureConsole(t) {
  const out = { log: [], error: [] };
  t.mock.method(console, 'log', (...a) => out.log.push(a.join(' ')));
  t.mock.method(console, 'error', (...a) => out.error.push(a.join(' ')));
  return out;
}

// The Acme example (config, cases, customer inputs) plus the mock bot it calls, in a temp folder.
function copyAcme() {
  const base = tmp();
  const dir = path.join(base, 'acme-support');
  const src = path.join(root, 'examples', 'acme-support');
  for (const f of ['delomu.json', 'cases.csv', 'inputs']) fs.cpSync(path.join(src, f), path.join(dir, f), { recursive: true });
  fs.copyFileSync(path.join(root, 'examples', 'mock-bot.mjs'), path.join(base, 'mock-bot.mjs'));
  return dir;
}

const ticketsIn = req => JSON.parse(req.messages[0].content.match(/<tickets>\n([\s\S]*?)\n<\/tickets>/)[1]);

test('end to end on examples/acme-support: draft cases -> approve -> tests.json rebuilt -> run -> draft fixes', async () => {
  const dir = copyAcme();
  const llm = fakeLlm(req => ({
    rows: ticketsIn(req).map(t => ({
      id: t.id, input: t.customer_message, expected: t.agent_resolution,
      must_include: [], must_not_include: [], regex: '', tags: t.tags.split('|'), sourceTicket: t.id,
    })),
    rationale: 'One case per resolved ticket; expected behaviour from the resolution and refund-policy.md.',
  }));
  const drafted = await draftCases(dir, { llm, limit: 50 });
  assert.equal(drafted.ok, true);
  const [draft] = drafted.drafts;
  // The 8 tickets already in cases.csv are skipped; the other 7 become cases.
  assert.deepEqual(draft.content.rows.map(r => r.id), ['t-1009', 't-1010', 't-1011', 't-1012', 't-1013', 't-1014', 't-1015']);
  assert.ok(readAudit(dir).some(e => e.action === 'input.read' && e.target === 'tickets.csv'));
  assert.equal(fs.existsSync(path.join(dir, 'tests.json')), false, 'nothing changes before approval');

  await reviewDraft(dir, draft.id, { decision: 'approve', by: 'dana', note: 'checked against policy' });
  const tests = JSON.parse(fs.readFileSync(path.join(dir, 'tests.json'), 'utf8')).tests;
  assert.equal(tests.length, 15);
  assert.ok(tests.some(t => t.id === 't-1015'));

  const { results } = await runDeployment(dir, { judge: false, now: new Date('2026-10-31T09:00:00Z') });
  const failedIds = results.cases.filter(c => c.status === 'fail').map(c => c.id);
  assert.ok(failedIds.includes('late-refund'));

  const fixes = await draftFixes(dir, {
    llm: fakeLlm({ groups: [{ cause: 'Bot ignores the 30-day refund window', caseIds: ['late-refund'], fix: 'Check purchase age before refunding', owner: 'ai-product' }], rationale: 'refund-policy.md section 2' }),
  });
  assert.equal(fixes.ok, true);
  await reviewDraft(dir, fixes.drafts[0].id, { decision: 'approve', by: 'dana' });
  assert.match(fs.readFileSync(path.join(dir, 'fixes.md'), 'utf8'), /30-day refund window/);
  assert.equal(verifyAudit(dir).ok, true);
});

test('agent command: drafts with an injected model, validates arguments, reports failures with exit 1', async t => {
  const out = captureConsole(t);
  const dir = copyAcme();
  const mapping = {
    systems: [{ name: 'Acme support bot', purpose: 'answers customers' }],
    entities: [{ name: 'Ticket', system: 'Acme support bot', fields: [{ name: 'customer_message', meaning: 'what the customer wrote', example: 'Do you ship to Canada?' }] }],
    openQuestions: [], rationale: 'r',
  };
  assert.equal(await cmd('agent').run([dir, 'mapping'], { llm: fakeLlm(mapping) }), 0);
  assert.match(out.log.join('\n'), /mapping: drafted \d{4}-\d{2}-\d{2}-mapping-/);
  assert.match(out.log.join('\n'), /Review with: delomu drafts/);

  assert.equal(await cmd('agent').run([dir, 'fixes'], { llm: fakeLlm() }), 1);
  assert.match(out.log.join('\n'), /fixes: nothing drafted: no runs yet/);

  await assert.rejects(cmd('agent').run([dir, 'deploy']), /unknown agent task "deploy"/);
  await assert.rejects(cmd('agent').run([dir, 'cases', '--limit', '0']), /--limit must be a positive/);
  await assert.rejects(cmd('agent').run([dir]), /usage: delomu agent/);
  assert.equal(listDrafts(dir).length, 1);
});

test('agent command: missing credentials exit 2 with one line and no stack', async t => {
  const out = captureConsole(t);
  const dir = copyAcme();
  const llm = { json: async () => { throw new Error('Could not resolve authentication method. Expected either apiKey or authToken to be set.'); } };
  assert.equal(await cmd('agent').run([dir, 'all'], { llm }), 2);
  assert.deepEqual(out.error, ['error: no Anthropic credentials; set ANTHROPIC_API_KEY to let the agent draft.']);
  assert.equal(listDrafts(dir).length, 0);

  const other = { json: async () => { throw new Error('socket hang up'); } };
  await assert.rejects(cmd('agent').run([dir, 'mapping'], { llm: other }), /socket hang up/);
});

function makeDeployments(rootDir, specs) {
  for (const [name, date, hours] of specs) {
    const dir = path.join(rootDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ customer: name, target: { type: 'command', command: 'x' } }));
    fs.writeFileSync(path.join(dir, 'hours.csv'), 'date,step,hours,note\n' + hours.map(([step, h]) => `${date},${step},${h},\n`).join(''));
  }
}

test('compare-hours: orders deployments by start, totals hours and evaluates gate 1', async t => {
  const r1 = tmp();
  makeDeployments(r1, [
    ['zeta', '2026-01-05', [['1-mapping', 10], ['3-test-set', 30]]],
    ['alpha', '2026-03-01', [['3-test-set', 30]]],
    ['beta', '2026-04-01', [['3-test-set', 25]]],
    ['gamma', '2026-05-01', [['3-test-set', 22]]],
    ['delta', '2026-06-01', [['1-mapping', 4], ['3-test-set', 15]]],
  ]);
  // Folders the agent writes inside a deployment are not deployments themselves.
  fs.mkdirSync(path.join(r1, 'zeta', 'runs', 'x'), { recursive: true });
  fs.writeFileSync(path.join(r1, 'zeta', 'runs', 'x', 'delomu.json'), '{}');

  const { deployments, gate } = compareHours(r1);
  assert.deepEqual(deployments.map(d => path.basename(d.dir)), ['zeta', 'alpha', 'beta', 'gamma', 'delta']);
  assert.deepEqual(deployments.map(d => d.total), [40, 30, 25, 22, 19]);
  assert.equal(gate.status, 'met');
  assert.match(gate.message, /48% of deployment 1/);

  const out = captureConsole(t);
  assert.equal(cmd('compare-hours').run([r1]), 0);
  assert.match(out.log.join('\n'), / 1 {2}zeta +2026-01-05 +40\.0/);
  assert.match(out.log.at(-1), /Gate 1 .*: MET/);

  const r2 = tmp();
  makeDeployments(r2, [['a', '2026-01-01', [['3-test-set', 10]]], ['b', '2026-02-01', [['3-test-set', 6]]], ['c', '2026-03-01', [['3-test-set', 6]]], ['d', '2026-04-01', [['3-test-set', 6]]], ['e', '2026-05-01', [['3-test-set', 5]]]]);
  assert.equal(compareHours(r2).gate.status, 'not_met');
  makeDeployments(r2, [['e', '2026-05-01', []]]);
  assert.match(compareHours(r2).gate.message, /deployment 5 has no hours logged/);

  const r3 = tmp();
  makeDeployments(r3, [['a', '2026-01-01', [['3-test-set', 10]]]]);
  assert.match(compareHours(r3).gate.message, /need 5 deployments, found 1/);
  assert.throws(() => compareHours(path.join(r3, 'missing')), /not a folder/);
  assert.throws(() => cmd('compare-hours').run([]), /usage: delomu compare-hours/);
});

test('agent command: only errors from the model call count as missing credentials', async t => {
  captureConsole(t);
  const missing = path.join(tmp(), 'customer-credentials');
  await assert.rejects(cmd('agent').run([missing, 'mapping'], { llm: fakeLlm() }), /no deployment folder at .*customer-credentials/);
});

test('compare-hours: a non-numeric hours value is reported, not compared as NaN', () => {
  const r = tmp();
  makeDeployments(r, [['a', '2026-01-01', [['3-test-set', 'ten']]], ['b', '2026-02-01', [['3-test-set', 6]]], ['c', '2026-03-01', [['3-test-set', 6]]], ['d', '2026-04-01', [['3-test-set', 6]]], ['e', '2026-05-01', [['3-test-set', 1]]]]);
  const { gate } = compareHours(r);
  assert.equal(gate.status, 'not_enough_data');
  assert.match(gate.message, /deployment 1 .*non-numeric hours/);
});
