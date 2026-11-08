import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DEMO_CLIENTS, demoScan } from '../src/v3/demo-portfolio.mjs';
import { startServer } from './v3-support.test.mjs';

test('each demo client has a recorded check whose summary matches its rules', () => {
  for (const { industry } of DEMO_CLIENTS) {
    const s = demoScan(industry);
    const broken = s.rules.filter(r => r.probes.some(p => p.status === 'broken')).length;
    assert.equal(s.summary.broken, broken, industry);
    assert.equal(s.summary.rules, s.rules.length, industry);
    assert.ok(s.rules.every(r => r.probes.every(p => p.answer)), `${industry}: every answer was recorded`);
  }
  assert.ok(demoScan('bank').summary.broken > 0, 'the bank demo shows a broken rule');
});

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

test('one click gives a vendor three sample clients at three stages', async () => {
  const cookiesOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]);
  const csrfOf = t => /name="csrf" value="([^"]+)"/.exec(t)?.[1];
  const page = await fetch(`${srv.base}/signup`);
  const signup = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'lead@demo.test', company: 'Brightdesk AI', kind: 'vendor' }) });
  const cookie = cookiesOf(signup).find(c => c.startsWith('delomu_session='));
  const vendor = (await fetch(`${srv.base}/`, { headers: { cookie }, redirect: 'manual' })).headers.get('location');
  const empty = await (await fetch(srv.base + vendor, { headers: { cookie } })).text();
  assert.match(empty, /Set up a client/);
  assert.match(empty, /Or open the demo: 3 sample clients/);
  const made = await fetch(`${srv.base}${vendor}/clients/demo`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrfOf(empty) }) });
  assert.equal(made.status, 303);
  const list = await (await fetch(srv.base + made.headers.get('location'), { headers: { cookie } })).text();
  for (const name of ['Quillby Bank (sample client)', 'Velmora Health (sample client)', 'Linden &amp; Co. (sample client)']) assert.ok(list.includes(name), name);
  assert.match(list, /Waiting for client sign-off/);
  assert.match(list, /Client accepted/);
  assert.match(list, /rules? broken/);
  assert.doesNotMatch(list, /Not checked yet/);
  // The seeded check opens like any other, and its policies count as unchanged.
  const bank = /href="(\/orgs\/[^"]+)"[^>]*><span class="av">[\s\S]{0,400}?Quillby Bank/.exec(list)[1];
  const agents = await (await fetch(srv.base + bank, { headers: { cookie } })).text();
  const dep = /href="(\/orgs\/[^"]+\/deployments\/sample-quillby-agent)/.exec(agents)[1];
  const scan = await (await fetch(`${srv.base}${dep}/scan`, { headers: { cookie } })).text();
  assert.match(scan, /policy rules broken/);
  assert.doesNotMatch(scan, /Policies changed/);
  // People read names, not slugs: the agent is "Client · Agent", each rule has a short label.
  assert.match(scan, /<h1>Quillby Bank · Max<\/h1>/);
  assert.match(scan, /Freeze card, route to Fraud/);
  assert.match(scan, /messages broke it/);
  assert.doesNotMatch(scan, /Broken in \d/);
  const health = /href="(\/orgs\/[^"]+)"[^>]*><span class="av">[\s\S]{0,400}?Velmora Health/.exec(list)[1];
  const hAgents = await (await fetch(srv.base + health, { headers: { cookie } })).text();
  const hDep = /href="(\/orgs\/[^"]+\/deployments\/sample-velmora-agent)/.exec(hAgents)[1];
  // The client sign-off status lives on the Rollout tab, the one progress tracker.
  assert.match(await (await fetch(`${srv.base}${hDep}/rollout`, { headers: { cookie } })).text(), /Waiting for the client/);
  // The Live page's example is one of this agent's own test messages, with Grapim's key name.
  const live = await (await fetch(`${srv.base}${dep}/live`, { headers: { cookie } })).text();
  assert.match(live, /GRAPIM_API_KEY/);
  assert.doesNotMatch(live, /DELOMU_API_KEY|refund after 45 days/);
});
