// Per-org SSO: the stored OIDC configuration (the client secret stays in an environment variable,
// only its name is stored), the login start (state, nonce, PKCE kept server side for 10 minutes)
// and the callback that verifies the ID token, checks the email domain and adds the user just in time.

import crypto from 'node:crypto';
import { parseJson } from './db.mjs';
import { invalid } from './http.mjs';
import { addMember, getMember, upsertUser, checkRole } from './accounts.mjs';
import { checkProviderUrl, OidcError, pkcePair } from './oidc.mjs';
import { randomToken } from './sessions.mjs';

export const LOGIN_TTL_MS = 10 * 60 * 1000;
export const STATE_COOKIE = 'delomu_oidc_state';

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');

export function checkOidcConfig(body) {
  const issuer = String(body.issuer ?? '');
  try { checkProviderUrl(issuer); } catch (e) { throw invalid(e.message, 'issuer'); }
  const clientId = String(body.client_id ?? '').trim();
  if (!clientId || clientId.length > 200) throw invalid('client_id must be 1 to 200 characters.', 'client_id');
  const secretEnv = body.client_secret_env ?? null;
  if (secretEnv !== null && !ENV_NAME.test(secretEnv)) throw invalid('client_secret_env must be an environment variable name like OKTA_CLIENT_SECRET.', 'client_secret_env');
  const domains = body.allowed_domains;
  if (!Array.isArray(domains) || !domains.length || domains.length > 50) throw invalid('allowed_domains must list 1 to 50 email domains.', 'allowed_domains');
  const allowed = domains.map(d => String(d).trim().toLowerCase());
  for (const d of allowed) if (!DOMAIN.test(d)) throw invalid(`"${d.slice(0, 60)}" is not a domain name.`, 'allowed_domains');
  const role = checkRole(body.default_role ?? 'viewer', 'default_role');
  if (role === 'owner') throw invalid('default_role cannot be owner.', 'default_role');
  return { issuer, client_id: clientId, client_secret_env: secretEnv, allowed_domains: [...new Set(allowed)], default_role: role };
}

export function setOidcConfig(db, orgId, config, now = new Date()) {
  db.prepare(`INSERT INTO oidc_configs (org_id, issuer, client_id, client_secret_env, allowed_domains, default_role, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (org_id) DO UPDATE SET issuer = excluded.issuer, client_id = excluded.client_id,
                client_secret_env = excluded.client_secret_env, allowed_domains = excluded.allowed_domains,
                default_role = excluded.default_role, updated_at = excluded.updated_at`)
    .run(orgId, config.issuer, config.client_id, config.client_secret_env, JSON.stringify(config.allowed_domains), config.default_role, now.toISOString());
  return getOidcConfig(db, orgId);
}

export function getOidcConfig(db, orgId) {
  const r = db.prepare('SELECT * FROM oidc_configs WHERE org_id = ?').get(orgId);
  return r && {
    object: 'sso_config', issuer: r.issuer, client_id: r.client_id, client_secret_env: r.client_secret_env,
    allowed_domains: parseJson(r.allowed_domains, []), default_role: r.default_role, updated_at: r.updated_at,
  };
}

// Returns { url, state }. The caller puts state in a short-lived cookie to bind the flow to this browser.
export async function startLogin(db, oidc, { orgId, redirectUri }, now = new Date()) {
  const config = getOidcConfig(db, orgId);
  if (!config) throw new OidcError('single sign-on is not set up for this organization');
  const doc = await oidc.discover(config.issuer);
  const state = randomToken();
  const nonce = randomToken();
  const { verifier, challenge } = pkcePair();
  db.prepare('DELETE FROM oidc_logins WHERE expires_at < ?').run(now.toISOString());
  db.prepare('INSERT INTO oidc_logins (state_hash, org_id, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(state), orgId, nonce, verifier, new Date(now.getTime() + LOGIN_TTL_MS).toISOString());
  return { url: oidc.authorizationUrl(doc, { clientId: config.client_id, redirectUri, state, nonce, challenge }), state };
}

// Returns { orgId, user, member, created }. The login row is consumed first, so a state works only once.
export async function finishLogin(db, oidc, { state, code, redirectUri, env = process.env }, now = new Date()) {
  if (typeof state !== 'string' || typeof code !== 'string' || !state || !code) throw new OidcError('the sign-in response is missing code or state');
  const login = db.prepare('SELECT * FROM oidc_logins WHERE state_hash = ?').get(sha256(state));
  if (!login) throw new OidcError('this sign-in link was already used or is unknown');
  db.prepare('DELETE FROM oidc_logins WHERE state_hash = ?').run(login.state_hash);
  try {
    return await completeLogin(db, oidc, login, { code, redirectUri, env }, now);
  } catch (e) {
    e.orgId = login.org_id; // lets the caller record the failure in the right org's audit log
    throw e;
  }
}

async function completeLogin(db, oidc, login, { code, redirectUri, env }, now) {
  if (login.expires_at < now.toISOString()) throw new OidcError('this sign-in attempt expired; start again');
  const config = getOidcConfig(db, login.org_id);
  if (!config) throw new OidcError('single sign-on is not set up for this organization');
  let clientSecret;
  if (config.client_secret_env) {
    clientSecret = env[config.client_secret_env];
    if (!clientSecret) throw new OidcError(`single sign-on is misconfigured: ${config.client_secret_env} is not set on the server`);
  }
  const doc = await oidc.discover(config.issuer);
  const idToken = await oidc.exchangeCode(doc, { code, redirectUri, clientId: config.client_id, clientSecret, verifier: login.code_verifier });
  const claims = await oidc.verifyIdToken(idToken, { doc, issuer: config.issuer, clientId: config.client_id, nonce: login.nonce, now });

  if (typeof claims.email !== 'string') throw new OidcError('the identity provider did not share an email address');
  if (claims.email_verified === false) throw new OidcError('the email address is not verified at the identity provider');
  const email = claims.email.trim().toLowerCase();
  if (!config.allowed_domains.includes(email.split('@').pop())) throw new OidcError('this email domain is not allowed for this organization');

  const user = upsertUser(db, email, now);
  const existing = getMember(db, login.org_id, user.id);
  const member = existing ?? addMember(db, login.org_id, { email, role: config.default_role }, null, now);
  return { orgId: login.org_id, user, member, created: !existing };
}
