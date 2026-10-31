// v1 sandbox: the agent reads only allowed files inside inputs/, within size caps, and every read is audited.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInputReader, stripHtml } from '../src/v1/sandbox.mjs';
import { readAudit, verifyAudit } from '../src/core/audit.mjs';
import { parseCsv } from '../src/csv.mjs';

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-v1-sandbox-'));
  const dir = path.join(base, 'dep');
  fs.mkdirSync(path.join(dir, 'inputs', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'inputs', 'policy.md'), '# Policy\nRefunds within 30 days.');
  fs.writeFileSync(path.join(dir, 'inputs', 'sub', 'faq.html'), '<html><style>p{}</style><script>alert(1)</script><p>Ship to <b>Canada</b> &amp; US</p></html>');
  fs.writeFileSync(path.join(dir, 'inputs', 'tool.exe'), 'MZ');
  fs.writeFileSync(path.join(dir, 'delomu.json'), '{"target":{"type":"command","command":"x"}}');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'TOP SECRET');
  return { base, dir };
}

test('sandbox: lists only allowed types and reads them, auditing every read', () => {
  const { dir } = setup();
  const reader = createInputReader(dir);
  assert.deepEqual(reader.list(), ['policy.md', 'sub/faq.html']);

  const doc = reader.read('policy.md');
  assert.equal(doc.text, '# Policy\nRefunds within 30 days.');
  assert.equal(doc.truncated, false);
  assert.equal(reader.read('sub/faq.html').text, 'Ship to Canada & US');

  const reads = readAudit(dir).filter(e => e.action === 'input.read');
  assert.deepEqual(reads.map(e => [e.actor, e.target]), [['agent', 'policy.md'], ['agent', 'sub/faq.html']]);
  assert.equal(verifyAudit(dir).ok, true);
});

test('sandbox: refuses traversal, absolute paths, other types and missing files, and audits each refusal', () => {
  const { base, dir } = setup();
  const reader = createInputReader(dir);
  assert.throws(() => reader.read('../delomu.json'), /leaves inputs/);
  assert.throws(() => reader.read('sub/../../../secret.txt'), /leaves inputs/);
  assert.throws(() => reader.read(path.join(base, 'secret.txt')), /absolute/);
  assert.throws(() => reader.read('tool.exe'), /not allowed/);
  assert.throws(() => reader.read('nope.md'), /no such file/);
  assert.throws(() => reader.read('sub'), /not a regular file/);
  assert.throws(() => reader.read(''), /invalid path/);
  assert.equal(readAudit(dir).filter(e => e.action === 'input.denied').length, 7);
  assert.equal(readAudit(dir).filter(e => e.action === 'input.read').length, 0);
});

test('sandbox: symlinks that point outside inputs/ are neither listed nor read', t => {
  const { base, dir } = setup();
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keys.md'), 'stolen');
  try {
    // Junctions need no special rights on Windows; on other systems this is an ordinary dir symlink.
    fs.symlinkSync(outside, path.join(dir, 'inputs', 'linked'), 'junction');
  } catch (e) {
    t.skip(`cannot create symlinks here (${e.code})`);
    return;
  }
  const reader = createInputReader(dir);
  assert.deepEqual(reader.list(), ['policy.md', 'sub/faq.html']);
  assert.throws(() => reader.read('linked/keys.md'), /outside inputs/);
});

test('sandbox: per-file and total caps truncate with a note, then refuse once the budget is spent', () => {
  const { dir } = setup();
  fs.writeFileSync(path.join(dir, 'inputs', 'big.txt'), 'a'.repeat(100));
  fs.writeFileSync(path.join(dir, 'inputs', 'rows.csv'), 'id,text\n1,one\n2,two\n3,three\n');
  const reader = createInputReader(dir, { maxFileBytes: 40, maxTotalBytes: 60 });

  const big = reader.read('big.txt');
  assert.equal(big.text.length, 40);
  assert.equal(big.truncated, true);
  assert.match(big.note, /truncated; showing 40 of 100 bytes/);

  const rows = reader.read('rows.csv');
  assert.equal(rows.truncated, true);
  assert.ok(rows.text.endsWith('\n'), 'CSV is cut at a line end');
  assert.ok(rows.bytes <= 20);
  assert.throws(() => reader.read('policy.md'), /budget/);
  assert.deepEqual(readAudit(dir).filter(e => e.action === 'input.read').map(e => e.detail.truncated), [true, true]);
  assert.throws(() => createInputReader(dir, { maxFileBytes: 0 }), /positive/);
});

test('sandbox: a deployment without inputs/ lists nothing and refuses reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-v1-sandbox-'));
  const reader = createInputReader(dir);
  assert.deepEqual(reader.list(), []);
  assert.throws(() => reader.read('a.md'), /no inputs/);
});

test('stripHtml: drops comments, scripts and tags, keeps block breaks, decodes entities', () => {
  assert.equal(stripHtml('<!-- x --><h1>Title</h1><p>a &lt;b&gt; &quot;c&quot;</p><br>d'), 'Title\na <b> "c"\n\nd');
});

test('sandbox: a truncated CSV is cut after the last complete record, never inside a quoted multi-line field', () => {
  const { dir } = setup();
  const csv = 'id,msg\n1,"line a\nline b"\n2,"first\nsecond\nthird"\n';
  fs.writeFileSync(path.join(dir, 'inputs', 't.csv'), csv);
  // Every cut point inside record 2 must fall back to the end of record 1.
  for (let cap = csv.indexOf('2,') + 3; cap < csv.length; cap++) {
    const r = createInputReader(dir, { maxFileBytes: cap }).read('t.csv');
    assert.equal(r.text, 'id,msg\n1,"line a\nline b"\n', `cap ${cap}`);
    assert.deepEqual(parseCsv(r.text), [{ id: '1', msg: 'line a\nline b' }]);
  }
});

test('sandbox: a broken symlink in inputs/ is skipped by list() instead of failing the whole task', t => {
  const { base, dir } = setup();
  try {
    fs.symlinkSync(path.join(base, 'gone'), path.join(dir, 'inputs', 'dead.md'), 'junction');
  } catch (e) {
    t.skip(`cannot create symlinks here (${e.code})`);
    return;
  }
  assert.deepEqual(createInputReader(dir).list(), ['policy.md', 'sub/faq.html']);
});
