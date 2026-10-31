import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { harvest, search, suggest, forget, stats } from '../src/v4/library.mjs';
import { rank, tokenize } from '../src/v4/bm25.mjs';
import { readAudit, verifyAudit } from '../src/core/audit.mjs';
import { listDrafts } from '../src/core/drafts.mjs';
import { commands } from '../src/commands/v4.mjs';

const ENV = { DELOMU_LIBRARY_SALT: 'test-salt-0123456789abcdef' };
const NOW = new Date('2026-10-31T12:00:00Z');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-v4-'));
const write = (dir, file, data) => {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
};

const GLOBEX_CASES = `id,input,expected,must_include,must_not_include,regex,tags
dup,"I was charged twice for ORD-10423, email me at hank@globex.example","Confirms the duplicate charge is refunded",refund,,,billing
card,"Please remove card 4111 1111 1111 1111 from Globex Ltd account",Explains how to remove a saved card,card,full card number,,billing|cards
late,"I want a refund after 45 days",Offers store credit instead of cash,store credit,cash refund,,billing|policy
pw,"I forgot my password, call me on +44 20 7946 0958",Points to the reset page,reset,,,account
bad,,missing input row is skipped,,,,
`;

function globex(dir, overrides = {}) {
  write(dir, 'delomu.json', {
    customer: 'Globex Ltd',
    name: 'support-bot',
    industry: 'Fintech',
    target: {
      type: 'http',
      url: 'https://api.globex.example/v2/chat?tenant=gx',
      method: 'post',
      headers: { authorization: 'Bearer ${GLOBEX_KEY}', 'x-tenant': 'globex-42' },
      body: { message: '{{input}}', user: 'hank@globex.example' },
      output: 'reply.text',
    },
    library: { consent: true, consentedBy: 'Globex DPO', consentedAt: '2026-10-01', names: ['Hank Scorpio', 'Hank'], patterns: { ORDER: 'ORD-\\d{5}' } },
    ...overrides,
  });
  write(dir, 'cases.csv', GLOBEX_CASES);
  write(dir, 'mapping.json', { systems: [{ name: 'Zendesk', purpose: 'tickets' }, { name: 'Stripe', purpose: 'billing' }], entities: [], openQuestions: [] });
  write(dir, 'runs/2026-10-30T10-00-00Z/results.json', {
    cases: [
      { id: 'dup', tags: ['billing'], status: 'fail', checks: [{ type: 'contains', value: 'refund', status: 'fail', reason: 'Answer does not mention "refund".' }] },
      { id: 'late', tags: ['policy'], status: 'fail', checks: [{ type: 'judge', status: 'fail', reason: 'Promised a cash refund to hank@globex.example after 45 days.' }] },
    ],
  });
  write(dir, 'runs/2026-10-31T10-00-00Z/results.json', {
    cases: [
      { id: 'dup', tags: ['billing'], status: 'fail', checks: [{ type: 'contains', value: 'refund', status: 'fail', reason: 'Answer does not mention "refund".' }] },
      { id: 'pw', tags: ['account'], status: 'pass', checks: [{ type: 'contains', status: 'pass' }] },
    ],
  });
  return dir;
}

test('harvest: refuses without recorded consent and logs the refusal', () => {
  const lib = tmp();
  for (const library of [undefined, { consent: false, consentedBy: 'x', consentedAt: '2026-01-01' },
    { consent: true, consentedAt: '2026-01-01' }, { consent: true, consentedBy: 'x', consentedAt: '2026-13-01' },
    { consent: true, consentedBy: 'x', consentedAt: '2027-01-01' }, { consent: 'yes', consentedBy: 'x', consentedAt: '2026-01-01' }]) {
    const dir = globex(tmp(), { library });
    assert.throws(() => harvest(dir, { libraryDir: lib, env: ENV, now: NOW }), /harvest refused: no recorded customer consent/);
    assert.equal(readAudit(dir).at(-1).action, 'library.harvest.refused');
  }
  assert.equal(fs.existsSync(path.join(lib, 'entries.jsonl')), false);
});

test('harvest: needs the salt and a library directory', () => {
  const dir = globex(tmp());
  assert.throws(() => harvest(dir, { libraryDir: tmp(), env: {} }), /DELOMU_LIBRARY_SALT is not set/);
  assert.throws(() => harvest(dir, { libraryDir: tmp(), env: { DELOMU_LIBRARY_SALT: 'short' } }), /at least 16/);
  assert.throws(() => harvest(dir, { env: ENV }), /libraryDir is required/);
});

test('harvest: de-identified cases, integration template and grouped failure patterns', () => {
  const dir = globex(tmp());
  const lib = tmp();
  const r = harvest(dir, { libraryDir: lib, env: ENV, now: NOW, by: 'alex' });
  assert.match(r.source, /^[a-f0-9]{32}$/);
  assert.deepEqual(r.byKind, { case: 4, integration: 1, failure: 2 });
  assert.equal(r.added, 7);
  assert.equal(r.removed, 0);

  const raw = fs.readFileSync(path.join(lib, 'entries.jsonl'), 'utf8');
  for (const secret of ['Globex', 'globex', 'Hank', 'ORD-10423', '4111', '7946', 'api.globex', 'tenant=gx', 'GLOBEX_KEY', 'DPO']) {
    assert.equal(raw.includes(secret), false, `library leaks ${secret}`);
  }

  const entries = raw.trim().split('\n').map(l => JSON.parse(l));
  for (const e of entries) {
    assert.equal(e.source, r.source);
    assert.equal(e.industry, 'fintech');
    assert.deepEqual(e.sourceSystems, ['zendesk', 'stripe']);
    assert.equal(e.createdAt, NOW.toISOString());
    assert.match(e.id, /^[a-f0-9]{16}$/);
  }
  const dup = entries.find(e => e.kind === 'case' && e.input.includes('charged twice'));
  assert.equal(dup.input, 'I was charged twice for [ORDER], email me at [EMAIL]');
  assert.deepEqual(entries.find(e => e.input?.startsWith('Please remove')).tags, ['billing', 'cards']);

  const integration = entries.find(e => e.kind === 'integration');
  assert.deepEqual(integration.template, {
    type: 'http', method: 'post', body: { message: '{{input}}', user: '[EMAIL]' }, output: 'reply.text',
    url: 'https://[HOST]/v2/chat?[QUERY]', headers: { authorization: '[VALUE]', 'x-tenant': '[VALUE]' },
  });
  assert.match(integration.summary, /http integration; method POST; body fields message, user; output path reply\.text/);

  const failures = entries.filter(e => e.kind === 'failure');
  assert.deepEqual(failures[0], { ...failures[0], checkType: 'contains', pattern: 'Answer does not mention "refund".', cases: 1, occurrences: 2, tags: ['billing'] });
  assert.equal(failures[1].pattern, 'Promised a cash refund to [EMAIL] after # days.');

  const audit = readAudit(dir).at(-1);
  assert.equal(audit.actor, 'human:alex');
  assert.equal(audit.action, 'library.harvest');
  assert.equal(audit.target, r.source);
  assert.equal(audit.detail.consentedBy, 'Globex DPO');
  assert.ok(audit.detail.redactions.email >= 2);
  assert.equal(verifyAudit(dir).ok, true);
  assert.deepEqual(readAudit(lib).map(e => e.action), ['library.harvest']);
});

test('harvest: re-harvesting replaces the deployment\'s earlier entries', () => {
  const dir = globex(tmp());
  const lib = tmp();
  const other = globex(tmp(), { customer: 'Initech' });
  const first = harvest(dir, { libraryDir: lib, env: ENV, now: NOW });
  harvest(other, { libraryDir: lib, env: ENV, now: NOW });
  const ids = fs.readFileSync(path.join(lib, 'entries.jsonl'), 'utf8');

  const again = harvest(dir, { libraryDir: lib, env: ENV, now: NOW });
  assert.equal(again.source, first.source);
  assert.equal(again.removed, first.added);
  assert.equal(stats(lib).entries, 14);
  assert.deepEqual(new Set(ids.trim().split('\n')), new Set(fs.readFileSync(path.join(lib, 'entries.jsonl'), 'utf8').trim().split('\n')));

  write(dir, 'cases.csv', GLOBEX_CASES.split('\n').filter(l => !l.startsWith('late,')).join('\n'));
  const fewer = harvest(dir, { libraryDir: lib, env: ENV, now: NOW });
  assert.equal(fewer.byKind.case, 3);
  assert.equal(stats(lib).entries, 13);
});

test('forget: deletes one deployment\'s entries only, and validates the hash', () => {
  const lib = tmp();
  const a = harvest(globex(tmp()), { libraryDir: lib, env: ENV, now: NOW });
  const b = harvest(globex(tmp(), { customer: 'Initech' }), { libraryDir: lib, env: ENV, now: NOW });
  assert.notEqual(a.source, b.source);
  assert.deepEqual(forget(lib, a.source), { removed: 7 });
  assert.deepEqual(forget(lib, a.source), { removed: 0 });
  const s = stats(lib);
  assert.equal(s.entries, 7);
  assert.equal(s.sources, 1);
  assert.deepEqual(s.byKind, { case: 4, integration: 1, failure: 2 });
  assert.deepEqual(s.byIndustry, { fintech: 7 });
  assert.throws(() => forget(lib, '../../etc'), /32 lowercase hex/);
  assert.deepEqual(readAudit(lib).map(e => e.action), ['library.harvest', 'library.harvest', 'library.forget', 'library.forget']);
  assert.deepEqual(forget(tmp(), a.source), { removed: 0 });
});

test('bm25: rarer terms, more matches and shorter documents rank higher', () => {
  assert.deepEqual(tokenize('The REFUND, for café-orders!'), ['refund', 'café', 'orders']);
  const docs = [
    { id: 'common', text: 'customer asks about the order' },
    { id: 'status', text: 'order status update' },
    { id: 'where', text: 'where is my order today' },
    { id: 'rare', text: 'customer asks about a chargeback' },
    { id: 'both', text: 'chargeback on order' },
    { id: 'long', text: 'chargeback ' + 'filler words go here '.repeat(20) },
    { id: 'none', text: 'password reset' },
  ];
  const hits = rank(docs, 'chargeback order');
  const ids = hits.map(h => h.id);
  assert.deepEqual(ids.slice(0, 2), ['both', 'rare']);
  assert.ok(ids.indexOf('rare') < ids.indexOf('common'), 'the rarer term outweighs the common one');
  assert.equal(ids.at(-1), 'long', 'a long document is penalised');
  assert.equal(ids.includes('none'), false);
  assert.deepEqual(rank(docs, 'the of'), []);
  assert.deepEqual(rank([], 'x'), []);
});

test('search: ranks entries and filters by kind, tags and limit', () => {
  const lib = tmp();
  harvest(globex(tmp()), { libraryDir: lib, env: ENV, now: NOW });
  const hits = search(lib, 'refund store credit');
  assert.equal(hits[0].input, 'I want a refund after 45 days');
  assert.ok(hits.every((h, i) => i === 0 || hits[i - 1].score >= h.score));
  assert.deepEqual(search(lib, 'refund', { kind: 'failure' }).map(h => h.kind), ['failure', 'failure']);
  assert.deepEqual(search(lib, 'card refund', { tags: ['cards'] }).map(h => h.tags), [['billing', 'cards']]);
  assert.equal(search(lib, 'refund', { limit: 1 }).length, 1);
  assert.equal(search(lib, 'refund', { industry: 'retail' }).length, 0);
  assert.throws(() => search(lib, '  '), /needs a query/);
  assert.throws(() => search(lib, 'x', { kind: 'secrets' }), /kind must be/);
  assert.throws(() => search(lib, 'x', { limit: 0 }), /limit/);
  assert.deepEqual(search(tmp(), 'refund'), []);
});

test('suggest: creates a pending cases draft and skips cases the deployment already has', () => {
  const lib = tmp();
  harvest(globex(tmp()), { libraryDir: lib, env: ENV, now: NOW });

  const dir = tmp();
  write(dir, 'delomu.json', { customer: 'Initech', industry: 'fintech', target: { type: 'command', command: 'node bot.mjs' } });
  // Already has the late-refund case (same text after de-identification) and an unrelated one.
  const own = 'id,input,expected,must_include,tags\nmine,"I want a refund after 45 days",Offers store credit,store credit,billing\nx,"Why was I charged twice?",Explains refunds for duplicate charges,refund,billing\n';
  write(dir, 'cases.csv', own);
  write(dir, 'mapping.json', { systems: [{ name: 'Stripe', purpose: 'payments' }] });

  const draft = suggest(dir, { libraryDir: lib, env: ENV, now: NOW });
  assert.equal(draft.status, 'pending');
  assert.equal(draft.kind, 'cases');
  assert.equal(draft.step, 3);
  const rows = draft.content.rows;
  assert.ok(rows.length >= 1);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ['id', 'input', 'expected', 'must_include', 'must_not_include', 'regex', 'tags']);
    assert.match(row.id, /^lib-[a-f0-9]{8}$/);
    assert.ok(row.tags.split('|').includes('from-library'));
    assert.notEqual(row.input, 'I want a refund after 45 days');
  }
  assert.equal(rows[0].input, 'I was charged twice for [ORDER], email me at [EMAIL]');
  assert.match(draft.rationale, new RegExp(`${rows[0].id}: matched .*"charged".*same industry \\(fintech\\); shared systems: stripe; shared tags: billing`));
  assert.equal(fs.readFileSync(path.join(dir, 'cases.csv'), 'utf8'), own);
  assert.equal(readAudit(dir).at(-1).action, 'draft.create');

  // Cases already proposed in a pending draft are not proposed again.
  const next = suggest(dir, { libraryDir: lib, env: ENV, now: NOW });
  const again = new Set(next?.content.rows.map(r => r.id) ?? []);
  for (const row of rows) assert.equal(again.has(row.id), false);
  assert.ok(listDrafts(dir, { status: 'pending' }).length >= 1);

  assert.throws(() => suggest(dir, { libraryDir: lib, limit: 99 }), /limit/);
});

test('suggest: skips the deployment\'s own entries and returns null when nothing is new', () => {
  const lib = tmp();
  const dir = globex(tmp());
  harvest(dir, { libraryDir: lib, env: ENV, now: NOW });
  assert.equal(suggest(dir, { libraryDir: lib, env: ENV, now: NOW }), null);
  assert.equal(suggest(dir, { libraryDir: tmp(), env: ENV, now: NOW }), null);

  const empty = tmp();
  write(empty, 'delomu.json', { target: { type: 'command', command: 'x' } });
  assert.throws(() => suggest(empty, { libraryDir: lib, env: ENV }), /nothing to match on/);

  // With no cases yet, the inputs/ folder drives the query.
  write(empty, 'inputs/notes.md', 'Customers forgot their password and need a reset link.');
  const d = suggest(empty, { libraryDir: lib, env: ENV, now: NOW });
  assert.equal(d.content.rows[0].must_include, 'reset');
});

test('cli: library subcommands validate arguments and print results', async () => {
  const [library] = commands;
  assert.equal(library.name, 'library');
  assert.throws(() => library.run(['nope']), /usage: delomu library harvest/);
  assert.throws(() => library.run(['stats']), /usage: delomu library stats --library DIR/);

  const lib = tmp();
  const dir = globex(tmp());
  const logs = [];
  const original = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  const saved = process.env.DELOMU_LIBRARY_SALT;
  process.env.DELOMU_LIBRARY_SALT = ENV.DELOMU_LIBRARY_SALT;
  try {
    assert.equal(library.run(['harvest', dir, '--library', lib]), 0);
    assert.equal(library.run(['search', 'store', 'credit', '--library', lib, '--kind', 'case', '--limit', '2']), 0);
    assert.equal(library.run(['stats', '--library', lib]), 0);
  } finally {
    console.log = original;
    if (saved === undefined) delete process.env.DELOMU_LIBRARY_SALT; else process.env.DELOMU_LIBRARY_SALT = saved;
  }
  assert.match(logs[0], /Harvested 7 entries \(case 4, integration 1, failure 2\)/);
  assert.match(logs.find(l => l.includes('store credit')) ?? logs.join('\n'), /case/);
  assert.ok(logs.some(l => l === '7 entries from 1 deployment(s)'));
});

test('harvest: a regex that needed scrubbing is dropped, and rows left without a check are skipped', () => {
  const dir = globex(tmp());
  write(dir, 'cases.csv', 'id,input,expected,regex,tags\n' +
    'phone,"What is your support line?",,"415-555-2671",support\n' +
    'both,"Where do I call?",Gives the support line,"415-555-2671",support\n' +
    'keep,"Which plan?",,"plan-\d+",support\n');
  const lib = tmp();
  const r = harvest(dir, { libraryDir: lib, env: ENV, now: NOW });
  assert.equal(r.byKind.case, 2);
  const cases = search(lib, 'support line call plan', { kind: 'case' });
  assert.deepEqual(cases.map(c => [c.input, c.regex]).sort(), [['Where do I call?', ''], ['Which plan?', 'plan-\d+']]);
  assert.ok(r.redactions.phone >= 2);
});

test('suggest: does not propose again a case the engineer rejected', async () => {
  const { reviewDraft } = await import('../src/core/drafts.mjs');
  const lib = tmp();
  harvest(globex(tmp()), { libraryDir: lib, env: ENV, now: NOW });
  const dir = tmp();
  write(dir, 'delomu.json', { customer: 'Initech', industry: 'fintech', target: { type: 'command', command: 'x' } });
  write(dir, 'cases.csv', 'id,input,expected,tags\nx,"Why was I charged twice? I want a refund",Explains refunds,billing\n');
  const first = suggest(dir, { libraryDir: lib, env: ENV, now: NOW, limit: 1 });
  await reviewDraft(dir, first.id, { decision: 'reject', by: 'alex' }, NOW);
  const second = suggest(dir, { libraryDir: lib, env: ENV, now: NOW, limit: 1 });
  assert.ok(second, 'other library cases are still suggested');
  assert.notEqual(second.content.rows[0].id, first.content.rows[0].id);
  assert.notEqual(second.content.rows[0].input, first.content.rows[0].input);
});
