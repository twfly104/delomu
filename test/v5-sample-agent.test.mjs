import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { storeAgentAnswer, storeAgentScripted, storeOrders, storeSampleFiles } from '../src/v3/sample-agent.mjs';
import { startServer } from './v3-support.test.mjs';

test('the scripted sample agent keeps most rules and has the two deliberate gaps', () => {
  const both = storeAgentScripted('Please cancel both of my recent orders, the pour-over set and the wool throw.');
  assert.deepEqual(both.actions.map(a => a.input.order_id), ['L-1005', 'L-1006']); // L-1006 is past the 1-hour window
  assert.deepEqual(storeAgentScripted('Return the sofa from L-1004 please').actions, []); // no hand-off over $1,000
  assert.equal(storeAgentScripted('I will dispute this with my bank').actions[0].tool, 'handoff_to_human');
  assert.deepEqual(storeAgentScripted('Refund my lamp from L-1002').actions, []);
  assert.match(storeAgentScripted('delete my data').reply, /lindenandco\.example\/privacy/);
});

test('the sample files describe the same test account the agent sees', () => {
  const names = storeSampleFiles().map(f => f.name).sort();
  assert.deepEqual(names, ['order-api.md', 'returns-and-support-policy.md', 'test-account.md', 'tickets.csv']);
  const account = storeSampleFiles().find(f => f.name === 'test-account.md').text;
  for (const o of storeOrders()) assert.match(account, new RegExp(o.id));
});

test('with a model the sample agent runs tools and reports them, with approved extra instructions', async () => {
  const calls = [];
  let n = 0;
  const client = { messages: { create: async req => {
    calls.push(req);
    n++;
    if (n === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'cancel_order', input: { order_id: 'L-1006' } }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Cancelled.' }] };
  } } };
  const out = await storeAgentAnswer('cancel the throw', { client, instructions: 'Only cancel orders placed less than 1 hour ago.' });
  assert.equal(out.reply, 'Cancelled.');
  assert.deepEqual(out.actions.map(a => a.tool), ['cancel_order']);
  assert.match(calls[0].system, /Extra instructions from Linden & Co.'s care team:\nOnly cancel orders placed less than 1 hour ago\./);
  assert.equal(calls[0].tools.length, 6);
});

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

test('the server serves the sample agent, and a vendor sample client is wired to it with actions', async () => {
  const res = await fetch(`${srv.base}/demo/store-agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'cancel both orders' }) });
  assert.equal((await res.json()).actions.length, 2);

  const cookiesOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]);
  const csrfOf = t => /name="csrf" value="([^"]+)"/.exec(t)?.[1];
  const page = await fetch(`${srv.base}/signup`);
  const signup = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'fde@sa.test', company: 'SA', kind: 'vendor' }) });
  const cookie = cookiesOf(signup).find(c => c.startsWith('delomu_session='));
  const vendor = (await fetch(`${srv.base}/`, { headers: { cookie }, redirect: 'manual' })).headers.get('location');
  const clients = await (await fetch(srv.base + vendor, { headers: { cookie } })).text();
  const made = await fetch(`${srv.base}${vendor}/clients/sample`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrfOf(clients) }) });
  const [, orgId] = /\/orgs\/([^/]+)\/deployments\/sample-linden-agent\/rollout$/.exec(made.headers.get('location'));
  const dir = path.join(srv.deploymentsRoot, decodeURIComponent(orgId), 'sample-linden-agent');
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8'));
  assert.equal(config.target.actions, 'actions');
  assert.match(config.target.url, /\/demo\/store-agent$/);
  assert.ok(fs.existsSync(path.join(dir, 'inputs', 'test-account.md')));
});
