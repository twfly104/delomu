import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homePage } from '../src/v3/html.mjs';

test('the home review list names the agent and hides internal check ids', () => {
  const org = { id: 'org_1', name: 'Harbor Bank' };
  const draft = { kind: 'cases', createdAt: '2026-11-09T09:46:00.000Z', rationale: 'Risk scan 2026-11-09T09-46-00-474Z-29b7: 0 of 8 policy rules were broken by the current AI. Adding these 16 probes keeps every rule under test from now on.' };
  const html = homePage({ user: { email: 'a@b.test' }, csrf: 'x', nav: { orgs: [org, { id: 'org_2', name: 'V' }] }, now: new Date('2026-11-09T10:00:00Z'), deployments: [], review: [{ org, name: 'sample-linden-agent', title: 'Linden &amp; Co. · Lia', draft }], canWrite: true });
  assert.match(html, /Test cases for Linden/);
  assert.doesNotMatch(html, /Risk scan|2026-11-09T09-46|probes|for sample-linden-agent/);
  assert.match(html, /0 of 8 policy rules broken\. Adding these 16 test messages/);
});

test('on a phone the six rollout steps stack in one column', () => {
  const html = homePage({ user: { email: 'a@b.test' }, csrf: 'x', nav: { orgs: [{ id: 'o1', name: 'A' }, { id: 'o2', name: 'B' }] }, now: new Date(), deployments: [], review: [], canWrite: false });
  assert.match(html, /@media \(max-width:760px\)\{[^}]*\.stages,\.stages\.six\{grid-template-columns:1fr\}/);
});
