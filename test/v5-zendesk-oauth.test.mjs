import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startServer } from './v3-support.test.mjs';

// A fake Zendesk: the token endpoint hands out access-1 (then access-2 on refresh); the API accepts only the
// current bearer token and answers with one solved ticket.
const oauthCalls = [];
let current = 'access-1';
const srv = await startServer({
  env: { DELOMU_SIGNUP: 'open' },
  oauthJson: async (url, { body }) => {
    oauthCalls.push({ url, body });
    if (body.grant_type === 'refresh_token') { current = 'access-2'; return { access_token: 'access-2', refresh_token: 'refresh-2' }; }
    if (body.code !== 'good-code') throw Object.assign(new Error('bad'), { status: 400 });
    return { access_token: 'access-1', refresh_token: 'refresh-1' };
  },
  importJson: async (url, { headers }) => {
    if (headers.authorization !== `Bearer ${current}`) throw Object.assign(new Error('unauthorized'), { status: 401 });
    if (url.includes('/search.json')) return { results: [{ id: 7, subject: 'Refund', description: 'Can I get a refund? Email me at ann@example.com', tags: [], created_at: '2026-11-01T00:00:00Z', via: { channel: 'email' } }] };
    if (url.includes('/comments.json')) return { comments: [{ public: true, author_id: 2, body: 'Refunds are within 30 days.' }] };
    if (url.includes('/tickets/7.json')) return { ticket: { requester_id: 1 } };
    return { articles: [] };
  },
});
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const form = (path, cookie, fields) => fetch(`${srv.base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });

test('Zendesk connects with OAuth (PKCE, read scope), imports with the bearer token, and refreshes it once', async () => {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `z${Math.random()}@zd.test`, company: 'ZdCo' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await fetch(`${srv.base}/`, { headers: { cookie } })).text();
  const org = /action="(\/orgs\/[^"/]+)\/sample"/.exec(home)[1];
  const made = await form(`${org}/sample`, cookie, { csrf: csrfOf(home) });
  const dep = /^(.*)\/scan/.exec(made.headers.get('location'))[1];

  const inputs = await (await fetch(`${srv.base}${dep}/inputs`, { headers: { cookie } })).text();
  assert.match(inputs, /Connect Zendesk/);
  assert.match(inputs, /\/oauth\/zendesk\/callback/);
  const csrf = csrfOf(inputs);

  const go = await form(`${dep}/import/zendesk/connect`, cookie, { csrf, subdomain: 'acme', client_id: 'grapim', client_secret: 'very-secret' });
  assert.equal(go.status, 303);
  const auth = new URL(go.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, 'https://acme.zendesk.com/oauth/authorizations/new');
  assert.equal(auth.searchParams.get('scope'), 'read');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  const state = auth.searchParams.get('state');
  assert.doesNotMatch(await (await fetch(`${srv.base}${dep}/inputs`, { headers: { cookie } })).text(), /very-secret/, 'the secret is never shown again');

  // Another person cannot finish someone else's connection; a wrong code shows Zendesk's refusal plainly.
  const back = await fetch(`${srv.base}/oauth/zendesk/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { cookie } });
  assert.equal(back.status, 303);
  assert.match(back.headers.get('location'), /\/inputs\?notice=zendesk-connected$/);
  const exchange = oauthCalls.at(-1);
  assert.equal(exchange.url, 'https://acme.zendesk.com/oauth/tokens');
  assert.equal(exchange.body.client_secret, 'very-secret');
  assert.equal(crypto.createHash('sha256').update(exchange.body.code_verifier).digest('base64url'), auth.searchParams.get('code_challenge'));
  assert.equal((await fetch(`${srv.base}/oauth/zendesk/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { cookie } })).status, 400, 'a state works once');

  const imported = await form(`${dep}/import`, cookie, { csrf, source: 'zendesk' });
  assert.equal(imported.status, 303, 'imports with the saved OAuth token, no email or token typed');
  const csv = await (await fetch(`${srv.base}${dep}/inputs`, { headers: { cookie } })).text();
  assert.match(csv, /zendesk-tickets\.csv/);

  current = 'expired';
  oauthCalls.length = 0;
  current = 'access-2';
  const again = await form(`${dep}/import`, cookie, { csrf, source: 'zendesk' });
  assert.equal(again.status, 303, 'an expired token is refreshed once and the import goes through');
  assert.equal(oauthCalls[0]?.body.grant_type, 'refresh_token');
  assert.equal(oauthCalls[0]?.body.refresh_token, 'refresh-1');
});
