import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { callTarget } from '../src/adapters.mjs';
import { close, listen, startServer } from './v3-support.test.mjs';

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
const seen = [];
const chat = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const b = JSON.parse(body);
    seen.push({ auth: req.headers.authorization, body: b });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `You said: ${b.messages.at(-1).content}` } }] }));
  });
});
const chatBase = await listen(chat);
after(() => { srv.close(); close(chat); });

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

test('an OpenAI-compatible agent is connected from the form and answers each test as a chat completion', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'eng@oa.test', company: 'OA' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const orgPath = /href="(\/orgs\/[^"/]+)\/new-deployment"/.exec(await (await get('/', cookie)).text())[1];
  const form = await (await get(`${orgPath}/new-deployment`, cookie)).text();
  assert.match(form, /OpenAI-compatible API/);
  const csrf = csrfOf(form);
  assert.equal((await post(`${orgPath}/new-deployment`, cookie, { csrf, name: 'oa', type: 'openai', openai_url: `${chatBase}/v1/chat/completions` })).status, 400);
  const made = await post(`${orgPath}/new-deployment`, cookie, {
    csrf, name: 'oa', type: 'openai', openai_url: `${chatBase}/v1/chat/completions`, openai_model: 'gpt-x', openai_auth: 'Bearer ${CUSTOMER_OA_KEY}', openai_system: 'You are Acme support.',
  });
  assert.equal(made.status, 303);
  const dir = path.join(srv.deploymentsRoot, decodeURIComponent(orgPath.split('/').pop()), 'oa');
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8'));
  assert.equal(config.target.preset, 'openai');
  assert.equal(config.target.output, 'choices.0.message.content');

  process.env.CUSTOMER_OA_KEY = 'test-key-not-real';
  try {
    assert.equal(await callTarget(config.target, 'Can I get a refund?'), 'You said: Can I get a refund?');
  } finally {
    delete process.env.CUSTOMER_OA_KEY;
  }
  assert.equal(seen[0].auth, 'Bearer test-key-not-real');
  assert.deepEqual(seen[0].body, { model: 'gpt-x', messages: [{ role: 'system', content: 'You are Acme support.' }, { role: 'user', content: 'Can I get a refund?' }] });
  assert.match(await (await get(`${orgPath}/deployments/oa/settings`, cookie)).text(), /OpenAI-compatible API/);
});
