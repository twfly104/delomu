import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendAudit } from '../src/core/audit.mjs';
import { buildEvidence, evidenceRange, renderEvidence } from '../src/v3/evidence.mjs';
import { startServer, seedOrg } from './v3-support.test.mjs';

const HOSTILE = '<script>alert(1)</script>';
const rule = (id, text, statuses, extra = {}) => ({ id, clause: `policy.md ${id}`, quote: 'q', rule: text, severity: 'high', probes: statuses.map((status, i) => ({ message: `m${i}`, status })), ...extra });

function writeScan(dir, scan) {
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', `${scan.id}.json`), JSON.stringify(scan));
}

// A deployment with: an old check before the range, a check that breaks two rules, an approved fix, a re-check
// that fixes one of them, a later re-check that fixes the other, a revert, and live traffic across two months.
function deployment() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-evidence-'));
  writeScan(dir, { id: '2026-06-01T09-00-00-000Z-aaaa', createdAt: '2026-06-01T09:00:00.000Z', rules: [rule('refund', 'Old rule', ['broken'])] });
  writeScan(dir, { id: '2026-09-01T10-00-00-000Z-bbbb', createdAt: '2026-09-01T10:00:00.000Z', rules: [
    rule('refund', `Never promise cash ${HOSTILE}`, ['broken', 'kept']),
    rule('handoff', 'Offer a human', ['broken', 'broken']),
    rule('privacy', 'Do not read out card numbers', ['kept', 'kept']),
  ] });
  writeScan(dir, { id: '2026-09-01T12-00-00-000Z-cccc', createdAt: '2026-09-01T12:00:00.000Z', recheckOf: '2026-09-01T10-00-00-000Z-bbbb', rules: [
    rule('refund', `Never promise cash ${HOSTILE}`, ['kept', 'kept']),
    rule('handoff', 'Offer a human', ['broken', 'kept']),
    rule('privacy', 'Do not read out card numbers', ['kept', 'broken']),
  ] });
  writeScan(dir, { id: '2026-09-03T12-00-00-000Z-dddd', createdAt: '2026-09-03T12:00:00.000Z', recheckOf: '2026-09-01T12-00-00-000Z-cccc', rules: [
    rule('refund', `Never promise cash ${HOSTILE}`, ['kept', 'kept']),
    rule('handoff', 'Offer a human', ['kept', 'kept']),
    rule('privacy', 'Do not read out card numbers', ['kept', 'unjudged']),
  ] });
  fs.writeFileSync(path.join(dir, 'fix.json'), JSON.stringify({ scanId: '2026-09-01T10-00-00-000Z-bbbb', status: 'reverted', summary: `Covers refunds ${HOSTILE}`, rules: ['refund', 'handoff'], approvedAt: '2026-09-01T11:00:00.000Z', approvedBy: 'human:ana', revertedAt: '2026-09-02T08:00:00.000Z', revertedBy: 'human:ana' }));
  appendAudit(dir, { actor: 'agent', action: 'scan.create', target: '2026-09-01T10-00-00-000Z-bbbb' }, new Date('2026-09-01T10:00:00Z'));
  appendAudit(dir, { actor: `human:${HOSTILE}`, action: 'fix.apply', target: '2026-09-01T10-00-00-000Z-bbbb' }, new Date('2026-09-01T11:00:00Z'));
  appendAudit(dir, { actor: 'human:ana', action: 'fix.revert', target: '2026-09-01T10-00-00-000Z-bbbb' }, new Date('2026-09-02T08:00:00Z'));
  fs.mkdirSync(path.join(dir, 'live'));
  const conv = (at, violations) => JSON.stringify({ id: `cv_${at}`, at, status: violations.length ? 'flagged' : 'ok', violations });
  const v = { rule: 'refund', text: `Never promise cash ${HOSTILE}`, clause: 'policy.md refund', severity: 'high' };
  fs.writeFileSync(path.join(dir, 'live', '2026-09.jsonl'), [conv('2026-09-05T00:00:00Z', [v]), conv('2026-09-06T00:00:00Z', []), conv('2026-07-01T00:00:00Z', [v])].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'live', '2026-10.jsonl'), [conv('2026-10-02T00:00:00Z', [v, { ...v, rule: 'handoff', text: 'Offer a human' }]), 'not json'].join('\n') + '\n');
  return dir;
}

const NOW = new Date('2026-11-02T00:00:00Z');

test('evidence: checks, before and after, fixes and reverts, from records in range only', () => {
  const d = buildEvidence(deployment(), { from: '2026-08-01', to: '2026-10-31', now: NOW });
  assert.deepEqual(d.checks.map(c => [c.broken, c.rules, Boolean(c.recheckOf)]), [[2, 3, false], [2, 3, true], [0, 3, true]]);

  const [first, second] = d.rechecks;
  assert.equal(first.beforeBroken, 2);
  assert.equal(first.afterBroken, 2);
  assert.equal(first.messages, 6);
  assert.deepEqual(first.fixed.map(r => r.id), ['refund']);
  assert.deepEqual(first.stillBroken.map(r => r.id), ['handoff']);
  assert.deepEqual(first.newlyBroken.map(r => r.id), ['privacy']);
  assert.deepEqual([second.beforeBroken, second.afterBroken], [2, 0]);
  assert.deepEqual(second.fixed.map(r => r.id), ['handoff']);

  assert.deepEqual(d.fixes.map(f => [f.action, f.source, f.seq]), [['fix.apply', 'audit', 2], ['fix.revert', 'audit', 3]]);
  assert.equal(d.fixes[0].rules, 2);
});

test('evidence: mean time to fix runs from the breaking check to the first re-check that keeps the rule', () => {
  const d = buildEvidence(deployment(), { from: '2026-08-01', to: '2026-10-31', now: NOW });
  const by = Object.fromEntries(d.timeToFix.samples.map(s => [s.id, s.ms]));
  assert.equal(by.refund, 2 * 3_600_000);
  // privacy broke in the first re-check; the second re-check could not judge one message, so it is not kept.
  assert.equal(by.handoff, 2 * 86_400_000 + 2 * 3_600_000);
  assert.equal(d.timeToFix.meanMs, (by.refund + by.handoff) / 2);
  assert.deepEqual(d.timeToFix.stillOpen.map(r => r.id), ['privacy']);
  assert.match(renderEvidence(d, { name: 'bot' }), /Mean time to fix: <b>26\.0 hours<\/b>, over 2 fixed rules/);

  const none = buildEvidence(deployment(), { from: '2026-09-02', to: '2026-10-31', now: NOW });
  assert.equal(none.timeToFix.meanMs, null);
  assert.match(renderEvidence(none, { name: 'bot' }), /Not enough data/);
});

test('evidence: live monitoring per month by when the conversation happened, and the most-broken rules', () => {
  const d = buildEvidence(deployment(), { from: '2026-08-01', to: '2026-10-31', now: NOW });
  assert.deepEqual(d.live.months, [
    { month: '2026-08', checked: 0, flagged: 0, unjudged: 0 },
    { month: '2026-09', checked: 2, flagged: 1, unjudged: 0 },
    { month: '2026-10', checked: 1, flagged: 1, unjudged: 0 },
  ]);
  assert.deepEqual(d.live.topRules.map(r => [r.id, r.count]), [['refund', 2], ['handoff', 1]]);
});

test('evidence: the audit chain, intact and tampered', () => {
  const dir = deployment();
  const ok = buildEvidence(dir, { from: '2026-08-01', to: '2026-10-31', now: NOW });
  assert.equal(ok.audit.ok, true);
  assert.equal(ok.audit.count, 3);
  assert.match(ok.audit.latest.hash, /^[0-9a-f]{64}$/);
  assert.match(renderEvidence(ok, { name: 'bot' }), /Intact/);

  const file = path.join(dir, 'audit.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"actor":"human:ana"', '"actor":"human:bob"'));
  const bad = buildEvidence(dir, { from: '2026-08-01', to: '2026-10-31', now: NOW });
  assert.deepEqual([bad.audit.ok, bad.audit.brokenAt], [false, 3]);
  assert.match(renderEvidence(bad, { name: 'bot' }), /Broken at entry 3: entry was modified/);

  fs.appendFileSync(file, '{not json\n');
  const garbled = buildEvidence(dir, { from: '2026-08-01', to: '2026-10-31', now: NOW });
  assert.deepEqual([garbled.audit.ok, garbled.audit.brokenAt, garbled.audit.count], [false, 3, 4]);
});

test('evidence: hostile text is escaped and empty sections say so', () => {
  const html = renderEvidence(buildEvidence(deployment(), { from: '2026-08-01', to: '2026-10-31', now: NOW }), { name: HOSTILE, customer: HOSTILE, org: HOSTILE });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-evidence-'));
  const out = renderEvidence(buildEvidence(empty, { from: '2026-08-01', to: '2026-10-31', now: NOW }), { name: 'bot' });
  assert.equal(out.match(/No records in this period/g).length, 5);
  assert.match(out, /Not enough data/);
  assert.match(out, /period 2026-08-01 to 2026-10-31 · generated 2026-11-02 00:00 UTC/);
});

test('evidence: date range defaults to the last 90 days and rejects bad or reversed dates', () => {
  assert.deepEqual(evidenceRange({}, NOW), { ok: true, from: '2026-08-05', to: '2026-11-02' });
  assert.deepEqual(evidenceRange({ to: '2026-03-31' }, NOW), { ok: true, from: '2026-01-01', to: '2026-03-31' });
  for (const bad of [{ from: '2026-02-30' }, { to: 'yesterday' }, { from: '2026-1-01' }, { from: '2026-10-02', to: '2026-10-01' }]) {
    assert.equal(evidenceRange(bad, NOW).ok, false, JSON.stringify(bad));
  }
});

test('evidence through the server: permission, CSP, range and a 400 for bad dates', async () => {
  const srv = await startServer();
  try {
    const o = seedOrg(srv.dataDir, { name: 'Evidenceco', members: [{ email: 'eng@ev.test', role: 'engineer' }, { email: 'view@ev.test', role: 'viewer' }] });
    const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
    const signIn = async email => {
      const page = await fetch(`${srv.base}/login`);
      const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
      const res = await fetch(`${srv.base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf, api_key: o.keys[email] }) });
      const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
      const home = await (await fetch(`${srv.base}/`, { headers: { cookie } })).text();
      return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(home)[1] };
    };
    const eng = await signIn('eng@ev.test');
    const org = `/orgs/${o.org.id}`;
    await fetch(`${srv.base}${org}/sample`, { method: 'POST', redirect: 'manual', headers: { cookie: eng.cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: eng.csrf }) });
    const dir = path.join(srv.deploymentsRoot, o.org.id, 'sample-tallyfox');
    const today = new Date().toISOString().slice(0, 10);
    writeScan(dir, { id: `${today}T00-00-00-000Z-eeee`, createdAt: `${today}T00:00:00.000Z`, documents: ['policy.md'], model: 'fake', seconds: 1, summary: { rules: 1, broken: 1, probes: 1, kept: 0, failed: 1, unjudged: 0, highRiskBroken: 1 }, rules: [rule('refund', `Never ${HOSTILE}`, ['broken'])] });

    const url = `${srv.base}${org}/deployments/sample-tallyfox/evidence.html`;
    assert.match(await (await fetch(`${srv.base}${org}/deployments/sample-tallyfox/scan`, { headers: { cookie: eng.cookie } })).text(), /sample-tallyfox\/evidence\.html/);
    const viewer = await signIn('view@ev.test');
    const res = await fetch(url, { headers: { cookie: viewer.cookie } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await res.text();
    assert.match(html, /Evidence pack: sample-tallyfox/);
    assert.match(html, /<td class="num">1<\/td><td class="num">1<\/td>/);
    assert.doesNotMatch(html, /<script>/);

    const old = await (await fetch(`${url}?from=2020-01-01&to=2020-01-31`, { headers: { cookie: viewer.cookie } })).text();
    assert.match(old, /period 2020-01-01 to 2020-01-31/);
    for (const q of ['?from=2026-13-01', '?from=2026-10-02&to=2026-10-01', '?to=nope']) {
      assert.equal((await fetch(url + q, { headers: { cookie: viewer.cookie } })).status, 400, q);
    }
    assert.equal((await fetch(url, { redirect: 'manual' })).status === 200, false);
  } finally {
    await srv.close();
  }
});
