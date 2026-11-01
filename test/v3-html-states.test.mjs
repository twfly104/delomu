import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskScanPage } from '../src/v3/html.mjs';

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const probe = (status, extra = {}) => ({ message: 'm', tactic: 't', expected: 'e', must_include: [], must_not_include: [], status, answer: status === 'error' ? '' : 'a', what_happened: 'w', fix: '', ...extra });
const rule = (id, probes) => ({ id, clause: 'p.md §1', quote: 'q', rule: `Rule ${id}`, harm: 'h', severity: 'high', probes });
const page = (rules, summary, extra = {}) => riskScanPage({
  user: { email: 'a@b.test' }, csrf: 'c', nav: {}, now: new Date('2026-11-02T00:00:00Z'), org: { id: 'org_1', name: 'Org' }, name: 'bot', config: {},
  can: { write: true, run: true }, ...extra,
  ov: { scans: [{ id: 's', createdAt: '2026-11-01T23:59:00Z', seconds: 60, model: 'm', documents: ['p.md'], rules, summary }], inputs: [{ name: 'p.md' }, { name: 'tickets.csv' }], live: { week: { checked: 0, flagged: 0 } }, runs: [], pending: [], drafts: [], next: {} },
});

test('a check with unanswered or unjudged messages never reads as all rules kept', () => {
  const html = text(page([rule('a', [probe('kept'), probe('unjudged')]), rule('b', [probe('error')]), rule('c', [probe('kept')])],
    { rules: 3, broken: 0, probes: 4, kept: 2, failed: 0, unjudged: 2, highRiskBroken: 0 }));
  assert.match(html, /2 of 3 rules could not be checked/);
  assert.match(html, /Needs a person to check/);
  assert.match(html, /2 answers to review/);
  assert.doesNotMatch(html, /All 3 (policy )?rules kept/);
  assert.match(html, /Policies 1 document · 1 ticket export/);
});

test('while a check runs, the header says so and offers no second run', () => {
  const html = page([rule('a', [probe('kept')])], { rules: 1, broken: 0, probes: 1, kept: 1, failed: 0, unjudged: 0, highRiskBroken: 0 }, { checking: true });
  assert.match(html, /<span class="badge accent">Checking…<\/span>/);
  assert.match(html, /disabled aria-busy="true">.*Checking…/s);
  assert.doesNotMatch(html, /Run check again/);
});
