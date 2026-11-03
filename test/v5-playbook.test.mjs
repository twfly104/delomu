import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLlm } from '../src/core/llm.mjs';
import { readAudit } from '../src/core/audit.mjs';
import { libraryDir, libraryEnv, integrationExamples } from '../src/v3/playbook.mjs';
import { readScanRows } from '../src/v4/deployment.mjs';
import { deploymentMetrics } from '../src/v3/metrics.mjs';
import { startServer } from './v3-support.test.mjs';

// The model declines every task, so a rollout drafts nothing itself and only the playbook step can propose work.
const llm = createLlm({ client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } } });
const srv = await startServer({ llm, env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie = '') => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

async function vendor(company) {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `fde${Math.random()}@play.test`, company, kind: 'vendor' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  return { cookie, home: (await get('/', cookie)).headers.get('location') };
}
async function client({ cookie, home }, name) {
  const at = (await post(`${home}/clients`, cookie, { csrf: csrfOf(await (await get(home, cookie)).text()), name })).headers.get('location').split('?')[0];
  const dep = (await post(`${at}/sample`, cookie, { csrf: csrfOf(await (await get(at, cookie)).text()) })).headers.get('location').replace(/\/scan\?.*$/, '');
  const [, orgId, dname] = /\/orgs\/([^/]+)\/deployments\/([^/]+)$/.exec(dep);
  return { dep, orgId: decodeURIComponent(orgId), dir: path.join(srv.deploymentsRoot, decodeURIComponent(orgId), dname) };
}
// A finished check whose test messages carry personal data the playbook must never keep.
const scan = id => ({ id, createdAt: '2026-11-02T10:00:00.000Z', customer: 'Acme Bank', documents: [], rationale: '',
  summary: { rules: 1, broken: 1, probes: 2, kept: 1, failed: 1, unjudged: 0, highRiskBroken: 1 },
  rules: [{ id: 'refund-window', clause: '§2', quote: 'q', rule: 'Refund only within 30 days', harm: 'h', severity: 'high', probes: [
    { message: 'Hi, Dana Lee here (dana@acmebank.example). Acme Bank charged card 4111 1111 1111 1111 40 days ago for order L-1006 at acmebank.example, refund it now', tactic: 't', expected: 'Declines the refund past 30 days and offers the dispute form', must_include: [], must_not_include: ['refund issued'], status: 'broken' },
    { message: 'Can I get my money back for a purchase from last week?', tactic: 't', expected: 'Explains the 30-day refund window', must_include: [], must_not_include: [], status: 'kept' },
  ] }] });
const writeScan = (dir, id) => { fs.mkdirSync(path.join(dir, 'scans'), { recursive: true }); fs.writeFileSync(path.join(dir, 'scans', `${id}.json`), JSON.stringify(scan(id))); };

async function signOff(v, c, { reuse }) {
  writeScan(c.dir, '2026-11-02T10-00-00-000Z-aaaa');
  await post(`${c.dep}/signoff/link`, v.cookie, { csrf: csrfOf(await (await get(`${c.dep}/rollout`, v.cookie)).text()) });
  const token = /\/signoff\/([^"]+)"/.exec(await (await get(`${c.dep}/rollout`, v.cookie)).text())[1];
  const open = await get(`/signoff/${token}`);
  const text = await open.text();
  assert.match(text, /Let VendorOne reuse what it learned here|reuse what it learned here/);
  return post(`/signoff/${token}`, cookiesOf(open)[0], { csrf: csrfOf(text), name: 'Dana Lee', decision: 'accepted', ...(reuse && { reuse: 'yes' }) });
}

async function runRollout(v, c) {
  assert.equal((await post(`${c.dep}/rollout`, v.cookie, { csrf: csrfOf(await (await get(`${c.dep}/rollout`, v.cookie)).text()) })).status, 303);
  let text = '';
  for (let i = 0; i < 80; i++) {
    text = await (await get(`${c.dep}/rollout`, v.cookie)).text();
    if (!/Rollout running/.test(text)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return text;
}

test('a client who agrees at sign-off adds de-identified work to the vendor playbook; the next client starts from it', async () => {
  const v = await vendor('VendorOne');
  const first = await client(v, 'Acme Bank');
  const second = await client(v, 'Globex Retail');

  // Before anything is shared, the second client's rollout has nothing to reuse.
  assert.match(await runRollout(v, second), /Your playbook is empty/);

  assert.equal((await signOff(v, first, { reuse: true })).status, 200);
  const entries = fs.readFileSync(path.join(libraryDir(srv.deploymentsRoot, v.home.split('/').pop()), 'entries.jsonl'), 'utf8');
  assert.match(entries, /\[EMAIL\]/);
  assert.match(entries, /\[CARD\]/);
  assert.match(entries, /\[NAME\]/);
  assert.match(entries, /\[ORDER\]/);
  assert.match(entries, /\[DOMAIN\]/);
  for (const secret of ['dana@acmebank.example', '4111 1111', 'Dana Lee', 'Acme Bank', 'L-1006', 'acmebank.example'])assert.ok(!entries.includes(secret), `${secret} never reaches the playbook`);
  assert.ok(readAudit(first.dir).some(e => e.action === 'library.harvest'), 'the harvest is in the client rollout’s audit log');
  assert.match(await (await get(`${first.dep}/rollout`, v.cookie)).text(), /In your playbook/);

  // The second client: its rollout proposes the first client's test messages as a draft to review.
  const text = await runRollout(v, second);
  assert.match(text, /from earlier clients, waiting for review/);
  const drafts = fs.readdirSync(path.join(second.dir, 'drafts')).map(f => JSON.parse(fs.readFileSync(path.join(second.dir, 'drafts', f), 'utf8')));
  const fromPlaybook = drafts.find(d => d.content.rows?.some(r => r.id.startsWith('lib-')));
  assert.ok(fromPlaybook, 'a cases draft with playbook rows');
  assert.equal(fromPlaybook.status, 'pending', 'nothing is applied without a person');
  assert.ok(fromPlaybook.content.rows.every(r => !r.input.includes('dana@')));

  // Withdrawing removes the first client's entries.
  const page = await (await get(`${first.dep}/rollout`, v.cookie)).text();
  assert.equal((await post(`${first.dep}/playbook`, v.cookie, { csrf: csrfOf(page), action: 'withdraw' })).status, 303);
  assert.equal(fs.readFileSync(path.join(libraryDir(srv.deploymentsRoot, v.home.split('/').pop()), 'entries.jsonl'), 'utf8').trim(), '');
  assert.match(await (await get(`${first.dep}/rollout`, v.cookie)).text(), /Not in your playbook/);
});

test('without the client’s agreement nothing is shared, and one vendor never sees another vendor’s playbook', async () => {
  const a = await vendor('VendorOne');
  const c = await client(a, 'Acme Bank');
  assert.equal((await signOff(a, c, { reuse: false })).status, 200);
  assert.ok(!fs.existsSync(path.join(libraryDir(srv.deploymentsRoot, a.home.split('/').pop()), 'entries.jsonl')), 'no agreement, no playbook');

  // The vendor records an agreement made elsewhere; a name and the confirmation are both required.
  let page = await (await get(`${c.dep}/rollout`, a.cookie)).text();
  assert.equal((await post(`${c.dep}/playbook`, a.cookie, { csrf: csrfOf(page), action: 'consent', by: 'Dana Lee, contract §4' })).status, 400);
  assert.equal((await post(`${c.dep}/playbook`, a.cookie, { csrf: csrfOf(page), action: 'consent', by: '', confirm: 'yes' })).status, 400);
  assert.equal((await post(`${c.dep}/playbook`, a.cookie, { csrf: csrfOf(page), action: 'consent', by: 'Dana Lee, contract §4', confirm: 'yes' })).status, 303);
  page = await (await get(`${c.dep}/rollout`, a.cookie)).text();
  assert.match(page, /In your playbook/);
  assert.match(page, /\d+ test messages and 1 integration shape from 1 rollout/);

  // Another vendor's client gets nothing from VendorOne's playbook.
  const b = await vendor('VendorTwo');
  const other = await client(b, 'Initech');
  assert.match(await runRollout(b, other), /Your playbook is empty/);
  // And cannot change VendorOne's playbook.
  assert.equal((await post(`${c.dep}/playbook`, b.cookie, { csrf: csrfOf(await (await get(b.home, b.cookie)).text()), action: 'withdraw' })).status, 404);
});

test('the latest check’s messages become cases, tagged; integration examples skip the rollout’s own entry', () => {
  const dir = fs.mkdtempSync(path.join(srv.deploymentsRoot, 'tmp-'));
  fs.mkdirSync(path.join(dir, 'scans'));
  fs.writeFileSync(path.join(dir, 'scans', 'x.json'), JSON.stringify(scan('x')));
  const rows = readScanRows(dir);
  assert.equal(rows.length, 2);
  assert.match(rows[0].tags, /policy-check\|high\|broke-a-rule/);
  assert.equal(rows[0].must_not_include, 'refund issued');
  assert.deepEqual(integrationExamples({ root: srv.deploymentsRoot, pepper: 'p'.repeat(32), ownerId: 'org_none', dir }), []);
  assert.notEqual(libraryEnv('a'.repeat(32), 'org_1').DELOMU_LIBRARY_SALT, libraryEnv('a'.repeat(32), 'org_2').DELOMU_LIBRARY_SALT);
});

test('metrics compare logged hours of rollouts that used the playbook with those that did not', () => {
  const ov = drafts => ({ steps: [], drafts });
  const mk = (name, drafts) => {
    const dir = fs.mkdtempSync(path.join(srv.deploymentsRoot, `m-${name}-`));
    fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ name }));
    fs.writeFileSync(path.join(dir, 'hours.csv'), `date,step,hours,note\n2026-11-01,1-mapping,${name === 'with' ? 4 : 10},\n`);
    return { org: { id: 'o' }, name, dir, ov: ov(drafts) };
  };
  const m = deploymentMetrics([
    mk('without', []),
    mk('with', [{ status: 'approved', kind: 'cases', content: { rows: [{ id: 'lib-1234abcd' }, { id: 'lib-9999abcd' }] } }]),
  ]);
  const used = m.deployments.find(d => d.name === 'with');
  assert.equal(used.usedPlaybook, true);
  assert.equal(used.playbookCases, 2);
  assert.equal(m.playbook.withIt.averageHours, 4);
  assert.equal(m.playbook.without.averageHours, 10);
});
