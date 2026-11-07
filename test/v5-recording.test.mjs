import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarizeHar, saveRecording, readRecording, templatePath } from '../src/v1/recording.mjs';
import { draftConnector } from '../src/v1/connector.mjs';
import { startServer } from './v3-support.test.mjs';

// Secrets and personal data placed in every part of a request and response: none may reach the summary.
const SECRETS = ['sk_live_9f8e7d6c5b4a', 'eyJhbGciOiJIUzI1NiJ9.payload.sig', 'sess=abc123secret', 'dana@client.example', '4111111111111111', 'hunter2pass', '+1 415 555 0100', 'ord_8f3k2m9x7q1z5', 'Dana Lee'];
const entry = (method, url, { body, resp, mime = 'application/json', type = 'fetch', status = 200 } = {}) => ({
  _resourceType: type,
  request: {
    method, url,
    headers: [{ name: 'Authorization', value: `Bearer ${SECRETS[1]}` }, { name: 'Cookie', value: SECRETS[2] }, { name: 'X-Api-Key', value: SECRETS[0] }],
    ...(body !== undefined ? { postData: { mimeType: 'application/json', text: JSON.stringify(body) } } : {}),
  },
  response: { status, content: { mimeType: mime, text: resp === undefined ? '' : JSON.stringify(resp) } },
});
const HAR = JSON.stringify({ log: { entries: [
  entry('GET', `https://api.client.example/orders/ord_8f3k2m9x7q1z5?email=${encodeURIComponent(SECRETS[3])}&expand=items`, { resp: { id: SECRETS[7], total: 129.5, customer: { email: SECRETS[3], name: SECRETS[8], phone: SECRETS[6] }, items: [{ sku: 'A1', qty: 1 }] } }),
  entry('GET', 'https://api.client.example/orders/9912?expand=items', { resp: { id: '9912', total: 10 } }),
  entry('POST', 'https://api.client.example/orders/ord_8f3k2m9x7q1z5/refund', { body: { amount: 129.5, card: SECRETS[4], password: SECRETS[5], reason: 'late' }, resp: { status: 'refunded' } }),
  entry('GET', 'https://app.client.example/static/app.js', { mime: 'application/javascript', type: 'script' }),
  entry('GET', 'https://www.google-analytics.com/collect?tid=1', { type: 'xhr' }),
  entry('OPTIONS', 'https://api.client.example/orders/1', {}),
  entry('GET', 'https://app.client.example/orders', { mime: 'text/html', type: 'document' }),
] } });

test('a HAR becomes the shape of each API call, with ids templated and every value dropped', () => {
  const s = summarizeHar(HAR, { now: new Date('2026-11-07T00:00:00Z') });
  assert.equal(s.ok, true);
  assert.equal(s.endpoints, 2); // the two order lookups merge into one endpoint; static, analytics, preflight and pages are skipped
  assert.equal(s.calls, 3);
  assert.match(s.md, /## GET \/orders\/\{id\}/);
  assert.match(s.md, /## POST \/orders\/\{id\}\/refund/);
  assert.match(s.md, /seen 2 times/);
  assert.match(s.md, /Query parameters: email, expand/);
  assert.match(s.md, /customer\.email \(string\)/);
  assert.match(s.md, /items\[\]\.sku \(string\)/);
  assert.match(s.md, /Request body \(JSON\): amount \(number\), card \(string\), password \(string\), reason \(string\)/);
  assert.match(s.md, /Bearer token in the Authorization header/);
  assert.match(s.md, /a browser session cookie/);
  assert.match(s.md, /the X-Api-Key header/);
  for (const secret of SECRETS) assert.ok(!s.md.includes(secret), `leaked ${secret}`);
  assert.ok(!/late|refunded|129\.5|A1/.test(s.md), 'no body or response values');
});

test('paths keep names and lose values; non-HAR and empty recordings explain what to do', () => {
  assert.equal(templatePath('/v2/orders/12345/items/3f2b1c9e-1a2b-4c3d-8e9f-001122334455'), '/v2/orders/{id}/items/{id}');
  assert.equal(templatePath('/customers/dana%40client.example/cards'), '/customers/{id}/cards');
  assert.equal(templatePath('/orders/search'), '/orders/search');
  assert.match(summarizeHar('not json').reason, /not a HAR file/);
  assert.match(summarizeHar(JSON.stringify({ log: { entries: [entry('GET', 'https://x.example/a.css', { mime: 'text/css', type: 'stylesheet' })] } })).reason, /no API calls/);
});

test('the connector draft reads the recording as API docs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-'));
  fs.mkdirSync(path.join(dir, 'inputs'));
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ name: 'x' }));
  saveRecording(dir, summarizeHar(HAR));
  assert.equal(readRecording(dir).endpoints, 2);
  let prompt = '';
  const llm = { json: async req => { prompt = req.prompt; return { ok: true, data: { baseUrlEnv: 'CLIENT_API_URL', auth: { type: 'bearer', header: '', env: 'CLIENT_TOKEN' }, tools: [{ name: 'get_order', description: 'Look up an order.', kind: 'read', method: 'GET', path: '/orders/{id}', params: [{ name: 'id', type: 'string', in: 'path', required: true, description: 'Order id' }] }], notes: '', rationale: 'From the recording.' } }; } };
  const res = await draftConnector(dir, { llm });
  assert.equal(res.ok, true);
  assert.match(prompt, /recording\/api-calls\.md/);
  assert.match(prompt, /POST \/orders\/\{id\}\/refund/);
});

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());
const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];

test('an engineer uploads a recording from the Rollout page; the raw file is not kept', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'rec@roll.test', company: 'Rec', kind: 'company' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const get = url => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
  const home = await (await get('/')).text();
  const orgPath = /action="(\/orgs\/[^"/]+)\/sample"/.exec(home)[1];
  const sample = await fetch(`${srv.base}${orgPath}/sample`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrfOf(home) }) });
  const dep = sample.headers.get('location').replace(/\/scan\?.*$/, '');
  const roll = await (await get(`${dep}/rollout`)).text();
  assert.match(roll, /No API docs\? Record it\./);
  const upload = (csrf, text) => { const fd = new FormData(); fd.set('csrf', csrf); fd.set('har', new Blob([text], { type: 'application/json' }), 'session.har'); return fetch(srv.base + dep + '/recording', { method: 'POST', redirect: 'manual', headers: { cookie }, body: fd }); };
  assert.equal((await upload('forged', HAR)).status, 403);
  assert.equal((await upload(csrfOf(roll), 'nope')).status, 400);
  const ok = await upload(csrfOf(roll), HAR);
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('location'), /notice=recorded/);
  const after = await (await get(`${dep}/rollout?notice=recorded`)).text();
  assert.match(after, /2 API endpoints recorded/);
  assert.match(after, /Draft from the docs and the recording/);
  const depDir = fs.readdirSync(srv.deploymentsRoot, { recursive: true }).map(String);
  assert.ok(depDir.some(f => f.endsWith(path.join('recording', 'api-calls.md'))));
  assert.ok(!depDir.some(f => f.endsWith('.har')), 'raw HAR is never stored');
  const removed = await fetch(srv.base + dep + '/recording', { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrfOf(after), action: 'remove' }) });
  assert.match(removed.headers.get('location'), /notice=recordingremoved/);
  assert.doesNotMatch(await (await get(`${dep}/rollout`)).text(), /API endpoints? recorded/);
});
