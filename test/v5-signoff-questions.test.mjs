// The client's reviewer asks about one rule on the sign-off link; the vendor sees it on Home and the Rollout page,
// answers it, and the answer shows on the link. A re-check link shows how the check came about. The evidence pack
// carries the sign-off and a framework map, prepared by the vendor.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readAudit } from '../src/core/audit.mjs';
import { buildEvidence, frameworkRows } from '../src/v3/evidence.mjs';
import { stepStates } from '../src/v3/insights.mjs';
import { startServer } from './v3-support.test.mjs';

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie = '') => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

async function setup() {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `fde${Math.random()}@ask.test`, company: 'VendorCo', kind: 'vendor' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const vendor = (await get('/', cookie)).headers.get('location');
  const client = (await post(`${vendor}/clients`, cookie, { csrf: csrfOf(await (await get(vendor, cookie)).text()), name: 'Acme Bank' })).headers.get('location').split('?')[0];
  const dep = (await post(`${client}/sample`, cookie, { csrf: csrfOf(await (await get(client, cookie)).text()) })).headers.get('location').replace(/\/scan\?.*$/, '');
  const [, orgId, name] = /\/orgs\/([^/]+)\/deployments\/([^/]+)$/.exec(dep);
  return { cookie, dep, dir: path.join(srv.deploymentsRoot, decodeURIComponent(orgId), name) };
}

const probe = status => ({ message: 'm', tactic: 't', expected: 'e', must_include: [], must_not_include: [], status, answer: 'a', what_happened: 'w', fix: 'f' });
const FIRST = { id: '2026-11-02T10-00-00-000Z-aaaa', createdAt: '2026-11-02T10:00:00.000Z', documents: [], rationale: '',
  summary: { rules: 2, broken: 1, probes: 2, kept: 1, failed: 1, unjudged: 0, highRiskBroken: 1 },
  rules: [{ id: 'refund', title: 'Refunds within 30 days', clause: '§2', quote: 'q', rule: 'No cash after 30 days', harm: 'h', severity: 'high', probes: [probe('broken')] },
    { id: 'handoff', title: 'Hand off over $1,000', clause: '§7', quote: 'q', rule: 'Hand off to a human over $1,000', harm: 'h', severity: 'high', probes: [probe('kept')] }] };
const RECHECK = { ...FIRST, id: '2026-11-02T10-05-00-000Z-bbbb', createdAt: '2026-11-02T10:05:00.000Z', recheckOf: FIRST.id,
  summary: { ...FIRST.summary, broken: 0, kept: 2, failed: 0, highRiskBroken: 0 },
  rules: FIRST.rules.map(r => ({ ...r, probes: [probe('kept')] })) };

function writeChecks(dir) {
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  for (const s of [FIRST, RECHECK]) fs.writeFileSync(path.join(dir, 'scans', `${s.id}.json`), JSON.stringify(s));
  fs.writeFileSync(path.join(dir, 'fix.json'), JSON.stringify({ scanId: FIRST.id, summary: 'Refund rule', rules: ['refund'], approvedAt: '2026-11-02T10:03:00.000Z', approvedBy: 'human:fde@vendor.test' }));
}

test('the client asks about one rule, the vendor answers on the Rollout page, the answer shows on the link', async () => {
  const { cookie, dep, dir } = await setup();
  writeChecks(dir);
  let page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.equal((await post(`${dep}/signoff/link`, cookie, { csrf: csrfOf(page) })).status, 303);
  const token = /\/signoff\/([^"]+)"/.exec(await (await get(`${dep}/rollout`, cookie)).text())[1];

  const open = await get(`/signoff/${token}`);
  const text = await open.text();
  // How it got here: the first check, the approved fix, the re-check.
  assert.match(text, /How it got here/);
  assert.match(text, /First check, 2026-11-02: 1 of 2 rules broken/);
  assert.match(text, /Fix approved by fde@vendor\.test/);
  assert.match(text, /all 2 rules kept/);
  assert.match(text, /<option value="refund">Refunds within 30 days<\/option>/);

  const clientCookie = cookiesOf(open)[0];
  assert.equal((await post(`/signoff/${token}/question`, clientCookie, { csrf: 'forged', rule: 'refund', text: 'Why?', name: 'Dana' })).status, 403);
  assert.equal((await post(`/signoff/${token}/question`, clientCookie, { csrf: csrfOf(text), rule: 'refund', text: ' ', name: 'Dana' })).status, 400);
  const asked = await post(`/signoff/${token}/question`, clientCookie, { csrf: csrfOf(text), rule: 'refund', text: 'Does this cover store credit <b>too</b>?', name: 'Dana Lee' });
  assert.equal(asked.status, 303, 'post, then redirect: a reload does not ask twice');
  assert.match(asked.headers.get('location'), /\?asked=1#ask$/);
  const after = await (await get(`/signoff/${token}?asked=1`)).text();
  assert.match(after, /Question sent to VendorCo/);
  assert.match(after, /&lt;b&gt;too&lt;\/b&gt;/);
  assert.match(after, /Waiting for VendorCo’s answer/);
  assert.equal(readAudit(dir).filter(e => e.action === 'signoff.question' && e.actor === 'client:Dana Lee').length, 1);

  // The vendor: Home lists it first, the Rollout page has an answer box.
  const home = await (await get('/', cookie)).text();
  assert.match(home, /Question from Dana Lee about/);
  assert.match(home, /on Refunds within 30 days/);
  page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(page, /Questions from the client/);
  const action = /action="([^"]+\/questions\/q_[0-9a-f]+\/answer)"/.exec(page)[1];
  assert.equal((await post(action, cookie, { csrf: csrfOf(page), answer: 'Yes: store credit counts as a refund.' })).status, 303);
  assert.doesNotMatch(await (await get('/', cookie)).text(), /Question from Dana Lee/);
  assert.match(await (await get(`/signoff/${token}`)).text(), /Yes: store credit counts as a refund\./);
  assert.equal(readAudit(dir).filter(e => e.action === 'signoff.answer').length, 1);
});

test('the evidence pack is prepared by the vendor, lists the sign-off and maps the records to frameworks', async () => {
  const { cookie, dep, dir } = await setup();
  writeChecks(dir);
  fs.writeFileSync(path.join(dir, 'signoff.json'), JSON.stringify([{ decision: 'accepted', name: 'Dana Lee', note: 'Good', scanId: RECHECK.id, shareId: 's1', at: '2026-11-02T11:00:00.000Z' }]));
  const res = await get(`${dep}/evidence.html?from=2026-11-01&to=2026-11-03`, cookie);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Prepared by VendorCo/);
  assert.match(html, /for Acme Bank/);
  assert.match(html, /Check 2 <span class="hash subtle">/);
  assert.match(html, /<h2>Client sign-off<\/h2>/);
  assert.match(html, /<b>Accepted<\/b>/);
  assert.match(html, /ISO\/IEC 42001:2023, Annex A\.6\.2\.4/);
  assert.match(html, /not a certification/);

  const rows = frameworkRows(buildEvidence(dir, { from: '2026-11-01', to: '2026-11-03', now: new Date('2026-11-03T00:00:00Z') }));
  const row = name => rows.find(r => r[0].startsWith(name))[3];
  assert.equal(row('ISO/IEC 42001:2023, Annex A.6.2.4').ok, true);
  assert.equal(row('ISO/IEC 42001:2023, Annex A.6.2.6').ok, false, 'no live conversations: a gap, said plainly');
  assert.equal(row('EU AI Act, Article 50').ok, false, 'no disclosure rule was checked');
  assert.match(row('EU AI Act, Article 50').text, /Add the disclosure rule/);
});

test('the Test and fix step counts the policy check when it ran last', () => {
  const dir = fs.mkdtempSync(path.join(srv.deploymentsRoot, 'steps-'));
  const fixes = scans => stepStates(dir, { drafts: [], runs: [], config: {}, scans }).find(s => s.key === 'fixes');
  assert.deepEqual([fixes([]).state, fixes([]).detail], ['todo', 'Not run yet']);
  assert.deepEqual([fixes([FIRST]).state, fixes([FIRST]).detail], ['attention', '1 of 2 rules broken']);
  assert.deepEqual([fixes([RECHECK, FIRST]).state, fixes([RECHECK, FIRST]).detail], ['done', 'All 2 rules kept']);
  const newerRun = { generatedAt: '2026-11-03T00:00:00.000Z', summary: { verdict: 'accepted', pass: 9, total: 10 } };
  assert.equal(stepStates(dir, { drafts: [], runs: [newerRun], config: {}, scans: [FIRST] }).find(s => s.key === 'fixes').detail, '9/10 passing');
});
