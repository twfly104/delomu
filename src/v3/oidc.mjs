// OpenID Connect relying party, built on node:crypto only: discovery, PKCE (S256), the authorization
// URL, the code-for-token exchange and RS256 ID token verification against the provider's JWKS.
// Session handling and org rules live in sso.mjs; this file only speaks the protocol.

import crypto from 'node:crypto';

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const JWKS_REFRESH_MS = 60 * 1000;
const TIMEOUT_MS = 10_000;
const CLOCK_SKEW_SEC = 60;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class OidcError extends Error {}

const b64url = buf => Buffer.from(buf).toString('base64url');

// Providers must use https; plain http is accepted only for a provider on this machine (development, tests).
export function checkProviderUrl(value, what = 'issuer') {
  let url;
  try { url = new URL(value); } catch { throw new OidcError(`${what} is not a valid URL`); }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) return url;
  throw new OidcError(`${what} must use https`);
}

export function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

export function createOidcClient({ fetch = globalThis.fetch } = {}) {
  const discovery = new Map();
  const jwks = new Map();

  async function getJson(url, init = {}) {
    let res;
    try {
      res = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new OidcError(`could not reach the identity provider (${e.message})`);
    }
    const text = await res.text();
    if (!res.ok) throw new OidcError(`identity provider answered HTTP ${res.status}`);
    try { return JSON.parse(text); } catch { throw new OidcError('identity provider sent invalid JSON'); }
  }

  async function discover(issuer) {
    const hit = discovery.get(issuer);
    if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit.doc;
    checkProviderUrl(issuer);
    const doc = await getJson(`${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`);
    if (doc.issuer !== issuer) throw new OidcError('discovery document issuer does not match the configured issuer');
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
      if (typeof doc[k] !== 'string') throw new OidcError(`discovery document has no ${k}`);
      checkProviderUrl(doc[k], k);
    }
    discovery.set(issuer, { doc, at: Date.now() });
    return doc;
  }

  function authorizationUrl(doc, { clientId, redirectUri, state, nonce, challenge }) {
    const url = new URL(doc.authorization_endpoint);
    const params = { response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256' };
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return url.href;
  }

  // client_secret_basic is the spec default; client_secret_post when that is all the provider supports.
  async function exchangeCode(doc, { code, redirectUri, clientId, clientSecret, verifier }) {
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
    const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
    const methods = doc.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
    if (!clientSecret) form.set('client_id', clientId);
    else if (methods.includes('client_secret_basic')) {
      headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`;
    } else {
      form.set('client_id', clientId);
      form.set('client_secret', clientSecret);
    }
    const tokens = await getJson(doc.token_endpoint, { method: 'POST', headers, body: form.toString() });
    if (typeof tokens.id_token !== 'string') throw new OidcError('token response has no id_token');
    return tokens.id_token;
  }

  async function signingKey(jwksUri, kid) {
    let entry = jwks.get(jwksUri);
    const find = () => entry?.keys.find(k => k.kid === kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'));
    if (!find() && (!entry || Date.now() - entry.at > JWKS_REFRESH_MS)) {
      const set = await getJson(jwksUri);
      if (!Array.isArray(set.keys)) throw new OidcError('JWKS has no keys');
      entry = { keys: set.keys, at: Date.now() };
      jwks.set(jwksUri, entry);
    }
    const jwk = find();
    if (!jwk) throw new OidcError('ID token was signed with an unknown key');
    return crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
  }

  // Returns the verified claims. Checks: RS256 signature from the JWKS, iss, aud/azp, exp, iat, nonce.
  async function verifyIdToken(idToken, { doc, issuer, clientId, nonce, now = new Date() }) {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new OidcError('ID token is not a JWT');
    let header;
    let claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new OidcError('ID token is malformed');
    }
    if (header.alg !== 'RS256') throw new OidcError('ID token must be signed with RS256');
    const key = await signingKey(doc.jwks_uri, header.kid);
    const valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!valid) throw new OidcError('ID token signature is invalid');

    const t = Math.floor(now.getTime() / 1000);
    if (claims.iss !== issuer) throw new OidcError('ID token issuer does not match');
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(clientId)) throw new OidcError('ID token audience does not match');
    if (aud.length > 1 && claims.azp !== clientId) throw new OidcError('ID token authorized party does not match');
    if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC < t) throw new OidcError('ID token has expired');
    if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_SEC > t) throw new OidcError('ID token was issued in the future');
    if (typeof claims.nonce !== 'string' || claims.nonce !== nonce) throw new OidcError('ID token nonce does not match');
    return claims;
  }

  return { discover, authorizationUrl, exchangeCode, verifyIdToken };
}
