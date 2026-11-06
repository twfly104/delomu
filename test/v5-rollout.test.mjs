import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../src/core/llm.mjs';
import { startServer } from './v3-support.test.mjs';

// The model declines every task, so each step reports why it drafted nothing and the check reports its failure.
const calls = [];
const llm = createLlm({ client: { beta: { messages: { create: async req => { calls.push(req.system); return { stop_reason: 'refusal', content: [] }; } } } } });
const srv = await startServer({ llm, env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

test('one click runs every step the agent can draft, then the check, and reports each step', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'fde@roll.test', company: 'Roll' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await get('/', cookie)).text();
  const orgPath = /action="(\/orgs\/[^"/]+)\/sample"/.exec(home)[1];
  const sample = await post(`${orgPath}/sample`, cookie, { csrf: csrfOf(home) });
  const dep = sample.headers.get('location').replace(/\/scan\?.*$/, '');

  const before = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(before, /Run the whole rollout/);
  assert.match(before, /The six steps/);
  assert.equal((await post(`${dep}/rollout`, cookie, { csrf: 'forged' })).status, 403);
  assert.equal((await post(`${dep}/rollout`, cookie, { csrf: csrfOf(before) })).status, 303);

  let text = '';
  for (let i = 0; i < 50; i++) {
    text = await (await get(`${dep}/rollout`, cookie)).text();
    if (!/Rollout running/.test(text)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  for (const label of ['Draft the data mapping', 'Draft the integration', 'Draft the test set', 'Run the policy check']) assert.match(text, new RegExp(label));
  assert.match(text, /Skipped/);
  assert.match(text, /Failed/); // the check: the model refused to read the policy
  for (const label of ['Draft the fix for broken rules', 'Get the client’s sign-off']) assert.match(text, new RegExp(label));
  assert.match(text, /Needs a finished policy check/); // no check result, so no fix and no sign-off yet
  assert.match(text, /Run the rollout again/);
  assert.ok(calls.length >= 3, 'every step asked the model');
});
