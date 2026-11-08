import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './v3-support.test.mjs';

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

async function signUp(body) {
  const page = await fetch(`${srv.base}/signup`, { redirect: 'manual' });
  const res = await fetch(`${srv.base}/signup`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] },
    body: new URLSearchParams({ csrf: csrfOf(await page.text()), ...body }),
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/welcome', 'a new account starts in the guided setup');
  return cookiesOf(res).find(c => c.startsWith('delomu_session='));
}
const action = (page, re) => re.exec(page)?.[1];

test('a vendor is guided one step at a time: client, agent, policies, first check', async () => {
  const cookie = await signUp({ email: 'lead@agentco.test', company: 'AgentCo', kind: 'vendor' });
  let page = await (await get('/welcome', cookie)).text();
  assert.match(page, /Who is your next client\?/);
  assert.match(page, /Step 1 of 4/);
  assert.match(page, /shown only once/, 'the sign-in key shows on the first page');
  assert.match(page, /See three sample clients instead/, 'samples are the secondary path, not the default');

  // A blank name is explained on the same page.
  const clients = action(page, /action="([^"]+\/clients)"/);
  const bad = await post(clients, cookie, { csrf: csrfOf(page), name: '', next: 'welcome' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /Step 1 of 4/);

  const added = await post(clients, cookie, { csrf: csrfOf(page), name: 'Northwind Bank', next: 'welcome' });
  assert.equal(added.headers.get('location'), '/welcome');
  page = await (await get('/welcome', cookie)).text();
  assert.match(page, /How do we reach Northwind Bank’s AI agent\?/);
  assert.match(page, /Step 2 of 4/);

  // A bad endpoint stays on the wizard with the reason.
  const connect = action(page, /action="([^"]+\/new-deployment)"/);
  const noUrl = await post(connect, cookie, { csrf: csrfOf(page), next: 'welcome', type: 'http', url: 'not a url', customer: 'Northwind Bank', pass: '90', agentKind: 'support' });
  assert.equal(noUrl.status, 400);
  assert.match(await noUrl.text(), /Step 2 of 4/);

  // No agent at hand: the sample agent goes into the client just named.
  const sample = action(page, /action="([^"]+\/sample-agent)"/);
  assert.match(sample, /^\/orgs\/[^/]+\/sample-agent$/);
  assert.equal((await post(sample, cookie, { csrf: csrfOf(page) })).headers.get('location'), '/welcome');
  page = await (await get('/welcome', cookie)).text();
  assert.match(page, /Run the first check\./, 'the sample agent comes with its policies');
  assert.match(page, /action="[^"]+\/scan"/);
  assert.doesNotMatch(page, /shown only once/, 'the key shows only once');
});

test('a company running its own agent skips the client step', async () => {
  const cookie = await signUp({ email: 'cx@shop.test', company: 'Shop', kind: 'company' });
  const page = await (await get('/welcome', cookie)).text();
  assert.match(page, /How do we reach your AI agent\?/);
  assert.match(page, /Step 1 of 3/);
  assert.match(page, /action="[^"]+\/sample"/);
});

test('signed out, the wizard asks you to sign in; skipping it keeps the normal home', async () => {
  const out = await get('/welcome', '');
  assert.equal(out.status, 303);
  assert.match(out.headers.get('location'), /\/login/);
  const cookie = await signUp({ email: 'skip@vendor2.test', company: 'Vendor2', kind: 'vendor' });
  const page = await (await get('/welcome', cookie)).text();
  assert.match(page, /Skip for now/);
  assert.equal((await get('/', cookie)).status < 400, true);
});
