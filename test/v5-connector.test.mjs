import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { applyConnector, draftConnector, generateConnectorCode, toolSchemas, validateConnector } from '../src/v1/connector.mjs';
import { startServer } from './v3-support.test.mjs';

const MANIFEST = {
  baseUrlEnv: 'LINDEN_API_URL', auth: { type: 'bearer', header: '', env: 'LINDEN_API_TOKEN' }, notes: '',
  tools: [
    { name: 'get_order', description: 'Look up an order', kind: 'read', method: 'GET', path: '/orders/{order_id}', params: [{ name: 'order_id', type: 'string', in: 'path', required: true, description: 'Order id' }, { name: 'expand', type: 'string', in: 'query', required: false, description: '' }] },
    { name: 'cancel_order', description: 'Cancel an order within 1 hour of purchase', kind: 'action', method: 'POST', path: '/orders/{order_id}/cancel', params: [{ name: 'order_id', type: 'string', in: 'path', required: true, description: '' }, { name: 'reason', type: 'string', in: 'body', required: false, description: '' }] },
  ],
};

// A fake client API and a fake Delomu guard on one local server; the guard blocks L-1006.
const calls = [];
const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/guard') return res.end(JSON.stringify(JSON.parse(body).action.input.order_id === 'L-1006' ? { decision: 'block', violations: [{ rule: 'Only cancel within 1 hour' }] } : { decision: 'allow', violations: [] }));
    res.end(JSON.stringify({ ok: true, path: req.url }));
  });
});
await new Promise(r => api.listen(0, '127.0.0.1', r));
const apiBase = `http://127.0.0.1:${api.address().port}`;
const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' }, importJson: async (url) => {
  if (url.includes('/policies.json')) return { policies: [{ title: 'Refund policy', body: '<p>Refunds within <b>30 days</b>.</p>' }] };
  throw Object.assign(new Error('unexpected'), { status: 500 });
} });
after(() => { api.close(); srv.close(); });

test('the manifest is validated: actions are marked, placeholders are declared, paths stay on the base URL', () => {
  assert.deepEqual(validateConnector(MANIFEST), []);
  const bad = { ...MANIFEST, tools: [{ ...MANIFEST.tools[0], method: 'DELETE' }, { ...MANIFEST.tools[1], name: 'cancel_order', path: 'http://evil.example/x' }, { ...MANIFEST.tools[1], path: '/orders/{id}/cancel' }] };
  const problems = validateConnector(bad).join(' | ');
  assert.match(problems, /DELETE request changes something, so its kind must be action/);
  assert.match(problems, /must start with \/ and stay on the base URL/);
  assert.match(problems, /listed twice/);
  assert.match(problems, /placeholder \{id\} has no path parameter/);
  assert.match(validateConnector({ ...MANIFEST, auth: { type: 'bearer', env: 'lower' } }).join(), /auth.env/);
  assert.throws(() => applyConnector(fs.mkdtempSync(path.join(os.tmpdir(), 'c-')), { ...MANIFEST, tools: [] }), /not valid/);
});

test('the agent drafts a manifest from the API docs as a draft to review; invalid answers create nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conn-'));
  fs.mkdirSync(path.join(dir, 'inputs'));
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ name: 'x' }));
  fs.writeFileSync(path.join(dir, 'inputs', 'order-api.md'), '# Orders API\nGET /orders/{order_id}\nPOST /orders/{order_id}/cancel');
  const ok = await draftConnector(dir, { llm: { json: async () => ({ ok: true, data: { ...MANIFEST, rationale: 'From order-api.md' } }) } });
  assert.equal(ok.ok, true);
  assert.equal(ok.drafts[0].kind, 'connector');
  assert.equal(ok.drafts[0].status, 'pending');
  const bad = await draftConnector(dir, { llm: { json: async () => ({ ok: true, data: { ...MANIFEST, tools: [{ ...MANIFEST.tools[1], kind: 'read' }], rationale: '' } }) } });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /kind must be action/);
});

test('the generated code reads with GET, acts with the body, and does not act when the guard blocks', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gen-')), 'connector.mjs');
  fs.writeFileSync(file, generateConnectorCode(MANIFEST, { client: 'Linden & Co.', guardUrl: `${apiBase}/guard` }));
  Object.assign(process.env, { LINDEN_API_URL: `${apiBase}/`, LINDEN_API_TOKEN: 'test-token', DELOMU_API_KEY: 'dk_test' });
  const mod = await import(pathToFileURL(file).href);
  assert.equal(mod.anthropicTools.length, 2);
  assert.deepEqual(mod.openaiTools[1].function.parameters.required, ['order_id']);

  assert.deepEqual(await mod.runTool('get_order', { order_id: 'L 1/2', expand: 'items' }), { ok: true, path: '/orders/L%201%2F2?expand=items' });
  assert.equal(calls.at(-1).auth, 'Bearer test-token');

  const before = calls.length;
  assert.deepEqual(await mod.runTool('cancel_order', { order_id: 'L-1006' }, { message: 'cancel both' }), { blocked: true, reason: 'Only cancel within 1 hour' });
  assert.equal(calls.length, before + 1, 'only the guard was called');
  assert.equal(calls.at(-1).auth, 'Bearer dk_test');

  await mod.runTool('cancel_order', { order_id: 'L-1005', reason: 'changed mind' });
  assert.deepEqual([calls.at(-1).method, calls.at(-1).url, calls.at(-1).body], ['POST', '/orders/L-1005/cancel', '{"reason":"changed mind"}']);
  await assert.rejects(() => mod.runTool('cancel_order', {}), /needs order_id/);
  assert.equal(toolSchemas(MANIFEST).anthropic[0].input_schema.properties.order_id.type, 'string');
});

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie = '') => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

test('from the web: import store policies read-only, import again with the saved token, download the connector', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `fde${Math.random()}@conn.test`, company: 'ConnCo' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await get('/', cookie)).text();
  const orgPath = /action="(\/orgs\/[^"/]+)\/sample"/.exec(home)[1];
  const dep = (await post(`${orgPath}/sample`, cookie, { csrf: csrfOf(home) })).headers.get('location').replace(/\/scan\?.*$/, '');
  const [, orgId, name] = /\/orgs\/([^/]+)\/deployments\/([^/]+)$/.exec(dep);
  const dir = path.join(srv.deploymentsRoot, decodeURIComponent(orgId), name);

  let inputs = await (await get(`${dep}/inputs`, cookie)).text();
  assert.match(inputs, /Import from the client’s systems/);
  assert.equal((await post(`${dep}/import`, cookie, { csrf: csrfOf(inputs), source: 'shopify', shop: 'not a shop', token: 'shpat_secret_value' })).status, 400);
  const first = await post(`${dep}/import`, cookie, { csrf: csrfOf(inputs), source: 'shopify', shop: 'linden.myshopify.com', token: 'shpat_secret_value' });
  assert.equal(first.status, 303);
  assert.match(fs.readFileSync(path.join(dir, 'inputs', 'shopify-policies.md'), 'utf8'), /Refunds within 30 days/);
  assert.ok(!fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8').includes('shpat_secret_value'), 'the token is stored encrypted');
  inputs = await (await get(`${dep}/inputs`, cookie)).text();
  assert.match(inputs, /Import again/);
  assert.equal((await post(`${dep}/import`, cookie, { csrf: csrfOf(inputs), source: 'shopify' })).status, 303, 'the saved token and store are reused');

  // No connector yet: nothing to download. Once one is approved, the code and tool definitions come back.
  assert.equal((await get(`${dep}/connector.js`, cookie)).status, 404);
  applyConnector(dir, MANIFEST);
  const roll = await (await get(`${dep}/rollout`, cookie)).text();
  assert.match(roll, /Client-system connector/);
  assert.match(roll, /2 tools · 1 that act/);
  const code = await get(`${dep}/connector.js`, cookie);
  assert.equal(code.status, 200);
  assert.match(code.headers.get('content-disposition'), /attachment/);
  assert.match(await code.text(), new RegExp(`/v1/orgs/${orgId}/deployments/${name}/guard`));
  assert.equal(JSON.parse(await (await get(`${dep}/connector-tools.json`, cookie)).text()).openai.length, 2);
  assert.notEqual((await get(`${dep}/connector.js`)).status, 200, 'signed-out visitors get nothing');
});
