// Browser sessions for the web UI. The cookie carries a random token; the database stores only its
// SHA-256, so a copied database cannot be used to hijack sessions. Each session has its own CSRF token.

import crypto from 'node:crypto';
import { newId, parseJson } from './db.mjs';

export const SESSION_COOKIE = 'delomu_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

// apiKeyId: the key used to sign in, if any; revoking that key ends the session (see keys.mjs revokeKey).
export function createSession(db, { userId, orgId, scopes = null, apiKeyId = null }, now = new Date(), ttlMs = SESSION_TTL_MS) {
  const token = randomToken();
  const csrf = randomToken();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  db.prepare('INSERT INTO sessions (id, token_hash, user_id, org_id, csrf_token, scopes, created_at, expires_at, api_key_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId('sess'), sha256(token), userId, orgId, csrf, scopes ? JSON.stringify(scopes) : null, now.toISOString(), expiresAt, apiKeyId);
  return { token, csrf, expiresAt };
}

// Returns { id, userId, orgId, csrf, scopes } for a live session, or null. Expired rows are removed.
export function getSession(db, token, now = new Date()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!row) return null;
  if (row.expires_at <= now.toISOString()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }
  return { id: row.id, userId: row.user_id, orgId: row.org_id, csrf: row.csrf_token, scopes: parseJson(row.scopes, null) };
}

export function deleteSession(db, token) {
  if (typeof token === 'string') db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

// Constant-time comparison for CSRF tokens and similar secrets.
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
