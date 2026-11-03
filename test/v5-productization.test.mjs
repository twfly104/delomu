import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDraft, reviewDraft } from '../src/core/drafts.mjs';
import { draftInterventions, focusIssues, getOrgSettings, logIntervention, normTag, productizationHealth, revenueByQuarter, setRevenue, STANDARD_CONNECTIONS } from '../src/v3/productization.mjs';
import { deploymentMetrics } from '../src/v3/metrics.mjs';
import { startServer } from './v3-support.test.mjs';

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body instanceof URLSearchParams ? body : new URLSearchParams(body) });

// A deployment folder with logged hours, started on a given day.
function deployment(name, { hours, started, config = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `prod-${name}-`));
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ name, target: { type: 'http', url: 'https://x.example' }, ...config }));
  fs.writeFileSync(path.join(dir, 'hours.csv'), `date,step,hours,note\n${started},1-mapping,${hours},\n`);
  return { org: { id: `o-${name}`, name: `Client ${name}` }, name, dir, ov: { steps: [], drafts: [] } };
}
const FOCUS = { kinds: [], industry: '', connections: STANDARD_CONNECTIONS };

test('tags are normalized, and drafts a person rewrote or rejected count as manual work', async () => {
  assert.equal(normTag('  Client API has NO docs!! '), 'client-api-has-no-docs');
  const d = deployment('a', { hours: 5, started: '2026-09-01' });
  assert.throws(() => logIntervention(d.dir, { step: '2-integration', tag: '  ', by: 'me' }), /what needed a person/);
  logIntervention(d.dir, { step: '2-integration', tag: 'Client API has no docs', hours: 2, note: 'asked their CTO', by: 'me' });
  const draft = createDraft(d.dir, { kind: 'mapping', step: 1, content: {} });
  fs.writeFileSync(path.join(d.dir, 'mapping.json'), '{}');
  await reviewDraft(d.dir, draft.id, { decision: 'reject', by: 'me', note: 'wrong systems' });
  assert.deepEqual(draftInterventions(d.dir).map(i => i.tag), ['rejected-mapping-draft']);
});

test('the same manual work three times, across clients, goes on the feature list; hours that do not fall mean services', () => {
  const rows = [deployment('one', { hours: 20, started: '2026-07-01' }), deployment('two', { hours: 22, started: '2026-08-01' }), deployment('three', { hours: 21, started: '2026-09-01' }), deployment('four', { hours: 24, started: '2026-10-01' })];
  for (const r of rows.slice(0, 3)) logIntervention(r.dir, { step: '2-integration', tag: 'client API has no docs', hours: 3, by: 'me' });
  logIntervention(rows[3].dir, { step: '3-test-set', tag: 'tickets in a PDF', hours: 1, by: 'me' });
  const h = productizationHealth({ rows, m: deploymentMetrics(rows), settings: { teamSize: null, focus: FOCUS }, now: new Date('2026-11-03T00:00:00Z') });
  assert.equal(h.backlog.length, 1);
  assert.equal(h.backlog[0].tag, 'client-api-has-no-docs');
  assert.equal(h.backlog[0].count, 3);
  assert.equal(h.backlog[0].clients.length, 3);
  assert.equal(h.backlog[0].hours, 9);
  assert.equal(h.verdict, 'services');
  assert.ok(h.reasons.some(r => /hours are not falling/.test(r)));
  assert.ok(h.reasons.some(r => /make it a feature/.test(r)));
});

test('falling hours read as software; revenue splits into service and software by quarter, per person', () => {
  const rows = [deployment('one', { hours: 40, started: '2026-05-01' }), deployment('two', { hours: 30, started: '2026-06-01' }), deployment('three', { hours: 12, started: '2026-07-01' }), deployment('four', { hours: 10, started: '2026-08-01' })];
  const now = new Date('2026-11-03T00:00:00Z');
  setRevenue(rows[0].dir, { onboardingUsd: 8000, monthlyUsd: 2000, since: '2026-09' }, { actor: 'me', now: new Date('2026-08-15T00:00:00Z') });
  setRevenue(rows[1].dir, { onboardingUsd: 4000, monthlyUsd: 1000, since: '2026-10' }, { actor: 'me', now: new Date('2026-10-02T00:00:00Z') });
  assert.throws(() => setRevenue(rows[2].dir, { onboardingUsd: -5 }, { actor: 'me' }), /0 or more/);
  assert.throws(() => setRevenue(rows[2].dir, { monthlyUsd: 10, since: '2026-13' }, { actor: 'me' }), /month like/);
  const h = productizationHealth({ rows, m: deploymentMetrics(rows), settings: { teamSize: 2, focus: FOCUS }, now });
  assert.equal(h.verdict, 'software');
  assert.equal(h.mrr, 3000);
  const q3 = h.quarters.find(q => q.quarter === '2026-Q3');
  assert.deepEqual([q3.service, q3.software], [8000, 2000]); // Aug fee; Sep monthly
  const q4 = h.quarters.find(q => q.quarter === '2026-Q4');
  assert.deepEqual([q4.service, q4.software], [4000, 2000 * 2 + 1000 * 2]); // Oct fee; Oct and Nov monthly so far
  assert.equal(h.revenuePerPerson, (8000 + 4000 + 2000 * 3 + 1000 * 2) / 2);
  assert.equal(revenueByQuarter([], now).length, 4);
});

test('clients outside the focus and one-off integrations are flagged', () => {
  const focus = { kinds: ['support'], industry: 'ecommerce', connections: ['openai', 'http'] };
  assert.deepEqual(focusIssues({ agentKind: 'support', industry: 'ecommerce', target: { type: 'http' } }, focus), []);
  const issues = focusIssues({ agentKind: 'hr', industry: 'banking', target: { type: 'command' } }, focus).map(i => i.type);
  assert.deepEqual(issues, ['kind', 'industry', 'one-off']);
  assert.deepEqual(focusIssues({ target: { type: 'intercom' } }, focus).map(i => i.type), ['one-off']);
});

test('from the web: tag manual steps, enter revenue, set the focus; the page shows the feature list and off-focus clients', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `fde${Math.random()}@prod.test`, company: 'ProdCo', kind: 'vendor' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = (await get('/', cookie)).headers.get('location');
  const client = (await post(`${home}/clients`, cookie, { csrf: csrfOf(await (await get(home, cookie)).text()), name: 'Acme' })).headers.get('location').split('?')[0];
  const dep = (await post(`${client}/sample`, cookie, { csrf: csrfOf(await (await get(client, cookie)).text()) })).headers.get('location').replace(/\/scan\?.*$/, '');

  let roll = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(roll, /What needed a person/);
  assert.match(roll, /Revenue from this client/);
  for (let i = 0; i < 3; i++) assert.equal((await post(`${dep}/hours`, cookie, { csrf: csrfOf(roll), step: '2-integration', hours: '2', tag: 'Client API has no docs' })).status, 303);
  roll = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(roll, /<option value="client-api-has-no-docs">/, 'earlier tags are offered again');
  assert.equal((await post(`${dep}/revenue`, cookie, { csrf: csrfOf(roll), onboardingUsd: 'lots' })).status, 400);
  assert.equal((await post(`${dep}/revenue`, cookie, { csrf: csrfOf(roll), onboardingUsd: '5000', monthlyUsd: '1500', since: '2026-11' })).status, 303);

  let prod = await (await get(`${home}/productization`, cookie)).text();
  assert.match(prod, /Productization health/);
  assert.match(prod, /Make it a feature/);
  assert.match(prod, /Client api has no docs/);
  assert.match(prod, /Service and software revenue/);

  // Two kinds checked: both are kept. The sample is a support agent, so a sales-only focus flags it.
  const form = new URLSearchParams({ csrf: csrfOf(prod), teamSize: '3', industry: '' });
  form.append('kinds', 'sales'); form.append('kinds', 'billing');
  form.append('connections', 'openai'); form.append('connections', 'http');
  assert.equal((await post(`${home}/productization`, cookie, form)).status, 303);
  assert.deepEqual(getOrgSettings(srv.deploymentsRoot, home.split('/').pop()).focus.kinds, ['sales', 'billing']);
  prod = await (await get(`${home}/productization`, cookie)).text();
  assert.match(prod, /support agent, outside your focus \(sales, billing\)/);
  assert.match(prod, /3 people/);
  assert.equal((await post(`${home}/productization`, cookie, new URLSearchParams({ csrf: csrfOf(prod), teamSize: '0' }))).status, 400);
});
