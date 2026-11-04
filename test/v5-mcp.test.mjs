import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLlm } from '../src/core/llm.mjs';
import { TOOLS } from '../src/v3/mcp.mjs';
import { startServer } from './v3-support.test.mjs';

// The model declines everything: checks fail to start judging, the guard fails open. Enough to test the plumbing.
const llm = createLlm({ client: { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } } });
const srv = await startServer({ llm, env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];

// A company with the sample agent, and its sign-in key (which is also its API key).
async function account(company = 'McpCo') {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `m${Math.random()}@mcp.test`, company }) });
  const key = /readonly value="(dk_[^"]+)"/.exec(await res.text())[1];
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await fetch(`${srv.base}/`, { headers: { cookie } })).text();
  const orgPath = /action="(\/orgs\/[^"/]+)\/sample"/.exec(home)[1];
  await fetch(`${srv.base}${orgPath}/sample`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrfOf(home) }) });
  return { key, org: orgPath.split('/').pop() };
}
let n = 0;
const rpc = async (key, method, params, raw) => {
  const res = await fetch(`${srv.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key && { authorization: `Bearer ${key}` }) }, body: JSON.stringify(raw ?? { jsonrpc: '2.0', id: ++n, method, params }) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const call = async (key, name, args) => (await rpc(key, 'tools/call', { name, arguments: args })).body.result;

test('MCP needs an API key, speaks JSON-RPC over POST, and lists its tools with their safety hints', async () => {
  const { key } = await account();
  assert.equal((await rpc(null, 'initialize', {})).status, 401);
  assert.equal((await fetch(`${srv.base}/mcp`)).status, 405);
  const init = await rpc(key, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.body.result.protocolVersion, '2025-06-18');
  assert.equal(init.body.result.serverInfo.name, 'grapim');
  assert.ok(init.body.result.capabilities.tools);
  assert.equal((await rpc(key, null, null, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  assert.equal((await rpc(key, 'initialize', { protocolVersion: '1999-01-01' })).body.result.protocolVersion, '2025-06-18', 'an unknown version gets ours');
  const list = (await rpc(key, 'tools/list', {})).body.result.tools;
  assert.deepEqual(list.map(t => t.name), TOOLS.map(t => t.name));
  assert.equal(list.find(t => t.name === 'get_agent').annotations.readOnlyHint, true);
  assert.equal(list.find(t => t.name === 'review_draft').annotations.readOnlyHint, false);
  assert.equal((await rpc(key, 'resources/list', {})).body.error.code, -32601);
  assert.equal((await rpc(key, 'tools/call', { name: 'drop_tables', arguments: {} })).body.error.code, -32602);
  const batch = await rpc(key, null, null, [{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  assert.equal(batch.status, 400, 'one message per request, as MCP 2025-06-18 requires');
});

test('the tools read and act on the key holder’s agents only, through the same checks as the API', async () => {
  const { key, org } = await account();
  const agents = (await call(key, 'list_agents', {})).structuredContent.items;
  assert.equal(agents.length, 1);
  assert.equal(agents[0].org, org);
  assert.equal(agents[0].agent, 'sample-tallyfox');

  const agent = (await call(key, 'get_agent', { org, agent: 'sample-tallyfox' })).structuredContent;
  assert.equal(agent.steps.length, 6);
  assert.match(agent.url, /\/rollout$/);
  assert.match((await call(key, 'get_check_results', { org, agent: 'sample-tallyfox' })).structuredContent.note, /No check yet/);

  const started = await call(key, 'run_check', { org, agent: 'sample-tallyfox' });
  assert.equal(started.isError, false);
  assert.equal(started.structuredContent.status, 'running');

  assert.ok(Array.isArray((await call(key, 'list_drafts', { org, agent: 'sample-tallyfox' })).structuredContent.items));
  const missing = await call(key, 'review_draft', { org, agent: 'sample-tallyfox', draft_id: 'nope', decision: 'approve' });
  assert.equal(missing.isError, true);
  const fix = await call(key, 'draft_fix', { org, agent: 'sample-tallyfox' });
  assert.equal(fix.isError, true, 'no check result yet, so no fix');

  const guard = await call(key, 'guard_check', { org, agent: 'sample-tallyfox', message: 'refund me', reply: 'Done, refunded.' });
  assert.equal(guard.isError, false);
  assert.equal(guard.structuredContent.decision, 'allow', 'a model that gives no verdict fails open, as the guard does');

  // Another company's key cannot see or touch this one.
  const other = await account('OtherCo');
  assert.equal((await call(other.key, 'list_agents', {})).structuredContent.items.every(a => a.org !== org), true);
  const denied = await call(other.key, 'get_agent', { org, agent: 'sample-tallyfox' });
  assert.equal(denied.isError, true);
  assert.equal((await call(other.key, 'run_check', { org, agent: 'sample-tallyfox' })).isError, true);
});
