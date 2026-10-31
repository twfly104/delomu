import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { checkDeployment, findDeployments, dueReason } from '../src/v2/monitor.mjs';
import { computeFingerprint, stableStringify, changedParts } from '../src/v2/fingerprint.mjs';
import { monitorConfig } from '../src/v2/config.mjs';
import { diffRuns, renderDiffHtml } from '../src/v2/diff.mjs';
import { evaluateIncident, incidentKey, postWebhook } from '../src/v2/alerts.mjs';
import { readState } from '../src/v2/state.mjs';
import { readAudit, verifyAudit } from '../src/core/audit.mjs';
import { commands } from '../src/commands/v2.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-v2-'));
const T0 = Date.parse('2026-10-01T00:00:00Z');
const at = hours => new Date(T0 + hours * 3_600_000);

const TESTS = [
  { id: 'dup-charge', input: 'I was charged twice', checks: [{ type: 'contains', value: 'refund' }], tags: ['billing'] },
  { id: 'cancel', input: 'Please cancel my plan', checks: [{ type: 'contains', value: 'cancelled' }], tags: ['account'] },
  { id: 'password', input: 'I forgot my password', checks: [{ type: 'contains', value: 'reset' }], tags: ['account'] },
];
// Answers like the mock bot except that it no longer handles cancellations.
const HALF_BROKEN_BOT = `let t='';process.stdin.on('data',d=>t+=d);process.stdin.on('end',()=>{const q=t.toLowerCase();
process.stdout.write(q.includes('cancel')?'Please call us.':q.includes('charged twice')?'I will refund it.':'Go to /reset.');});`;
const BROKEN_BOT = `process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('I am not sure.'));`;
const VERSION_CMD = 'node -e "process.stdout.write(String(7))"';

function writeConfig(dir, bot, monitor) {
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({
    customer: 'Acme', name: 'support', target: { type: 'command', command: `node ../${bot}` },
    acceptance: { minPassRate: 0.9 }, monitor,
  }));
}

// A deployment in a temp root using the command target with examples/mock-bot.mjs copied next to it.
function makeDeployment(monitor = {}) {
  const root = tmp();
  fs.copyFileSync(path.join(repo, 'examples', 'mock-bot.mjs'), path.join(root, 'mock-bot.mjs'));
  fs.writeFileSync(path.join(root, 'half-broken-bot.mjs'), HALF_BROKEN_BOT);
  fs.writeFileSync(path.join(root, 'broken-bot.mjs'), BROKEN_BOT);
  const dir = path.join(root, 'acme');
  fs.mkdirSync(dir);
  writeConfig(dir, 'mock-bot.mjs', monitor);
  fs.writeFileSync(path.join(dir, 'tests.json'), JSON.stringify({ tests: TESTS }));
  return { root, dir };
}

// Local HTTP server on port 0: records POST bodies, answers every request with the current version.
async function startServer() {
  const s = { posts: [], version: 'model-1', status: 200 };
  s.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      if (req.method === 'POST') s.posts.push(JSON.parse(body));
      res.writeHead(s.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: { version: s.version } }));
    });
  });
  await new Promise(r => s.server.listen(0, '127.0.0.1', r));
  s.url = `http://127.0.0.1:${s.server.address().port}`;
  s.close = () => new Promise(r => s.server.close(r));
  return s;
}

test('fingerprint: key order does not matter; probe value is part of it; failed probe keeps the last version', async () => {
  assert.equal(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] }), stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
  assert.deepEqual(changedParts({ tests: 'x', target: 'y', version: 'v1' }, { tests: 'x', target: 'y', version: 'v2' }), ['version']);
  assert.deepEqual(changedParts(undefined, { tests: 'x' }), []);

  const srv = await startServer();
  try {
    const { dir } = makeDeployment();
    const target = { type: 'command', command: 'node ../mock-bot.mjs' };
    const probe = monitorConfig({ monitor: { versionProbe: { type: 'http', url: srv.url, path: 'model.version' } } }).versionProbe;
    const a = await computeFingerprint(dir, { target, probe });
    assert.equal(a.parts.version, 'model-1');
    assert.equal((await computeFingerprint(dir, { target, probe })).hash, a.hash);

    srv.version = 'model-2';
    const b = await computeFingerprint(dir, { target, probe });
    assert.notEqual(b.hash, a.hash);
    assert.deepEqual(changedParts(a.parts, b.parts), ['version']);

    const c = await computeFingerprint(dir, { target: { ...target, command: 'node other.mjs' }, probe });
    assert.deepEqual(changedParts(b.parts, c.parts), ['target']);

    fs.writeFileSync(path.join(dir, 'tests.json'), JSON.stringify({ tests: TESTS.slice(1) }));
    assert.deepEqual(changedParts(b.parts, (await computeFingerprint(dir, { target, probe })).parts), ['tests']);

    srv.status = 500;
    const d = await computeFingerprint(dir, { target, probe, previousVersion: 'model-2' });
    assert.match(d.probeError, /HTTP 500/);
    assert.equal(d.parts.version, 'model-2');

    const cmd = await computeFingerprint(dir, { target, probe: { type: 'command', command: VERSION_CMD } });
    assert.equal(cmd.parts.version, '7');
  } finally {
    await srv.close();
  }
});

test('config: monitor section is validated with clear errors', () => {
  assert.deepEqual(monitorConfig({}), { intervalHours: 24, webhookEnv: null, versionProbe: null });
  assert.throws(() => monitorConfig({ monitor: { intervalHours: 0 } }), /intervalHours/);
  assert.throws(() => monitorConfig({ monitor: { webhookEnv: 'https://hooks.example' } }), /webhookEnv/);
  assert.throws(() => monitorConfig({ monitor: { versionProbe: { type: 'ftp' } } }), /"http" or "command"/);
  assert.throws(() => monitorConfig({ monitor: { versionProbe: { type: 'http', url: 'file:///etc/passwd' } } }), /http\(s\) URL/);
  assert.throws(() => monitorConfig({ monitor: { versionProbe: { type: 'command', command: ' ' } } }), /command/);
});

test('interval logic: due when forced, first, changed or elapsed; otherwise says when it is next due', () => {
  const parts = { tests: 'a', target: 'b', version: null };
  const state = { lastRunAt: at(0).toISOString(), lastRunId: 'r1', parts };
  const cfg = { intervalHours: 24 };
  assert.equal(dueReason({}, parts, cfg, at(0), false).reason, 'first monitored run');
  assert.equal(dueReason(state, parts, cfg, at(1), true).reason, 'forced');
  assert.equal(dueReason(state, { ...parts, tests: 'z' }, cfg, at(1), false).reason, 'fingerprint changed (tests)');
  const notDue = dueReason(state, parts, cfg, at(23.9), false);
  assert.equal(notDue.due, false);
  assert.match(notDue.reason, /next scheduled run after 2026-10-02T00:00:00.000Z/);
  assert.equal(dueReason(state, parts, cfg, at(24), false).due, true);
});

test('diff: regressions, fixed, new, removed, other changes and pass-rate delta; HTML is escaped', () => {
  const run = (runId, cases) => ({
    runId, generatedAt: '2026-10-01T00:00:00.000Z', customer: '<Acme>', deployment: 'd',
    summary: { passRate: cases.filter(c => c.status === 'pass').length / cases.length, minPassRate: 0.9, verdict: 'not_accepted' },
    cases: cases.map(c => ({ input: 'q', output: 'a', ...c })),
  });
  const prev = run('r1', [{ id: 'a', status: 'pass' }, { id: 'b', status: 'fail' }, { id: 'c', status: 'pass' }, { id: 'gone', status: 'pass' }, { id: 'e', status: 'fail' }]);
  const curr = run('r2', [{ id: 'a', status: 'fail', output: '<script>alert(1)</script>' }, { id: 'b', status: 'pass' }, { id: 'c', status: 'pass' }, { id: 'new', status: 'error', error: 'x' }, { id: 'e', status: 'needs_review' }]);
  const d = diffRuns(prev, curr);
  assert.deepEqual(d.regressions.map(r => [r.id, r.from, r.to]), [['a', 'pass', 'fail']]);
  assert.deepEqual(d.fixed.map(r => r.id), ['b']);
  assert.deepEqual(d.added, [{ id: 'new', status: 'error' }]);
  assert.deepEqual(d.removed, [{ id: 'gone', status: 'pass' }]);
  assert.deepEqual(d.changed.map(r => [r.id, r.from, r.to]), [['e', 'fail', 'needs_review']]);
  assert.ok(Math.abs(d.passRate.delta - (0.4 - 0.6)) < 1e-9);

  const html = renderDiffHtml(d);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;') && html.includes('&lt;Acme&gt;'));
  assert.match(html, /Regressions found/);

  const first = diffRuns(null, curr);
  assert.equal(first.previousRunId, null);
  assert.equal(first.passRate.delta, null);
  assert.equal(first.added.length, 5);
  assert.match(renderDiffHtml(first), /Baseline run/);
});

test('incident: same open set is deduplicated; changed set updates; clearing resolves', () => {
  const now = at(0);
  const results = statuses => ({
    runId: 'r', customer: 'Acme', deployment: 'd',
    summary: { passRate: 0, minPassRate: 0.9, verdict: Object.values(statuses).every(s => s === 'pass') ? 'accepted' : 'not_accepted' },
    cases: Object.entries(statuses).map(([id, status]) => ({ id, status })),
  });
  const diff = ids => ({ regressions: ids.map(id => ({ id })) });
  const failing = results({ a: 'fail', b: 'fail', c: 'pass' });
  const allPass = results({ a: 'pass', b: 'pass', c: 'pass' });

  const r1 = evaluateIncident(null, { diff: diff(['a', 'b']), results: failing, reportPath: 'x', now });
  assert.equal(r1.message.type, 'alert');
  assert.deepEqual(r1.incident.caseIds, ['a', 'b']);
  assert.equal(r1.incident.key, incidentKey(['b', 'a'], true));
  assert.match(r1.message.payload.text, /^New .*2 regressed cases/);
  const open = { ...r1.incident, notified: true };

  // Next run: nothing newly regressed (a and b were already failing), still the same incident.
  assert.equal(evaluateIncident(open, { diff: diff([]), results: failing, reportPath: 'x', now }).message, null);
  // An undelivered alert is retried even with the same key.
  assert.equal(evaluateIncident({ ...open, notified: false }, { diff: diff([]), results: failing, reportPath: 'x', now }).message.type, 'alert');

  const r3 = evaluateIncident(open, { diff: diff([]), results: results({ a: 'pass', b: 'fail', c: 'pass' }), reportPath: 'x', now });
  assert.deepEqual(r3.incident.caseIds, ['b']);
  assert.match(r3.message.payload.text, /^Updated/);

  const r4 = evaluateIncident(open, { diff: diff([]), results: allPass, reportPath: 'x', now });
  assert.equal(r4.incident, null);
  assert.equal(r4.message.type, 'resolved');
  // An alert nobody received closes silently.
  assert.equal(evaluateIncident({ ...open, notified: false }, { diff: diff([]), results: allPass, reportPath: 'x', now }).message, null);
});

test('checkDeployment: first run, interval skip, probe change, alert, dedup, update and resolved over a real webhook', async () => {
  const srv = await startServer();
  const env = { ACME_HOOK: `${srv.url}/hook` };
  const monitor = { intervalHours: 24, webhookEnv: 'ACME_HOOK', versionProbe: { type: 'http', url: `${srv.url}/version`, path: 'model.version' } };
  const { dir } = makeDeployment(monitor);
  const check = (h, opts = {}) => checkDeployment(dir, { now: at(h), judge: false, env, ...opts });
  try {
    const first = await check(0);
    assert.equal(first.ran, true);
    assert.equal(first.reason, 'first monitored run');
    assert.equal(first.results.summary.verdict, 'accepted');
    assert.equal(first.diff.added.length, 3);
    assert.equal(first.alert, null);
    const runDir = path.join(dir, 'runs', first.results.runId);
    assert.ok(fs.existsSync(path.join(runDir, 'diff.json')) && fs.existsSync(path.join(runDir, 'diff.html')));
    const state = readState(dir);
    assert.equal(state.lastRunId, first.results.runId);
    assert.equal(state.parts.version, 'model-1');

    const skipped = await check(1);
    assert.equal(skipped.ran, false);
    assert.match(skipped.reason, /no change/);

    // Only the model version changes: that alone triggers a run.
    srv.version = 'model-2';
    const probed = await check(1.5);
    assert.equal(probed.reason, 'fingerprint changed (version)');
    assert.equal(probed.diff.regressions.length, 0);

    // The customer's new build breaks cancellations.
    writeConfig(dir, 'half-broken-bot.mjs', monitor);
    const broke = await check(2);
    assert.equal(broke.reason, 'fingerprint changed (target)');
    assert.deepEqual(broke.diff.regressions.map(r => r.id), ['cancel']);
    assert.equal(broke.alert.sent, true);
    assert.equal(srv.posts.length, 1);
    assert.match(srv.posts[0].text, /New Delomu alert for Acme \/ support: 1 regressed case; pass rate 66.7% is below/);
    assert.ok(Array.isArray(srv.posts[0].blocks));

    // Same open incident on the next forced run: no second message.
    const again = await check(3, { force: true });
    assert.equal(again.alert, null);
    assert.equal(srv.posts.length, 1);

    // Everything breaks: the open set changes, so an update is sent.
    writeConfig(dir, 'broken-bot.mjs', monitor);
    const worse = await check(4);
    assert.deepEqual(worse.diff.regressions.map(r => r.id).sort(), ['dup-charge', 'password']);
    assert.equal(srv.posts.length, 2);
    assert.match(srv.posts[1].text, /^Updated .*3 regressed cases/);
    assert.deepEqual(readState(dir).incident.caseIds, ['cancel', 'dup-charge', 'password']);

    // Rolled back: all pass again, a "resolved" message closes the incident.
    writeConfig(dir, 'mock-bot.mjs', monitor);
    const fixed = await check(5);
    assert.equal(fixed.diff.fixed.length, 3);
    assert.equal(fixed.alert.type, 'resolved');
    assert.match(srv.posts[2].text, /^Resolved/);
    assert.equal(readState(dir).incident, null);

    const interval = await check(5 + 24);
    assert.equal(interval.reason, '24 h interval elapsed');
    assert.equal(srv.posts.length, 3);

    const log = readAudit(dir).filter(e => e.action.startsWith('monitor.'));
    assert.ok(log.every(e => e.actor === 'system'));
    assert.equal(log.filter(e => e.action === 'monitor.check').length, 8);
    assert.equal(log.filter(e => e.action === 'monitor.alert.sent').length, 3);
    assert.equal(verifyAudit(dir).ok, true);
    assert.ok(!JSON.stringify(readAudit(dir)).includes(env.ACME_HOOK), 'webhook URL is never logged');
  } finally {
    await srv.close();
  }
});

test('checkDeployment: webhook failures are audited, never thrown, and the alert is retried', async () => {
  const srv = await startServer();
  const monitor = { webhookEnv: 'ACME_HOOK' };
  const { dir } = makeDeployment(monitor);
  try {
    await checkDeployment(dir, { now: at(0), judge: false, env: {} });
    writeConfig(dir, 'half-broken-bot.mjs', monitor);

    srv.status = 503;
    const failed = await checkDeployment(dir, { now: at(1), judge: false, env: { ACME_HOOK: srv.url } });
    assert.deepEqual([failed.alert.sent, failed.alert.reason], [false, 'webhook answered HTTP 503']);
    assert.equal(readState(dir).incident.notified, false);

    const unreachable = await checkDeployment(dir, { now: at(2), judge: false, force: true, env: { ACME_HOOK: 'http://127.0.0.1:1/hook' } });
    assert.equal(unreachable.alert.sent, false);

    srv.status = 200;
    const retried = await checkDeployment(dir, { now: at(3), judge: false, force: true, env: { ACME_HOOK: srv.url } });
    assert.equal(retried.alert.sent, true);
    assert.equal(srv.posts.length, 2); // the 503 attempt reached the server too
    assert.equal(readState(dir).incident.notified, true);

    assert.equal(readAudit(dir).filter(e => e.action === 'monitor.alert.failed').length, 2);
  } finally {
    await srv.close();
  }
});

test('checkDeployment: without a webhook the alert is skipped and audited; run errors are audited and thrown', async () => {
  const { dir } = makeDeployment();
  await checkDeployment(dir, { now: at(0), judge: false });
  writeConfig(dir, 'broken-bot.mjs', {});
  const r = await checkDeployment(dir, { now: at(1), judge: false, env: {} });
  assert.deepEqual([r.alert.sent, r.alert.reason], [false, 'no monitor.webhookEnv in delomu.json']);
  assert.ok(readAudit(dir).some(e => e.action === 'monitor.alert.skipped'));

  fs.writeFileSync(path.join(dir, 'tests.json'), JSON.stringify({ tests: [] }));
  await assert.rejects(checkDeployment(dir, { now: at(2), judge: false }), /no tests/);
  const last = readAudit(dir).at(-1);
  assert.equal(last.action, 'monitor.check');
  assert.match(last.detail.error, /no tests/);
});

test('findDeployments: nested folders, skipping node_modules, runs, drafts, inputs and dot folders', () => {
  const root = tmp();
  const mk = (...p) => { fs.mkdirSync(path.join(root, ...p), { recursive: true }); fs.writeFileSync(path.join(root, ...p, 'delomu.json'), '{}'); };
  mk('a');
  mk('team', 'b');
  for (const skip of ['node_modules', 'runs', 'drafts', 'inputs', '.git']) mk('a', skip, 'x');
  assert.deepEqual(findDeployments(root).map(d => path.relative(root, d).split(path.sep).join('/')), ['a', 'team/b']);
  assert.throws(() => findDeployments(path.join(root, 'missing')), /not a folder/);
});

test('watch --once: checks every deployment and reports failures with exit code 1', async () => {
  const { root, dir } = makeDeployment();
  fs.mkdirSync(path.join(root, 'broken'));
  fs.writeFileSync(path.join(root, 'broken', 'delomu.json'), '{"customer":"Beta"}');
  const watch = commands.find(c => c.name === 'watch');
  const lines = [];
  const orig = { log: console.log, error: console.error };
  console.log = console.error = m => lines.push(m);
  try {
    assert.equal(await watch.run([root, '--once', '--no-judge']), 1);
  } finally {
    Object.assign(console, orig);
  }
  assert.ok(lines.some(l => /^acme: ran \(first monitored run\), pass 100\.0%/.test(l)), lines.join('\n'));
  assert.ok(lines.some(l => /^broken: check failed: delomu.json has no "target"/.test(l)), lines.join('\n'));
  assert.ok(fs.existsSync(path.join(dir, 'monitor.json')));
  await assert.rejects(async () => watch.run([root, '--once', '--interval-minutes', '0']), /positive number/);
});

// Review fixes below.

const incidentResults = statuses => ({
  runId: 'r', customer: 'Acme', deployment: 'd',
  summary: { passRate: 0, minPassRate: 0.9, verdict: Object.values(statuses).every(x => x === 'pass') ? 'accepted' : 'not_accepted' },
  cases: Object.entries(statuses).map(([id, status]) => ({ id, status })),
});

test('incident: a failed update after a delivered alert still resolves, and its retry is labelled "Updated"', () => {
  const now = at(0);
  const diff = ids => ({ regressions: ids.map(id => ({ id })) });
  const sent = { ...evaluateIncident(null, { diff: diff(['a']), results: incidentResults({ a: 'fail', b: 'pass' }), reportPath: 'x', now }).incident, notified: true, announced: true };
  // b regresses too; the "Updated" alert fails to deliver.
  const update = evaluateIncident(sent, { diff: diff(['b']), results: incidentResults({ a: 'fail', b: 'fail' }), reportPath: 'x', now });
  assert.match(update.message.payload.text, /^Updated/);
  const failedUpdate = { ...update.incident, notified: false };
  assert.equal(failedUpdate.announced, true);
  assert.match(evaluateIncident(failedUpdate, { diff: diff([]), results: incidentResults({ a: 'fail', b: 'fail' }), reportPath: 'x', now }).message.payload.text, /^Updated/);
  const cleared = evaluateIncident(failedUpdate, { diff: diff([]), results: incidentResults({ a: 'pass', b: 'pass' }), reportPath: 'x', now });
  assert.equal(cleared.message.type, 'resolved');
  // State written before "announced" existed: a delivered alert (notified) is enough.
  assert.equal(evaluateIncident({ ...sent, announced: undefined }, { diff: diff([]), results: incidentResults({ a: 'pass', b: 'pass' }), reportPath: 'x', now }).message.type, 'resolved');
});

test('alerts: Slack control characters in names are escaped in text too; the webhook URL never appears in errors', async () => {
  const r = { ...incidentResults({ a: 'fail' }), customer: '<!channel>', deployment: 'a&b' };
  const { message } = evaluateIncident(null, { diff: { regressions: [{ id: 'a' }] }, results: r, reportPath: 'x', now: at(0) });
  assert.ok(!message.payload.text.includes('<!channel>'));
  assert.match(message.payload.text, /&lt;!channel&gt; \/ a&amp;b/);
  const secret = 'http://[bad/T000/B000/secret-token';
  await assert.rejects(postWebhook(secret, {}), e => !e.message.includes('secret-token') && /<webhook URL>/.test(e.message));
});

test('checkDeployment: an undelivered alert is retried on the next check even when no run is due', async () => {
  const srv = await startServer();
  const monitor = { intervalHours: 24, webhookEnv: 'ACME_HOOK' };
  const { dir } = makeDeployment(monitor);
  const env = { ACME_HOOK: srv.url };
  try {
    await checkDeployment(dir, { now: at(0), judge: false, env });
    writeConfig(dir, 'half-broken-bot.mjs', monitor);
    srv.status = 503;
    const failed = await checkDeployment(dir, { now: at(1), judge: false, env });
    assert.equal(failed.alert.sent, false);
    assert.equal(readState(dir).outbox.type, 'alert');

    srv.status = 200;
    const retried = await checkDeployment(dir, { now: at(1.25), judge: false, env });
    assert.equal(retried.ran, false);
    assert.deepEqual([retried.alert.type, retried.alert.sent], ['alert', true]);
    assert.match(srv.posts.at(-1).text, /^New Delomu alert/);
    let state = readState(dir);
    assert.deepEqual([state.outbox, state.incident.notified, state.incident.announced], [null, true, true]);
    const quiet = await checkDeployment(dir, { now: at(1.5), judge: false, env });
    assert.equal(quiet.alert, null);
    const posts = srv.posts.length;

    // The fix ships; "resolved" fails once, then arrives on a check that does not re-run.
    writeConfig(dir, 'mock-bot.mjs', monitor);
    srv.status = 500;
    const resolving = await checkDeployment(dir, { now: at(2), judge: false, env });
    assert.deepEqual([resolving.alert.type, resolving.alert.sent], ['resolved', false]);
    assert.ok(readState(dir).incident);
    srv.status = 200;
    const resolved = await checkDeployment(dir, { now: at(2.25), judge: false, env });
    assert.deepEqual([resolved.ran, resolved.alert.type, resolved.alert.sent], [false, 'resolved', true]);
    assert.match(srv.posts.at(-1).text, /^Resolved/);
    state = readState(dir);
    assert.deepEqual([state.incident, state.outbox], [null, null]);
    assert.equal(srv.posts.length, posts + 2);
  } finally {
    await srv.close();
  }
});

test('checkDeployment: failures before the run are audited; an unreadable previous run names its file', async () => {
  const { dir } = makeDeployment({ intervalHours: -1 });
  await assert.rejects(checkDeployment(dir, { now: at(0), judge: false }), /intervalHours/);
  assert.match(readAudit(dir).at(-1).detail.error, /intervalHours/);

  writeConfig(dir, 'mock-bot.mjs', {});
  const first = await checkDeployment(dir, { now: at(0), judge: false });
  fs.writeFileSync(path.join(dir, 'runs', first.results.runId, 'results.json'), '{ half-writ');
  await assert.rejects(checkDeployment(dir, { now: at(1), judge: false, force: true }), /results\.json is not valid JSON/);
  assert.equal(readAudit(dir).at(-1).action, 'monitor.check');
  await assert.rejects(checkDeployment(path.join(dir, 'missing'), { now: at(0) }), /no delomu.json/);
  assert.ok(!fs.existsSync(path.join(dir, 'missing')), 'a missing folder is not created by the audit log');
});

test('config and watch: probe headers and timeout are validated; an interval too long for a timer is rejected', async () => {
  const probe = extra => monitorConfig({ monitor: { versionProbe: { type: 'http', url: 'http://x', ...extra } } });
  assert.throws(() => probe({ headers: 'Bearer x' }), /headers must be an object of strings/);
  assert.throws(() => probe({ headers: { a: 1 } }), /headers/);
  assert.throws(() => probe({ timeoutMs: 0 }), /timeoutMs/);
  assert.deepEqual(probe({ headers: { authorization: 'Bearer ${KEY}' } }).versionProbe.headers, { authorization: 'Bearer ${KEY}' });
  const watch = commands.find(c => c.name === 'watch');
  await assert.rejects(async () => watch.run([tmp(), '--interval-minutes', '100000']), /at most 35791/);
});
