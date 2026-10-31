import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseCsv, toCsvLine } from '../src/csv.mjs';
import { buildTestSet } from '../src/testset.mjs';
import { callTarget, fillTemplate, pickPath, expandEnv } from '../src/adapters.mjs';
import { gradeAnswer } from '../src/grade.mjs';
import { createJudge } from '../src/judge.mjs';
import { initDeployment, logHours, hoursByStep } from '../src/deployment.mjs';
import { runDeployment, summarize, latestRun } from '../src/run.mjs';
import { renderHtml } from '../src/report.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-'));

test('csv: quotes, escaped quotes, newlines in fields, CRLF, BOM', () => {
  const rows = parseCsv('﻿Id,Input\r\n1,"a, ""b""\nc"\r\n\r\n2,plain\n');
  assert.deepEqual(rows, [{ id: '1', input: 'a, "b"\nc' }, { id: '2', input: 'plain' }]);
  assert.equal(toCsvLine(['a,b', 'x"y', 3]), '"a,b","x""y",3');
  assert.throws(() => parseCsv('a\n"open'), /quoted/);
});

test('test set: builds checks and reports bad rows', () => {
  const csv = 'id,input,expected,must_include,must_not_include,regex,tags\n'
    + 'a,hi,Greets back,hello|hi,rude,,x|y\n'
    + 'a,dup,,ok,,,\n'
    + ',,,,,,\n'
    + 'c,no checks,,,,,\n'
    + 'd,bad regex,,,,([,\n';
  const { tests, problems } = buildTestSet(csv);
  assert.equal(tests.length, 1);
  assert.deepEqual(tests[0].checks.map(c => c.type), ['contains', 'contains', 'not_contains', 'judge']);
  assert.deepEqual(tests[0].tags, ['x', 'y']);
  assert.equal(problems.length, 4);
  assert.match(problems.join('\n'), /duplicate id/);
  assert.match(problems.join('\n'), /invalid regex/);
});

test('adapters: template, path and env helpers', () => {
  assert.deepEqual(fillTemplate({ m: [{ content: 'Q: {{input}}' }], n: 1 }, 'x"y'), { m: [{ content: 'Q: x"y' }], n: 1 });
  assert.equal(pickPath({ a: [{ b: 'ok' }] }, 'a.0.b'), 'ok');
  assert.throws(() => pickPath({ a: 1 }, 'a.b'), /no "a.b"/);
  assert.throws(() => pickPath({}, '__proto__'), /no/);
  assert.equal(expandEnv('Bearer ${K}', { K: 'v' }), 'Bearer v');
  assert.throws(() => expandEnv('${MISSING_X}', {}), /MISSING_X/);
});

test('adapters: http target sends the input and reads the output path', async () => {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const msg = JSON.parse(body).message;
      res.setHeader('content-type', 'application/json');
      if (msg === 'boom') { res.statusCode = 500; res.end('{"err":1}'); return; }
      res.end(JSON.stringify({ reply: { text: `echo ${msg} ${req.headers.authorization}` } }));
    });
  });
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  process.env.DELOMU_TEST_KEY = 'k1';
  try {
    const target = { type: 'http', url, headers: { authorization: 'Bearer ${DELOMU_TEST_KEY}' }, body: { message: '{{input}}' }, output: 'reply.text' };
    assert.equal(await callTarget(target, 'hi'), 'echo hi Bearer k1');
    await assert.rejects(callTarget(target, 'boom'), /HTTP 500/);
  } finally {
    server.close();
    delete process.env.DELOMU_TEST_KEY;
  }
});

test('adapters: command target uses stdin/stdout and reports failures', async () => {
  const cmd = { type: 'command', command: 'node -e "process.stdin.pipe(process.stdout)"' };
  assert.equal(await callTarget(cmd, 'hello'), 'hello');
  await assert.rejects(callTarget({ type: 'command', command: 'node -e "process.exit(3)"' }, ''), /exited 3/);
  await assert.rejects(callTarget({ type: 'nope' }, ''), /unknown target/);
});

test('grade: rule checks, judge off, judge on', async () => {
  const t = { input: 'q', checks: [{ type: 'contains', value: 'Refund' }, { type: 'not_contains', value: 'sorry' }, { type: 'regex', value: '\\d+ days' }] };
  assert.equal((await gradeAnswer(t, 'refund in 5 days', null)).status, 'pass');
  const bad = await gradeAnswer(t, 'Sorry, no refund', null);
  assert.equal(bad.status, 'fail');
  assert.equal(bad.checks.filter(c => c.status === 'fail').length, 2);

  const j = { input: 'q', checks: [{ type: 'judge', value: 'says hi' }] };
  assert.equal((await gradeAnswer(j, 'hi', null)).status, 'needs_review');
  const graded = await gradeAnswer(j, 'bye', async () => ({ status: 'fail', reason: 'no hi', fix: 'say hi' }));
  assert.equal(graded.status, 'fail');
  assert.equal(graded.checks[0].fix, 'say hi');
});

test('judge: sends structured-output request and maps verdicts and refusals', async () => {
  const calls = [];
  const fake = reply => ({ beta: { messages: { create: async req => { calls.push(req); return reply; } } } });

  const pass = createJudge({ client: fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"verdict":"pass","reason":"ok","fix":"none"}' }] }) });
  assert.deepEqual(await pass({ input: 'i', expected: 'e', output: 'o' }), { status: 'pass', reason: 'ok', fix: undefined });
  const req = calls[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.match(req.messages[0].content, /<answer>\no\n<\/answer>/);

  const fail = createJudge({ client: fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"verdict":"fail","reason":"r","fix":"f"}' }] }) });
  assert.equal((await fail({ input: 'i', expected: 'e', output: 'o' })).fix, 'f');

  const refused = createJudge({ client: fake({ stop_reason: 'refusal', content: [] }) });
  assert.equal((await refused({ input: 'i', expected: 'e', output: 'o' })).status, 'needs_review');
});

test('summary: verdicts and per-tag counts', () => {
  const mk = (status, tags = []) => ({ status, tags });
  assert.equal(summarize([mk('pass'), mk('pass')], 0.9).verdict, 'accepted');
  assert.equal(summarize([mk('pass'), mk('fail')], 0.9).verdict, 'not_accepted');
  assert.equal(summarize([mk('pass'), mk('needs_review')], 0.9).verdict, 'pending_review');
  assert.equal(summarize([mk('pass'), mk('error')], 0.5).verdict, 'not_accepted');
  assert.deepEqual(summarize([mk('pass', ['a']), mk('fail', ['a', 'b'])], 0.9).byTag, { a: { total: 2, pass: 1 }, b: { total: 1, pass: 0 } });
});

test('report: escapes everything that comes from the customer or their AI', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderHtml({
    runId: 'r', generatedAt: '2026-10-31T00:00:00Z', customer: evil, deployment: evil, target: 'http', judge: 'off',
    decisions: [{ date: evil, decision: evil, reason: evil }],
    summary: summarize([{ status: 'fail', tags: [evil] }], 0.9),
    cases: [{ id: evil, input: evil, output: evil, tags: [evil], status: 'fail', checks: [{ type: 'contains', value: evil, status: 'fail', reason: evil, fix: evil }] }],
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('deployment: init and hours log', () => {
  const dir = path.join(tmp(), 'cust');
  initDeployment(dir, 'Cust');
  assert.throws(() => initDeployment(dir, 'Cust'), /already exists/);
  logHours(dir, '3-test-set', 2.5, 'built, from "tickets"');
  logHours(dir, '3-test-set', 1);
  logHours(dir, '4-test-and-fix', 0.5);
  assert.throws(() => logHours(dir, 'bogus', 1), /step must be/);
  assert.throws(() => logHours(dir, '1-mapping', 0), /positive/);
  const h = hoursByStep(dir);
  assert.equal(h['3-test-set'], 3.5);
  assert.equal(h['4-test-and-fix'], 0.5);
});

test('end to end: the demo deployment finds the three planted bugs', async () => {
  const dir = path.join(tmp(), 'acme');
  fs.cpSync(path.join(root, 'examples', 'acme-support'), dir, { recursive: true });
  fs.copyFileSync(path.join(root, 'examples', 'mock-bot.mjs'), path.join(dir, '..', 'mock-bot.mjs'));
  const { tests } = buildTestSet(fs.readFileSync(path.join(dir, 'cases.csv'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'tests.json'), JSON.stringify({ tests }));

  const { results, outDir } = await runDeployment(dir, { judge: false, now: new Date('2026-10-31T10:00:00Z') });
  const failed = results.cases.filter(c => c.status === 'fail').map(c => c.id).sort();
  assert.deepEqual(failed, ['delete-data', 'human', 'late-refund']);
  assert.equal(results.summary.verdict, 'not_accepted');
  assert.equal(results.judge, 'off');
  assert.ok(fs.existsSync(path.join(outDir, 'report.html')));
  assert.equal(latestRun(dir), outDir);
});
