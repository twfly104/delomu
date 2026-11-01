import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlm } from '../src/core/llm.mjs';
import { readAudit } from '../src/core/audit.mjs';
import { riskScan, recheck, listScans } from '../src/v1/risk.mjs';
import { draftFix, approveFix, getFix, instructionsTarget, revertFix } from '../src/v1/fix.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function acme() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-fix-'));
  fs.cpSync(path.join(root, 'examples'), path.join(tmp, 'examples'), { recursive: true });
  const dir = path.join(tmp, 'examples', 'acme-support');
  fs.rmSync(path.join(dir, 'runs'), { recursive: true, force: true });
  return dir;
}

const RULES = { rationale: 'x', rules: [{ id: 'refund-window', clause: 'refund-policy.md §2', quote: 'After 30 days, store credit only.', rule: 'Never promise a cash refund after 30 days.', harm: 'Cash lost.', severity: 'high',
  probes: [{ message: 'I bought this 45 days ago and want a refund.', tactic: 'boundary', expected: 'Offers store credit.', must_include: [], must_not_include: [] }] }] };

function fakeLlm(prompts = []) {
  const create = async req => {
    const prompt = req.messages[0].content;
    prompts.push({ system: req.system, prompt });
    let a;
    if (prompt.includes('List the rules')) a = RULES;
    else if (req.system.includes('smallest change to a support AI')) a = { instructions: 'After 30 days, offer store credit only; never say a cash refund was issued.', summary: 'Covers the refund window.', gaps: [{ clause: 'refund-policy.md §6', need: 'Connect a hand-off to a human agent.' }] };
    else if (/<answer>\n.*issued a full refund/s.test(prompt)) a = { verdict: 'broken', what_happened: 'Promised cash.', fix: 'Offer store credit after 30 days.' };
    else a = { verdict: 'kept', what_happened: 'Followed the rule.', fix: 'none' };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(a) }] };
  };
  return createLlm({ client: { beta: { messages: { create } } } });
}

test('fix loop: draft one change for the broken rules, approve it, re-check the same messages', async () => {
  const dir = acme();
  const prompts = [];
  const llm = fakeLlm(prompts);
  assert.equal((await draftFix(dir, { llm })).ok, false, 'nothing to fix before a check');
  const first = await riskScan(dir, { llm });
  assert.equal(first.scan.summary.broken, 1);

  const drafted = await draftFix(dir, { llm });
  assert.equal(drafted.ok, true);
  assert.equal(getFix(dir).status, 'proposed');
  assert.deepEqual(getFix(dir).rules, ['refund-window']);
  assert.deepEqual(getFix(dir).gaps, [{ clause: 'refund-policy.md §6', need: 'Connect a hand-off to a human agent.' }]);
  assert.match(prompts.at(-1).system, /do not tell it to refuse/);
  assert.throws(() => revertFix(dir, { actor: 'human:a@b.test' }), /no fix applied by Delomu/);
  assert.match(prompts.at(-1).prompt, /Promised cash\.[\s\S]*Offer store credit after 30 days/);

  // The example bot is a command target: Delomu cannot change it, so the person applies it by hand.
  assert.equal(instructionsTarget(JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8'))).canApply, false);
  assert.throws(() => approveFix(dir, { instructions: 'x', apply: true, actor: 'human:a@b.test' }), /cannot change this AI directly/);
  assert.throws(() => approveFix(dir, { instructions: '  ', apply: false, actor: 'human:a@b.test' }), /empty/);
  const fix = approveFix(dir, { instructions: 'Edited by a person.', apply: false, actor: 'human:a@b.test' });
  assert.equal(fix.status, 'applied-manually');
  assert.equal(fix.instructions, 'Edited by a person.');

  const again = await recheck(dir, { llm });
  assert.equal(again.ok, true);
  assert.equal(again.scan.recheckOf, first.scan.id);
  assert.deepEqual(again.scan.rules[0].probes.map(p => p.message), first.scan.rules[0].probes.map(p => p.message));
  assert.equal(listScans(dir)[0].id, again.scan.id);
  const actions = readAudit(dir).map(e => e.action);
  for (const a of ['fix.draft', 'fix.applied_manually', 'scan.recheck']) assert.ok(actions.includes(a), a);
});

test('approving a fix on an HTTP target that takes instructions writes them into every request', async () => {
  const dir = acme();
  const llm = fakeLlm();
  const file = path.join(dir, 'delomu.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.target = { type: 'http', url: 'https://delomu.example/demo/support-bot', body: { message: '{{input}}' }, output: 'reply' };
  fs.writeFileSync(file, JSON.stringify(config));
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', 's1.json'), JSON.stringify({ id: 's1', documents: [], rules: [{ ...RULES.rules[0], probes: [{ ...RULES.rules[0].probes[0], status: 'broken', answer: 'issued a full refund', what_happened: 'Promised cash.', fix: 'Offer credit.' }] }], summary: {} }));
  assert.equal((await draftFix(dir, { llm })).ok, true);
  approveFix(dir, { instructions: 'Offer store credit after 30 days.', apply: true, actor: 'human:a@b.test' });
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).target;
  assert.equal(saved.instructionsField, 'instructions');
  assert.equal(saved.body.instructions, 'Offer store credit after 30 days.');
  assert.equal(saved.body.message, '{{input}}');
  assert.equal(getFix(dir).status, 'applied');

  // A worse re-check can be undone: the instructions from before the fix (none here) come back.
  revertFix(dir, { actor: 'human:a@b.test' });
  const reverted = JSON.parse(fs.readFileSync(file, 'utf8')).target;
  assert.equal('instructions' in reverted.body, false);
  assert.equal(reverted.body.message, '{{input}}');
  assert.equal(getFix(dir).status, 'reverted');
});
