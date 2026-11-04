import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getScan, listScans, setOverride, readOverrides } from '../src/v1/risk.mjs';
import { approveFix, undoIfWorse, getFix } from '../src/v1/fix.mjs';

// One agent folder with a check of two rules: rule a broken by its first answer, rule b kept.
function agent() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grapim-trust-'));
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ name: 'bot', target: { type: 'http', url: 'https://x.test/bot', instructionsField: 'instructions', body: { message: '{{input}}' }, output: 'reply' } }));
  fs.mkdirSync(path.join(dir, 'scans'));
  const probe = status => ({ message: 'm', tactic: 't', expected: 'e', status, answer: 'a', what_happened: 'w' });
  const scan = {
    id: 's1', createdAt: '2026-11-01T00:00:00.000Z', documents: [],
    summary: { rules: 2, broken: 1, probes: 3, kept: 2, failed: 1, unjudged: 0, highRiskBroken: 1 },
    rules: [{ id: 'a', rule: 'Rule a', severity: 'high', probes: [probe('broken'), probe('kept')] }, { id: 'b', rule: 'Rule b', severity: 'low', probes: [probe('kept')] }],
  };
  fs.writeFileSync(path.join(dir, 'scans', 's1.json'), JSON.stringify(scan));
  return dir;
}
const audit = dir => fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l).action);

test('a person can overrule the judge on one answer; every read uses the corrected verdict and the record is kept', () => {
  const dir = agent();
  setOverride(dir, { scanId: 's1', ruleId: 'a', index: 0, status: 'kept', note: 'It did offer credit', actor: 'user:amy@vendor.test', now: new Date('2026-11-02T00:00:00Z') });
  const s = getScan(dir, 's1');
  assert.deepEqual([s.summary.broken, s.summary.failed, s.summary.kept, s.summary.highRiskBroken, s.summary.overridden], [0, 0, 3, 0, 1]);
  const p = s.rules[0].probes[0];
  assert.equal(p.status, 'kept');
  assert.equal(p.judgeStatus, 'broken', 'the judge’s own verdict stays visible');
  assert.equal(p.override.by, 'user:amy@vendor.test');
  assert.equal(listScans(dir)[0].summary.broken, 0, 'lists read the same corrected verdicts');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'scans', 's1.json'), 'utf8')).rules[0].probes[0].status, 'broken', 'the check record itself is never edited');

  // A kept answer can be marked broken, and putting the judge's verdict back removes the override.
  setOverride(dir, { scanId: 's1', ruleId: 'b', index: 0, status: 'broken', actor: 'user:amy@vendor.test' });
  assert.equal(getScan(dir, 's1').summary.broken, 1);
  setOverride(dir, { scanId: 's1', ruleId: 'b', index: 0, status: 'clear', actor: 'user:amy@vendor.test' });
  setOverride(dir, { scanId: 's1', ruleId: 'a', index: 0, status: 'clear', actor: 'user:amy@vendor.test' });
  assert.deepEqual(readOverrides(dir), {});
  assert.equal(getScan(dir, 's1').summary.broken, 1);
  assert.deepEqual(audit(dir), ['verdict.override', 'verdict.override', 'verdict.restore', 'verdict.restore']);

  assert.throws(() => setOverride(dir, { scanId: 's1', ruleId: 'nope', index: 0, status: 'kept', actor: 'x' }), /not in this check/);
  assert.throws(() => setOverride(dir, { scanId: 's1', ruleId: 'a', index: 0, status: 'maybe', actor: 'x' }), /kept or broken/);
  assert.throws(() => setOverride(dir, { scanId: '../x', ruleId: 'a', index: 0, status: 'kept', actor: 'x' }), /no longer exists/);
});

test('a fix Grapim applied is undone at once when the re-check comes out worse, and kept when it helps', () => {
  const dir = agent();
  fs.writeFileSync(path.join(dir, 'fix.json'), JSON.stringify({ scanId: 's1', status: 'proposed', instructions: 'Offer store credit.', summary: 's', rules: ['a'] }));
  approveFix(dir, { instructions: 'Offer store credit.', apply: true, actor: 'user:amy@vendor.test' });
  assert.equal(getFix(dir).status, 'applied');
  const before = getScan(dir, 's1');
  const after = (broken, failed) => ({ id: 's2', recheckOf: 's1', summary: { rules: 2, broken, probes: 3, kept: 3 - failed, failed, unjudged: 0 } });

  assert.equal(undoIfWorse(dir, after(0, 0), before), false, 'better: the fix stays');
  assert.equal(undoIfWorse(dir, after(1, 1), before), false, 'the same: the fix stays');
  assert.equal(getFix(dir).status, 'applied');
  assert.equal(undoIfWorse(dir, after(2, 2), before), true, 'worse: undone');
  assert.equal(getFix(dir).status, 'reverted');
  assert.equal(getFix(dir).revertedBy, 'grapim');
  assert.equal('instructions' in JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8')).target.body, false, 'the instructions from before are back');
  assert.equal(undoIfWorse(dir, after(2, 2), before), false, 'nothing left to undo');
});
