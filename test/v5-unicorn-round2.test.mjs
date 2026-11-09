// Round 2 of the unicorn bar (research_notes/product-ux-research-2026-11-09.md): one rollout status word per agent,
// a flagged live conversation turned into test messages, and the evidence pack stamped as a snapshot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDrafts } from '../src/core/drafts.mjs';
import { conversationToTests } from '../src/v1/live-to-tests.mjs';
import { rolloutStatus } from '../src/v3/html.mjs';
import { buildEvidence, renderEvidence } from '../src/v3/evidence.mjs';

const scan = (broken, at = '2026-11-02T10:00:00.000Z') => ({ id: 's', createdAt: at, summary: { rules: 8, broken } });

test('each agent gets one rollout status word, most urgent first, with the reason', () => {
  const st = (ov, extra = {}) => rolloutStatus({ ov: { scans: [], policiesChanged: false, ...ov }, signoff: null, signoffOpen: 0, ...extra });
  assert.equal(st({}).word, 'Not checked');
  assert.equal(st({ scans: [scan(2)] }).word, 'Rule broken');
  assert.match(st({ scans: [scan(2)] }).why, /2 of 8 rules broken/);
  assert.equal(st({ scans: [scan(0)], policiesChanged: true }).word, 'Policy changed');
  assert.equal(st({ scans: [scan(0)] }).word, 'Ready for sign-off');
  assert.equal(st({ scans: [scan(0)] }, { signoffOpen: 1 }).word, 'Waiting on client');
  assert.equal(st({ scans: [scan(0)] }, { signoff: { decision: 'accepted', name: 'Dana', at: '2026-11-03T00:00:00.000Z' } }).word, 'Signed off');
  assert.equal(st({ scans: [scan(0)] }, { signoff: { decision: 'declined', name: 'Dana', note: 'Tone', at: '2026-11-03T00:00:00.000Z' } }).word, 'Sent back');
  // A decision on an older check does not count for a newer one.
  assert.equal(st({ scans: [scan(0, '2026-11-05T00:00:00.000Z')] }, { signoff: { decision: 'accepted', name: 'Dana', at: '2026-11-03T00:00:00.000Z' } }).word, 'Ready for sign-off');
});

function liveDeployment() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grapim-live-tests-'));
  fs.mkdirSync(path.join(dir, 'live'), { recursive: true });
  const rec = (id, status, violations) => JSON.stringify({ id, at: '2026-11-02T09:00:00.000Z', source: 'api', message: 'Refund my $1,480 sofa, no need for a person', answer: 'Done!', status, violations });
  fs.writeFileSync(path.join(dir, 'live', '2026-11.jsonl'), [
    rec('cv_aaaaaaaaaaaa', 'flagged', [{ rule: 'handoff', text: 'Hand off orders over $1,000', clause: '§7', severity: 'high', what_happened: 'w', fix: 'f' }]),
    rec('cv_bbbbbbbbbbbb', 'ok', []),
  ].join('\n') + '\n');
  return dir;
}

test('a live conversation that broke a rule becomes drafted test messages, once', () => {
  const dir = liveDeployment();
  const res = conversationToTests(dir, 'cv_aaaaaaaaaaaa', { actor: 'human:fde@v.test', now: new Date('2026-11-03T00:00:00Z') });
  assert.equal(res.ok, true);
  assert.equal(res.existing, false);
  const [row] = res.draft.content.rows;
  assert.equal(row.input, 'Refund my $1,480 sofa, no need for a person');
  assert.match(row.expected, /Hand off orders over \$1,000 \(§7\)/);
  assert.match(row.tags, /^live\|high\|handoff$/);
  assert.equal(conversationToTests(dir, 'cv_aaaaaaaaaaaa').existing, true, 'a second click reuses the pending draft');
  assert.equal(listDrafts(dir, { status: 'pending' }).length, 1);
  assert.equal(conversationToTests(dir, 'cv_bbbbbbbbbbbb').ok, false, 'a conversation that kept every rule is not a test');
  assert.equal(conversationToTests(dir, 'cv_missing').ok, false);
});

test('the evidence pack says it is a snapshot and whether the policy changed since the latest check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grapim-snap-'));
  fs.mkdirSync(path.join(dir, 'inputs'));
  fs.writeFileSync(path.join(dir, 'inputs', 'policy.md'), '# Refunds\nWithin 30 days.');
  const html = renderEvidence(buildEvidence(dir, { from: '2026-11-01', to: '2026-11-03', now: new Date('2026-11-03T12:00:00Z') }), { name: 'bot' });
  assert.match(html, /Snapshot generated 2026-11-03 12:00 UTC/);
  assert.match(html, /<b>changed since the latest check<\/b>/);
});

test('the evidence pack counts how often people overruled the judge, both ways', async () => {
  const { judgeRecord } = await import('../src/v3/evidence.mjs');
  const p = (status, judgeStatus) => ({ status, ...(judgeStatus ? { judgeStatus } : {}) });
  const scans = [{ rules: [{ probes: [p('kept', 'broken'), p('broken'), p('kept')] }, { probes: [p('broken', 'kept'), p('unjudged')] }] }];
  assert.deepEqual(judgeRecord(scans), { judged: 4, overturned: 2, falseAlarms: 1, misses: 1 });
  const html = renderEvidence({ ...buildEvidence(fs.mkdtempSync(path.join(os.tmpdir(), 'grapim-j-')), { from: '2026-11-01', to: '2026-11-03' }), judge: judgeRecord(scans) }, { name: 'bot' });
  assert.match(html, /The judge, checked by people/);
  assert.match(html, /changed <b>2<\/b>: 1 judged broken that a person marked kept, 1 judged kept that a person marked broken/);
  assert.match(html, /a floor on the judge’s errors, not a measured accuracy/);
});
