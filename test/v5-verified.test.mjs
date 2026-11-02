import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './v3-support.test.mjs';

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());
const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie = '') => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

test('the public page is off by default, shows dated facts only when on, and ends when turned off', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'own@ver.test', company: 'Ver Co' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await get('/', cookie)).text();
  const orgPath = /action="(\/orgs\/[^"/]+)\/sample"/.exec(home)[1];
  const dep = (await post(`${orgPath}/sample`, cookie, { csrf: csrfOf(home) })).headers.get('location').replace(/\/scan\?.*$/, '');
  const dir = path.join(srv.deploymentsRoot, decodeURIComponent(orgPath.split('/').pop()), dep.split('/').pop());
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', 'x.json'), JSON.stringify({ id: 'x', createdAt: '2026-11-01T09:00:00.000Z', summary: { rules: 8, broken: 2, probes: 16, kept: 14, failed: 2, unjudged: 0 }, rules: [] }));

  const settings = await (await get(`${dep}/settings`, cookie)).text();
  assert.match(settings, /Public page/);
  assert.match(settings, />Off</);
  const on = await (await post(`${dep}/verified`, cookie, { csrf: csrfOf(settings), state: 'on' })).text();
  const link = /value="(http[^"]+\/verified\/[^"]+)"/.exec(on)[1];
  const token = link.split('/verified/')[1];

  const pub = await (await get(`/verified/${token}`)).text();
  assert.match(pub, /2026-11-01: kept 6 of 8 rules/);
  assert.match(pub, /2 rules broken in that check/);
  assert.match(pub, /Audit log/);
  assert.match(pub, /not a certification/);
  assert.doesNotMatch(pub, /certified/i);

  await post(`${dep}/verified`, cookie, { csrf: csrfOf(on), state: 'off' });
  assert.equal((await get(`/verified/${token}`)).status, 404);
});
