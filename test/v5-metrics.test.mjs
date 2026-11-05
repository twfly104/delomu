import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deploymentMetrics } from '../src/v3/metrics.mjs';
import { startServer, tmp } from './v3-support.test.mjs';

function dep(root, name, { started, hours = [], approved = [], live }) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'live'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ createdAt: started, target: { type: 'http', url: 'https://x.test' } }));
  if (hours.length) fs.writeFileSync(path.join(dir, 'hours.csv'), `date,step,hours,note\n${hours.map(([s, h]) => `2026-10-01,${s},${h},`).join('\n')}\n`);
  if (live) fs.writeFileSync(path.join(dir, 'live', `${live.slice(0, 7)}.jsonl`), `${JSON.stringify({ at: live, checkedAt: live })}\n`);
  const steps = ['mapping', 'integration', 'cases', 'fixes', 'launch-report', 'monitoring'].map(key => ({ key, state: approved.includes(key) || key === 'integration' ? 'done' : 'todo' }));
  return { org: { id: 'o', name: 'O' }, name, dir, ov: { steps, drafts: approved.map(kind => ({ kind, status: 'approved' })) } };
}

test('metrics: hours oldest first, the gate, agent-drafted share and days to first live chat', () => {
  const root = tmp('metrics');
  const rows = [
    dep(root, 'e', { started: '2026-10-05T00:00:00Z', hours: [['1-mapping', 3]] }),
    dep(root, 'a', { started: '2026-10-01T00:00:00Z', hours: [['1-mapping', 10], ['3-test-set', 10]], approved: ['mapping'], live: '2026-10-11T00:00:00Z' }),
    dep(root, 'b', { started: '2026-10-02T00:00:00Z', hours: [['1-mapping', 8]] }),
    dep(root, 'c', { started: '2026-10-03T00:00:00Z' }),
    dep(root, 'd', { started: '2026-10-04T00:00:00Z', hours: [['1-mapping', 5]] }),
  ];
  const m = deploymentMetrics(rows);
  assert.deepEqual(m.deployments.map(d => d.name), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(m.deployments[0].hours, 20);
  assert.equal(m.gate.status, 'met'); // 3 h is under half of 20 h
  assert.equal(m.deployments[0].daysToLive, 10);
  assert.equal(m.deployments[1].daysToLive, null);
  assert.equal(m.medianDaysToLive, 10);
  // a: mapping (approved draft) and integration done = 1 of 2; others: integration done by hand = 0 of 1.
  assert.equal(m.deployments[0].stepsDrafted, 1);
  assert.equal(m.automation, 1 / 6);
  assert.equal(m.totalHours, 36);
});

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());
const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

test('engineers log hours on the rollout page and see them on deployment metrics', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'fde@hours.test', company: 'Hours', kind: 'vendor' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const vendor = (await get('/', cookie)).headers.get('location');
  const clients = await (await get(vendor, cookie)).text();
  const client = (await post(`${vendor}/clients`, cookie, { csrf: csrfOf(clients), name: 'Acme' })).headers.get('location').split('?')[0];
  const clientPage = await (await get(client, cookie)).text();
  const dep = (await post(`${client}/sample`, cookie, { csrf: csrfOf(clientPage) })).headers.get('location').replace(/\/scan\?.*$/, '');

  const rollout = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(rollout, /Log engineer hours/);
  assert.equal((await post(`${dep}/hours`, cookie, { csrf: csrfOf(rollout), step: '9-nope', hours: '2' })).status, 400);
  assert.equal((await post(`${dep}/hours`, cookie, { csrf: csrfOf(rollout), step: '1-mapping', hours: '-1' })).status, 400);
  const ok = await post(`${dep}/hours`, cookie, { csrf: csrfOf(rollout), step: '1-mapping', hours: '2.5', note: 'mapped\nfields' });
  assert.equal(ok.status, 303);

  const metrics = await (await get(`${vendor}/metrics`, cookie)).text();
  assert.match(metrics, /Rollout metrics/);
  assert.match(metrics, /2\.5 h/);
  assert.match(metrics, /Acme/); // a client's agent shows its client
  assert.match(metrics, /Not enough data/);
  assert.match(metrics, /Goal: your fifth rollout/);
  assert.match(await (await get(vendor, cookie)).text(), /2\.5 h/); // and on the clients page
});
