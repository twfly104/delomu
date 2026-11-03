import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { api, startServer, seedOrg, listen, close } from './v3-support.test.mjs';

const CLIENT_ID = 'delomu-test-client';
const CLIENT_SECRET = 'not-a-real-secret';

// A local OpenID provider: discovery, JWKS, and a token endpoint that checks client auth and PKCE.
// Tests mint the authorization code themselves with whatever ID token claims (or signer) they need.
async function fakeProvider() {
  const good = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const evil = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...good.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const codes = new Map();
  const tokenRequests = [];
  let issuer;

  const sign = (claims, { key = good.privateKey, alg = 'RS256', kid = 'k1' } = {}) => {
    const enc = v => Buffer.from(JSON.stringify(v)).toString('base64url');
    const input = `${enc({ alg, kid, typ: 'JWT' })}.${enc(claims)}`;
    const sig = alg === 'none' ? '' : crypto.sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
    return `${input}.${sig}`;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, issuer);
    const json = (status, v) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, token_endpoint_auth_methods_supported: ['client_secret_basic'] });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        tokenRequests.push({ form, authorization: req.headers.authorization });
        const expectedAuth = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`;
        if (req.headers.authorization !== expectedAuth) return json(401, { error: 'invalid_client' });
        const grant = codes.get(form.get('code'));
        codes.delete(form.get('code'));
        if (!grant || form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== grant.redirectUri) return json(400, { error: 'invalid_grant' });
        const challenge = crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url');
        if (challenge !== grant.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        return json(200, { access_token: 'at', token_type: 'Bearer', id_token: grant.idToken });
      });
      return;
    }
    json(404, { error: 'not_found' });
  });
  issuer = await listen(server);

  // Turns the authorization request Grapim sent into a code, as a real provider would after login.
  function authorize(location, { claims = {}, signer = {} } = {}) {
    const q = new URL(location).searchParams;
    assert.equal(q.get('response_type'), 'code');
    assert.equal(q.get('client_id'), CLIENT_ID);
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.match(q.get('scope'), /openid/);
    const t = Math.floor(Date.now() / 1000);
    const idToken = sign({ iss: issuer, aud: CLIENT_ID, sub: 'u-1', email: 'dana@one.test', email_verified: true, nonce: q.get('nonce'), iat: t, exp: t + 300, ...claims }, signer);
    const code = crypto.randomBytes(12).toString('hex');
    codes.set(code, { idToken, challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri') });
    return { code, state: q.get('state'), redirectUri: q.get('redirect_uri') };
  }

  return { get issuer() { return issuer; }, authorize, sign, evilKey: evil.privateKey, tokenRequests, close: () => close(server) };
}

let srv;
let idp;
let org;

before(async () => {
  idp = await fakeProvider();
  srv = await startServer({ env: { OIDC_SECRET: CLIENT_SECRET } });
  org = seedOrg(srv.dataDir, { name: 'One SSO', members: [{ email: 'owner@one.test', role: 'owner' }] });
  const put = await api(srv.base, 'PUT', `/v1/orgs/${org.org.id}/sso`, {
    key: org.keys['owner@one.test'],
    body: { issuer: idp.issuer, client_id: CLIENT_ID, client_secret_env: 'OIDC_SECRET', allowed_domains: ['One.Test'], default_role: 'reviewer' },
  });
  assert.equal(put.status, 200, put.text);
});

after(async () => {
  await srv.close();
  await idp.close();
});

const setCookies = res => res.headers.getSetCookie();
const cookieValue = (res, name) => setCookies(res).map(c => c.split(';')[0]).find(c => c.startsWith(`${name}=`))?.slice(name.length + 1);

// Runs the browser side of the login. Returns the callback response.
async function login({ claims, signer, tamper } = {}) {
  const start = await fetch(`${srv.base}/sso/start?org=${org.org.slug}`, { redirect: 'manual' });
  assert.equal(start.status, 303);
  const stateCookie = cookieValue(start, 'delomu_oidc_state');
  const grant = idp.authorize(start.headers.get('location'), { claims, signer });
  const params = new URLSearchParams({ code: grant.code, state: grant.state, ...tamper?.params });
  const cookie = tamper?.noCookie ? '' : `delomu_oidc_state=${stateCookie}`;
  const res = await fetch(`${srv.base}/sso/callback?${params}`, { redirect: 'manual', headers: { cookie } });
  return { res, text: await res.text(), grant, stateCookie };
}

test('SSO config: validation of issuer, domains and default role', async () => {
  const key = org.keys['owner@one.test'];
  const url = `/v1/orgs/${org.org.id}/sso`;
  const base = { issuer: idp.issuer, client_id: CLIENT_ID, allowed_domains: ['one.test'] };
  for (const [body, param] of [
    [{ ...base, issuer: 'http://idp.example.com' }, 'issuer'],
    [{ ...base, issuer: 'not a url' }, 'issuer'],
    [{ ...base, allowed_domains: [] }, 'allowed_domains'],
    [{ ...base, allowed_domains: ['bad domain'] }, 'allowed_domains'],
    [{ ...base, default_role: 'owner' }, 'default_role'],
    [{ ...base, client_secret_env: 'lower-case' }, 'client_secret_env'],
    [{ ...base, client_id: '' }, 'client_id'],
  ]) {
    const r = await api(srv.base, 'PUT', url, { key, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.param, param);
  }
  const got = await api(srv.base, 'GET', url, { key });
  assert.deepEqual(got.json.allowed_domains, ['one.test']);
  assert.equal(got.json.client_secret_env, 'OIDC_SECRET');
  assert.ok(!got.text.includes(CLIENT_SECRET));
});

test('SSO login: code + PKCE + verified ID token gives a session and a just-in-time membership', async () => {
  const { res } = await login();
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');
  const session = setCookies(res).find(c => c.startsWith('delomu_session='));
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);
  assert.doesNotMatch(session, /Secure/, 'plain http in tests, so no Secure flag');

  // PKCE: the verifier went to the token endpoint and hashed to the challenge (the provider checked it).
  const last = idp.tokenRequests.at(-1);
  assert.match(last.form.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(last.form.get('client_secret'), null, 'secret goes in the Basic header, not the body');

  const cookie = session.split(';')[0];
  const home = await fetch(`${srv.base}/`, { headers: { cookie } });
  assert.equal(home.status, 200);
  assert.match(await home.text(), /One SSO/);

  const members = await api(srv.base, 'GET', `/v1/orgs/${org.org.id}/members`, { key: org.keys['owner@one.test'] });
  const dana = members.json.data.filter(m => m.email === 'dana@one.test');
  assert.equal(dana.length, 1);
  assert.equal(dana[0].role, 'reviewer');

  // A second login reuses the membership.
  assert.equal((await login({ claims: { email: 'DANA@one.test' } })).res.status, 303);
  const again = await api(srv.base, 'GET', `/v1/orgs/${org.org.id}/members`, { key: org.keys['owner@one.test'] });
  assert.equal(again.json.data.filter(m => m.email === 'dana@one.test').length, 1);

  const events = (await api(srv.base, 'GET', `/v1/orgs/${org.org.id}/audit_events?limit=100`, { key: org.keys['owner@one.test'] })).json.data;
  assert.ok(events.some(e => e.action === 'user.login' && e.target === 'dana@one.test' && e.detail.via === 'sso'));
  assert.equal(events.filter(e => e.action === 'member.add' && e.detail.via === 'sso-jit').length, 1);
});

const failures = [
  ['bad signature', { signer: { key: 'evil' } }, /signature is invalid/],
  ['wrong audience', { claims: { aud: 'someone-else' } }, /audience/],
  ['multiple audiences without azp', { claims: { aud: [CLIENT_ID, 'other'] } }, /authorized party/],
  ['expired token', { claims: { exp: Math.floor(Date.now() / 1000) - 3600 } }, /expired/],
  ['wrong nonce', { claims: { nonce: 'attacker-nonce' } }, /nonce/],
  ['wrong issuer', { claims: { iss: 'https://evil.example.com' } }, /issuer/],
  ['email domain not allowed', { claims: { email: 'mallory@evil.test' } }, /domain is not allowed/],
  ['unverified email', { claims: { email_verified: false } }, /not verified/],
  ['unsigned token', { signer: { alg: 'none' } }, /RS256/],
  ['unknown key id', { signer: { kid: 'k9' } }, /unknown key/],
];

for (const [name, opts, message] of failures) {
  test(`SSO login is refused: ${name}`, async () => {
    const signer = opts.signer?.key === 'evil' ? { ...opts.signer, key: idp.evilKey } : opts.signer;
    const { res, text } = await login({ claims: opts.claims, signer });
    assert.equal(res.status, 400);
    assert.match(text, message);
    assert.ok(!setCookies(res).some(c => c.startsWith('delomu_session=') && !c.startsWith('delomu_session=;')));
  });
}

test('SSO failures are audited, and state is single-use and bound to the browser', async () => {
  const events = (await api(srv.base, 'GET', `/v1/orgs/${org.org.id}/audit_events?limit=100`, { key: org.keys['owner@one.test'] })).json.data;
  assert.ok(events.some(e => e.action === 'user.login_failed' && /signature/.test(e.detail.reason)));

  // Replaying a finished callback fails: the state was consumed.
  const first = await login();
  assert.equal(first.res.status, 303);
  const replay = await fetch(`${srv.base}/sso/callback?code=${first.grant.code}&state=${first.grant.state}`, { redirect: 'manual', headers: { cookie: `delomu_oidc_state=${first.stateCookie}` } });
  assert.equal(replay.status, 400);
  assert.match(await replay.text(), /already used/);

  // A callback without the state cookie (login CSRF, or another browser) is refused.
  assert.equal((await login({ tamper: { noCookie: true } })).res.status, 400);
  // A provider error is shown, escaped.
  const err = await fetch(`${srv.base}/sso/callback?error=${encodeURIComponent('<script>x</script>')}`);
  assert.equal(err.status, 400);
  const body = await err.text();
  assert.ok(!body.includes('<script>x'));
  assert.ok(body.includes('&lt;script&gt;'));
  // Unknown orgs do not start a flow.
  assert.equal((await fetch(`${srv.base}/sso/start?org=nope`, { redirect: 'manual' })).status, 404);
});

test('SSO fails closed when the client secret env var is missing', async () => {
  const s = await startServer({ env: {} });
  try {
    const o = seedOrg(s.dataDir, { name: 'No Secret', members: [{ email: 'owner@one.test', role: 'owner' }] });
    await api(s.base, 'PUT', `/v1/orgs/${o.org.id}/sso`, { key: o.keys['owner@one.test'], body: { issuer: idp.issuer, client_id: CLIENT_ID, client_secret_env: 'OIDC_SECRET', allowed_domains: ['one.test'] } });
    const start = await fetch(`${s.base}/sso/start?org=${o.org.slug}`, { redirect: 'manual' });
    const grant = idp.authorize(start.headers.get('location'));
    const res = await fetch(`${s.base}/sso/callback?code=${grant.code}&state=${grant.state}`, { headers: { cookie: `delomu_oidc_state=${cookieValue(start, 'delomu_oidc_state')}` } });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /OIDC_SECRET is not set/);
  } finally {
    await s.close();
  }
});

test('behind https, cookies are Secure and the redirect URI uses the public URL', async () => {
  const s = await startServer({ publicUrl: 'https://delomu.customer.example/', env: { OIDC_SECRET: CLIENT_SECRET, DELOMU_ALLOW_PRIVATE_TARGETS: '1' } });
  try {
    const o = seedOrg(s.dataDir, { name: 'Https Co', members: [{ email: 'owner@one.test', role: 'owner' }] });
    await api(s.base, 'PUT', `/v1/orgs/${o.org.id}/sso`, { key: o.keys['owner@one.test'], body: { issuer: idp.issuer, client_id: CLIENT_ID, allowed_domains: ['one.test'] } });
    const start = await fetch(`${s.base}/sso/start?org=${o.org.slug}`, { redirect: 'manual' });
    assert.match(setCookies(start).find(c => c.startsWith('delomu_oidc_state=')), /; Secure/);
    assert.equal(new URL(start.headers.get('location')).searchParams.get('redirect_uri'), 'https://delomu.customer.example/sso/callback');
    const page = await fetch(`${s.base}/login`);
    assert.match(setCookies(page)[0], /; Secure/);
  } finally {
    await s.close();
  }
});

test('SSO start: an org without SSO looks like an unknown org; an unreachable provider is a clear 502', async () => {
  const plain = seedOrg(srv.dataDir, { name: 'No SSO Here', members: [{ email: 'owner@plain.test', role: 'owner' }] });
  const unknown = await fetch(`${srv.base}/sso/start?org=nope`, { redirect: 'manual' });
  const noSso = await fetch(`${srv.base}/sso/start?org=${plain.org.slug}`, { redirect: 'manual' });
  assert.equal(noSso.status, 404);
  assert.equal(await noSso.text(), await unknown.text());

  const down = seedOrg(srv.dataDir, { name: 'Idp Down', members: [{ email: 'owner@down.test', role: 'owner' }] });
  const key = down.keys['owner@down.test'];
  const put = await api(srv.base, 'PUT', `/v1/orgs/${down.org.id}/sso`, { key, body: { issuer: 'http://127.0.0.1:1', client_id: CLIENT_ID, allowed_domains: ['down.test'] } });
  assert.equal(put.status, 200, put.text);
  const res = await fetch(`${srv.base}/sso/start?org=${down.org.slug}`, { redirect: 'manual' });
  assert.equal(res.status, 502);
  assert.match(await res.text(), /could not reach the identity provider/);
  const events = (await api(srv.base, 'GET', `/v1/orgs/${down.org.id}/audit_events`, { key })).json.data;
  assert.ok(events.some(e => e.action === 'user.login_failed'));
});
