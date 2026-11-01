// The Intercom and Zendesk connectors, against local fake servers that answer with the documented
// response shapes. No real help-desk account is involved; credentials are fake test values.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { callTarget } from '../src/adapters.mjs';
import { stripHtml } from '../src/connectors/common.mjs';
import { intercomReply } from '../src/connectors/intercom.mjs';
import { zendeskBaseUrl } from '../src/connectors/zendesk.mjs';
import { validateTarget } from '../src/v1/validate.mjs';
import { checkTarget } from '../src/v3/workspace.mjs';
import { close, listen, seedOrg, startServer } from './v3-support.test.mjs';

process.env.CUSTOMER_TEST_INTERCOM_TOKEN = 'intercom-test-token-not-real';
process.env.CUSTOMER_TEST_ZD_KEY_ID = 'app_test_key';
process.env.CUSTOMER_TEST_ZD_SECRET = 'zendesk-test-secret-not-real';

const readJson = req => new Promise(resolve => {
  let s = '';
  req.on('data', d => { s += d; });
  req.on('end', () => resolve(s ? JSON.parse(s) : undefined));
});

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Fake Intercom: contacts search/create, create conversation, retrieve conversation.
// state.mode: "reply" (bot answers on the 2nd poll), "silent", "unauthorized", "conflict".
async function fakeIntercom() {
  const state = { mode: 'reply', polls: 0, requests: [], contacts: [] };
  const server = http.createServer(async (req, res) => {
    const body = await readJson(req);
    const url = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: url.pathname, search: url.search, headers: req.headers, body });
    if (state.mode === 'unauthorized') return send(res, 401, { type: 'error.list', errors: [{ code: 'unauthorized', message: 'Access Token Invalid' }] });
    if (req.method === 'POST' && url.pathname === '/contacts/search') {
      const value = body.query.value[0].value;
      const data = state.mode === 'conflict' ? [] : state.contacts.filter(c => c.external_id === value);
      return send(res, 200, { type: 'list', data, total_count: data.length, pages: null });
    }
    if (req.method === 'POST' && url.pathname === '/contacts') {
      if (state.mode === 'conflict') return send(res, 409, { type: 'error.list', errors: [{ code: 'conflict', message: 'A contact matching those details already exists with id=6762f11b1bb69f9f2193bba3' }] });
      const contact = { type: 'contact', id: `c${state.contacts.length + 1}`, role: body.role, external_id: body.external_id };
      state.contacts.push(contact);
      return send(res, 200, contact);
    }
    if (req.method === 'POST' && url.pathname === '/conversations') {
      state.polls = 0;
      return send(res, 200, { type: 'user_message', id: '403918', created_at: 1700000000, body: body.body, message_type: 'inapp', conversation_id: '499' });
    }
    if (req.method === 'GET' && url.pathname === '/conversations/499') {
      state.polls += 1;
      const parts = [
        { type: 'conversation_part', id: 'p0', part_type: 'note', body: '<p>Internal: VIP customer</p>', created_at: 1700000001, author: { type: 'admin', id: '1', name: 'Sam' } },
      ];
      if (state.mode === 'reply' && state.polls >= 2) {
        parts.push({ type: 'conversation_part', id: 'p1', part_type: 'comment', body: '<p>Refunds take <b>5&nbsp;days</b> &amp; arrive by card.</p><p>Anything else?</p>', created_at: 1700000003, author: { type: 'bot', id: '278', name: 'Fin' } });
      }
      return send(res, 200, { type: 'conversation', id: '499', state: 'open', source: { type: 'conversation', body: '<p>question</p>' }, conversation_parts: { type: 'conversation_part.list', conversation_parts: parts, total_count: parts.length } });
    }
    send(res, 404, { type: 'error.list', errors: [{ code: 'not_found', message: 'Resource Not Found' }] });
  });
  const base = await listen(server);
  return { base, state, close: () => close(server) };
}

// Fake Sunshine Conversations v2 under /sc. state.mode: "reply", "silent", "locked".
async function fakeZendesk() {
  const state = { mode: 'reply', polls: 0, requests: [], messages: [] };
  const server = http.createServer(async (req, res) => {
    const body = await readJson(req);
    const url = new URL(req.url, 'http://x');
    state.requests.push({ method: req.method, path: url.pathname, headers: req.headers, body });
    const p = url.pathname;
    if (req.method === 'POST' && p === '/sc/v2/apps/app1/users') return send(res, 201, { user: { id: 'u1', externalId: body.externalId } });
    if (req.method === 'POST' && p === '/sc/v2/apps/app1/conversations') {
      state.polls = 0;
      state.messages = [{ id: 'm0', received: '2026-11-01T10:00:00.000Z', author: { type: 'business', subtypes: ['bot'] }, content: { type: 'text', text: 'Hi! How can I help?' }, source: { type: 'zd:answerBot' } }];
      return send(res, 201, { conversation: { id: 'conv1', type: 'personal' } });
    }
    if (p === '/sc/v2/apps/app1/conversations/conv1/messages') {
      if (req.method === 'POST') {
        if (state.mode === 'locked') return send(res, 423, { errors: [{ code: 'locked', title: 'Conversation message limit reached' }] });
        const m = { id: 'm1', received: '2026-11-01T10:00:01.000Z', author: { type: 'user', userId: body.author.userId }, content: body.content, source: { type: 'api' } };
        state.messages.push(m);
        return send(res, 201, { messages: [m] });
      }
      state.polls += 1;
      if (state.mode === 'reply' && state.polls === 2) {
        state.messages.push({ id: 'm2', received: '2026-11-01T10:00:03.000Z', author: { type: 'business', subtypes: ['AI'], displayName: 'AI agent' }, content: { type: 'text', text: 'You can return it within 30 days.' }, source: { type: 'zd:agentWorkspace' } });
      }
      return send(res, 200, { messages: state.messages, meta: { hasMore: false }, links: {} });
    }
    send(res, 404, { errors: [{ code: 'not_found', title: 'Not found' }] });
  });
  const base = await listen(server);
  return { base, state, close: () => close(server) };
}

let ic;
let zd;
before(async () => { ic = await fakeIntercom(); zd = await fakeZendesk(); });
after(async () => { await ic.close(); await zd.close(); });

const intercomTarget = extra => ({ type: 'intercom', token: '${CUSTOMER_TEST_INTERCOM_TOKEN}', baseUrl: ic.base, pollMs: 10, timeoutMs: 2000, ...extra });
const zendeskTarget = extra => ({ type: 'zendesk', appId: 'app1', keyId: '${CUSTOMER_TEST_ZD_KEY_ID}', secret: '${CUSTOMER_TEST_ZD_SECRET}', baseUrl: `${zd.base}/sc`, pollMs: 10, timeoutMs: 2000, ...extra });

test('html replies become plain text', () => {
  assert.equal(stripHtml('<p>Hello&nbsp;<b>there</b> &amp; welcome</p><p>Line&#39;2&#x21;</p>'), "Hello there & welcome\nLine'2!");
  assert.equal(stripHtml('<ul><li>one</li><li>two</li></ul>a<br>b<script>x()</script>'), '- one\n- two\na\nb');
  assert.equal(stripHtml(null), '');
});

test('intercom: finds or creates the test contact, starts a conversation and returns the bot reply as text', async () => {
  ic.state.mode = 'reply';
  ic.state.requests = [];
  const answer = await callTarget(intercomTarget({ contactExternalId: 'qa-1' }), 'How long do refunds take?');
  assert.equal(answer, 'Refunds take 5 days & arrive by card.\nAnything else?');
  const [search, create, convo, ...polls] = ic.state.requests;
  assert.equal(search.path, '/contacts/search');
  assert.deepEqual(search.body.query.value[0], { field: 'external_id', operator: '=', value: 'qa-1' });
  assert.equal(search.headers.authorization, 'Bearer intercom-test-token-not-real');
  assert.equal(search.headers['intercom-version'], '2.17');
  assert.deepEqual([create.path, create.body.role, create.body.external_id], ['/contacts', 'user', 'qa-1']);
  assert.deepEqual(convo.body, { from: { type: 'user', id: 'c1' }, body: 'How long do refunds take?' });
  assert.equal(polls.length, 2);
  assert.equal(polls[0].search, '?display_as=plaintext');

  // The second call reuses the contact instead of creating another.
  ic.state.requests = [];
  await callTarget(intercomTarget({ contactExternalId: 'qa-1' }), 'again');
  assert.equal(ic.state.requests.filter(r => r.path === '/contacts').length, 0);
  assert.equal(ic.state.contacts.length, 1);
});

test('intercom: a conflict on create reuses the existing contact id', async () => {
  ic.state.mode = 'conflict';
  ic.state.requests = [];
  await assert.rejects(callTarget(intercomTarget({ timeoutMs: 100 }), 'hi'), /did not reply/);
  const convo = ic.state.requests.find(r => r.path === '/conversations');
  assert.equal(convo.body.from.id, '6762f11b1bb69f9f2193bba3');
});

test('intercom: notes, user parts and parts before the message are not replies', () => {
  const convo = parts => ({ conversation_parts: { conversation_parts: parts } });
  assert.equal(intercomReply(convo([
    { part_type: 'note', body: 'internal', created_at: 10, author: { type: 'admin' } },
    { part_type: 'comment', body: 'old', created_at: 4, author: { type: 'bot' } },
    { part_type: 'comment', body: 'me again', created_at: 11, author: { type: 'user' } },
    { part_type: 'assignment', body: null, created_at: 12, author: { type: 'bot' } },
  ]), 5), null);
  assert.equal(intercomReply(convo([{ part_type: 'comment', body: '<p>Hi from a teammate</p>', created_at: 6, author: { type: 'admin' } }]), 5), 'Hi from a teammate');
  assert.equal(intercomReply({}, 5), null);
});

test('intercom: a bot that never replies times out with a clear error', async () => {
  ic.state.mode = 'silent';
  const started = Date.now();
  await assert.rejects(callTarget(intercomTarget({ timeoutMs: 150 }), 'hello?'), /Intercom conversation 499 did not reply within/);
  assert.ok(Date.now() - started < 2000);
});

test('intercom: an API error status is reported with the status and Intercom message', async () => {
  ic.state.mode = 'unauthorized';
  await assert.rejects(callTarget(intercomTarget(), 'hi'), e => /HTTP 401/.test(e.message) && /Access Token Invalid/.test(e.message));
  await assert.rejects(callTarget(intercomTarget({ token: '${CUSTOMER_UNSET_TOKEN_X}' }), 'hi'), /CUSTOMER_UNSET_TOKEN_X is not set/);
  await assert.rejects(callTarget({ type: 'intercom', baseUrl: ic.base }, 'hi'), /needs a token/);
});

test('zendesk: creates a user and conversation, posts the message and returns the business reply', async () => {
  zd.state.mode = 'reply';
  zd.state.requests = [];
  const answer = await callTarget(zendeskTarget(), 'Can I return shoes?');
  assert.equal(answer, 'You can return it within 30 days.');
  const [user, convo, post, ...polls] = zd.state.requests;
  const basic = `Basic ${Buffer.from('app_test_key:zendesk-test-secret-not-real').toString('base64')}`;
  assert.ok(zd.state.requests.every(r => r.headers.authorization === basic));
  assert.match(user.body.externalId, /^delomu-[0-9a-f-]{36}$/);
  assert.deepEqual(convo.body, { type: 'personal', participants: [{ userId: 'u1' }] });
  assert.deepEqual(post.body, { author: { type: 'user', userId: 'u1' }, content: { type: 'text', text: 'Can I return shoes?' } });
  assert.equal(polls.length, 2, 'the greeting sent before the message is not taken as the reply');
});

test('zendesk: no reply times out, and API errors carry the status', async () => {
  zd.state.mode = 'silent';
  await assert.rejects(callTarget(zendeskTarget({ timeoutMs: 150 }), 'hello?'), /Zendesk conversation conv1 did not reply within/);
  zd.state.mode = 'locked';
  await assert.rejects(callTarget(zendeskTarget(), 'hi'), e => /HTTP 423/.test(e.message) && /locked/.test(e.message));
  await assert.rejects(callTarget(zendeskTarget({ appId: 'nope' }), 'hi'), /HTTP 404/);
  await assert.rejects(callTarget(zendeskTarget({ secret: undefined }), 'hi'), /needs secret/);
});

test('zendesk: the base url comes from the subdomain', () => {
  assert.equal(zendeskBaseUrl({ subdomain: 'acme' }), 'https://acme.zendesk.com/sc');
  assert.equal(zendeskBaseUrl({ baseUrl: 'http://127.0.0.1:9/sc/' }), 'http://127.0.0.1:9/sc');
  assert.throws(() => zendeskBaseUrl({ subdomain: 'evil.com/x' }), /subdomain/);
  assert.throws(() => zendeskBaseUrl({}), /subdomain/);
});

test('checkTarget allows the help-desk types only with ${CUSTOMER_...} credentials', () => {
  const ok = target => checkTarget({ target });
  const code = (target, re) => assert.throws(() => ok(target), e => re.test(e.message));
  ok({ type: 'intercom', token: '${CUSTOMER_INTERCOM_TOKEN}' });
  ok({ type: 'zendesk', subdomain: 'acme', appId: 'app1', keyId: '${CUSTOMER_ZD_KEY}', secret: '${CUSTOMER_ZD_SECRET}' });
  ok({ type: 'zendesk', subdomain: 'acme', appId: '${CUSTOMER_ZD_APP}', keyId: '${CUSTOMER_ZD_KEY}', secret: '${CUSTOMER_ZD_SECRET}' });
  code({ type: 'intercom' }, /token is required/);
  code({ type: 'intercom', token: 'dG9rOmxpdGVyYWw=' }, /token must be an environment variable reference/);
  code({ type: 'intercom', token: 'Bearer ${CUSTOMER_INTERCOM_TOKEN}' }, /token must be an environment variable reference/);
  code({ type: 'intercom', token: '${HOME}' }, /CUSTOMER_/);
  code({ type: 'intercom', token: '${CUSTOMER_T}', baseUrl: 'file:///etc' }, /baseUrl must use http or https/);
  code({ type: 'zendesk', subdomain: 'acme', appId: 'app1', keyId: '${CUSTOMER_ZD_KEY}', secret: 'literal' }, /secret must be an environment variable reference/);
  code({ type: 'zendesk', subdomain: 'acme', appId: 'app1', keyId: '${OPERATOR_KEY}', secret: '${CUSTOMER_ZD_SECRET}' }, /keyId/);
  code({ type: 'zendesk', subdomain: 'acme', appId: '${OPERATOR_APP}', keyId: '${CUSTOMER_K}', secret: '${CUSTOMER_S}' }, /CUSTOMER_/);
  code({ type: 'zendesk', subdomain: 'acme.zendesk.com/x', appId: 'app1', keyId: '${CUSTOMER_K}', secret: '${CUSTOMER_S}' }, /subdomain/);
  code({ type: 'zendesk', subdomain: 'acme', keyId: '${CUSTOMER_K}', secret: '${CUSTOMER_S}' }, /appId/);
  code({ type: 'slack' }, /"http", "command", "intercom" or "zendesk"/);
  // A custom operator prefix applies to the new fields too.
  assert.throws(() => checkTarget({ target: { type: 'intercom', token: '${CUSTOMER_T}' } }, { envPrefix: 'TENANT_' }), /TENANT_/);
});

test('agent integration drafts may propose help-desk targets, with env-only secrets', () => {
  assert.deepEqual(validateTarget({ type: 'intercom', token: '${ACME_INTERCOM_TOKEN}' }), []);
  assert.deepEqual(validateTarget({ type: 'zendesk', subdomain: 'acme', appId: 'a', keyId: '${K}', secret: '${S}' }), []);
  assert.match(validateTarget({ type: 'intercom', token: 'abc' }).join(), /token must be one/);
  assert.match(validateTarget({ type: 'zendesk', keyId: '${K}', secret: '${S}' }).join(), /appId.*subdomain/);
});

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);

test('the New deployment form creates Intercom and Zendesk deployments and rejects literal secrets', async () => {
  const srv = await startServer();
  try {
    const o = seedOrg(srv.dataDir, { name: 'Acme', members: [{ email: 'eng@acme.test', role: 'engineer' }] });
    const page = await fetch(`${srv.base}/login`);
    const loginCsrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
    const login = await fetch(`${srv.base}/login`, {
      method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] },
      body: new URLSearchParams({ csrf: loginCsrf, api_key: o.keys['eng@acme.test'] }),
    });
    const cookie = cookiesOf(login).find(c => c.startsWith('delomu_session='));
    const org = `/orgs/${o.org.id}`;
    const form = await (await fetch(`${srv.base}${org}/new-deployment`, { headers: { cookie } })).text();
    for (const t of ['http', 'command', 'intercom', 'zendesk']) assert.match(form, new RegExp(`name="type" value="${t}"`));
    assert.match(form, /name="intercom_token"/);
    assert.match(form, /name="zendesk_secret"/);
    const csrf = /name="csrf" value="([^"]+)"/.exec(form)[1];
    const post = fields => fetch(`${srv.base}${org}/new-deployment`, {
      method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, pass: '90', ...fields }),
    });

    const literal = await post({ name: 'fin', type: 'intercom', intercom_token: 'dG9rOnJlYWw=' });
    assert.equal(literal.status, 400);
    const literalHtml = await literal.text();
    assert.match(literalHtml, /environment variable reference/);
    assert.match(literalHtml, /value="intercom" checked/, 'the form keeps the chosen connection');
    assert.equal((await post({ name: 'fin', type: 'intercom' })).status, 400);

    const fin = await post({ name: 'fin', type: 'intercom', intercom_token: '${CUSTOMER_INTERCOM_TOKEN}', intercom_contact: 'qa-bot' });
    assert.equal(fin.status, 303);
    const finConfig = JSON.parse(fs.readFileSync(path.join(srv.deploymentsRoot, o.org.id, 'fin', 'delomu.json'), 'utf8'));
    assert.deepEqual(finConfig.target, { type: 'intercom', token: '${CUSTOMER_INTERCOM_TOKEN}', contactExternalId: 'qa-bot' });

    assert.equal((await post({ name: 'zd', type: 'zendesk', zendesk_subdomain: 'acme', zendesk_app_id: 'app1' })).status, 400);
    const zdRes = await post({ name: 'zd', type: 'zendesk', zendesk_subdomain: 'acme.zendesk.com', zendesk_app_id: 'app1', zendesk_key_id: '${CUSTOMER_ZD_KEY_ID}', zendesk_secret: '${CUSTOMER_ZD_SECRET}' });
    assert.equal(zdRes.status, 303);
    const zdConfig = JSON.parse(fs.readFileSync(path.join(srv.deploymentsRoot, o.org.id, 'zd', 'delomu.json'), 'utf8'));
    assert.deepEqual(zdConfig.target, { type: 'zendesk', subdomain: 'acme', appId: 'app1', keyId: '${CUSTOMER_ZD_KEY_ID}', secret: '${CUSTOMER_ZD_SECRET}' });

    const settings = await (await fetch(`${srv.base}${org}/deployments/zd/settings`, { headers: { cookie } })).text();
    assert.match(settings, /Zendesk/);
    assert.match(settings, /\$\{CUSTOMER_ZD_SECRET\}/);
  } finally {
    await srv.close();
  }
});
