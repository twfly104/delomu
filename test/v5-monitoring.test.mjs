import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readAudit } from '../src/core/audit.mjs';
import { monitorTick, setMonitor } from '../src/v3/monitoring.mjs';
import { startServer } from './v3-support.test.mjs';

// Rules-only grading, so no model is needed: the sample bot answers and phrase checks decide.
const srv = await startServer({ judge: false, monitorMinutes: 0, env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

async function sample() {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `ops${Math.random()}@mon.test`, company: 'Mon' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await get('/', cookie)).text();
  const orgPath = /action="(\/orgs\/[^"/]+)\/sample"/.exec(home)[1];
  const dep = (await post(`${orgPath}/sample`, cookie, { csrf: csrfOf(home) })).headers.get('location').replace(/\/scan\?.*$/, '');
  const [, orgId, name] = /\/orgs\/([^/]+)\/deployments\/([^/]+)$/.exec(dep);
  return { cookie, dep, orgId: decodeURIComponent(orgId), name, dir: path.join(srv.deploymentsRoot, decodeURIComponent(orgId), name) };
}

test('monitoring is turned on from the Rollout page and re-runs the saved tests only when something changed', async () => {
  const { cookie, dep, dir } = await sample();
  let page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(page, /<h2>Monitoring<\/h2><span class="badge">Off<\/span>/);

  assert.equal((await post(`${dep}/monitor`, cookie, { csrf: csrfOf(page), enabled: '1', intervalHours: '5' })).status, 400);
  assert.equal((await post(`${dep}/monitor`, cookie, { csrf: csrfOf(page), enabled: '1', intervalHours: '24', versionUrl: 'http://example.com/v' })).status, 400);
  assert.equal((await post(`${dep}/monitor`, cookie, { csrf: 'forged', enabled: '1', intervalHours: '24' })).status, 403);
  assert.equal((await post(`${dep}/monitor`, cookie, { csrf: csrfOf(page), enabled: '1', intervalHours: '24' })).status, 303);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8')).monitor.enabled, true);

  // First check: no run yet, so it runs.
  page = await (await get(`${dep}/rollout`, cookie)).text();
  const first = await post(`${dep}/monitor`, cookie, { csrf: csrfOf(page), action: 'check' });
  assert.match(first.headers.get('location'), /notice=monitorran/);
  assert.ok(fs.existsSync(path.join(dir, 'monitor.json')));
  page = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(page, /Watching|Regression/);
  assert.match(page, /Last check/);

  // Nothing changed: no second run.
  assert.match((await post(`${dep}/monitor`, cookie, { csrf: csrfOf(page), action: 'check' })).headers.get('location'), /notice=monitorchecked/);

  // The connection changed (as when the client moves its AI): the tests run again and the audit says why.
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8'));
  cfg.target.timeoutMs = 20000;
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify(cfg));
  assert.match((await post(`${dep}/monitor`, cookie, { csrf: csrfOf(page), action: 'check' })).headers.get('location'), /notice=monitorran/);
  assert.ok(readAudit(dir).some(e => e.action === 'monitor.check' && e.detail.ran && /fingerprint changed \(target\)/.test(e.detail.reason)));
  assert.match(await (await get(`${dep}/rollout`, cookie)).text(), /Turn on Monitoring|Monitoring/);
});

test('the server pass skips deployments that did not turn monitoring on, and reports missing tests', async () => {
  const a = await sample();
  const b = await sample();
  const ctx = { env: {}, now: () => new Date(), judge: false, policy: {} };
  assert.deepEqual(await monitorTick(ctx, [a, b]), [], 'monitoring is off for both');
  setMonitor(b.dir, { enabled: true, intervalHours: 24 }, { actor: 'test' });
  fs.rmSync(path.join(b.dir, 'tests.json'));
  const out = await monitorTick(ctx, [a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, b.name);
  assert.equal(out[0].orgId, b.orgId);
  assert.match(out[0].error, /no saved test set/);
});
