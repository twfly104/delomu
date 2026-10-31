// API keys ("dk_..."). The full key is returned once at creation; the database keeps only an
// HMAC-SHA256 of it under a server-side pepper (DELOMU_KEY_PEPPER), plus a short display prefix.
// A key acts as the user who created it, in that org, limited to its scopes when it has any.

import crypto from 'node:crypto';
import { newId, parseJson } from './db.mjs';
import { invalid } from './http.mjs';
import { PERMISSIONS } from './rbac.mjs';

export const KEY_PREFIX = 'dk_';
const KEY_FORMAT = /^dk_[A-Za-z0-9_-]{43}$/;
const MIN_PEPPER = 16;

export function checkPepper(pepper) {
  if (typeof pepper !== 'string' || pepper.length < MIN_PEPPER) {
    throw new Error(`DELOMU_KEY_PEPPER must be set to a random string of at least ${MIN_PEPPER} characters`);
  }
  return pepper;
}

export const hashKey = (pepper, secret) => crypto.createHmac('sha256', pepper).update(secret).digest('hex');

// undefined/null means "everything the user's role allows"; otherwise a non-empty list of known permissions.
export function checkScopes(scopes) {
  if (scopes === undefined || scopes === null) return null;
  if (!Array.isArray(scopes) || !scopes.length) throw invalid('scopes must be a non-empty array of permissions.', 'scopes');
  for (const s of scopes) {
    if (!PERMISSIONS.includes(s)) throw invalid(`Unknown scope "${String(s).slice(0, 40)}". Valid scopes: ${PERMISSIONS.join(', ')}.`, 'scopes');
  }
  return [...new Set(scopes)];
}

const keyObject = r => ({
  object: 'api_key', id: r.id, name: r.name, prefix: r.prefix, user_id: r.user_id, scopes: parseJson(r.scopes, null),
  created_at: r.created_at, last_used_at: r.last_used_at ?? null, revoked_at: r.revoked_at ?? null,
});

export function createApiKey(db, { orgId, userId, name, scopes }, pepper, now = new Date()) {
  const label = String(name ?? '').trim();
  if (!label || label.length > 100) throw invalid('name must be 1 to 100 characters.', 'name');
  const secret = KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
  const row = {
    id: newId('key'), org_id: orgId, user_id: userId, name: label, prefix: secret.slice(0, 11),
    hash: hashKey(checkPepper(pepper), secret), scopes: scopes ? JSON.stringify(scopes) : null, created_at: now.toISOString(),
  };
  db.prepare('INSERT INTO api_keys (id, org_id, user_id, name, prefix, hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, row.org_id, row.user_id, row.name, row.prefix, row.hash, row.scopes, row.created_at);
  return { key: keyObject(row), secret };
}

// Returns the key row for a valid, unrevoked key and records its use; null otherwise.
export function authenticateKey(db, secret, pepper, now = new Date()) {
  if (typeof secret !== 'string' || !KEY_FORMAT.test(secret)) return null;
  const row = db.prepare('SELECT * FROM api_keys WHERE hash = ?').get(hashKey(pepper, secret));
  if (!row || row.revoked_at) return null;
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now.toISOString(), row.id);
  return { ...keyObject(row), org_id: row.org_id };
}

export const listKeys = (db, orgId) =>
  db.prepare('SELECT * FROM api_keys WHERE org_id = ? ORDER BY created_at DESC, id').all(orgId).map(keyObject);

export function revokeKey(db, orgId, id, now = new Date()) {
  const row = db.prepare('SELECT * FROM api_keys WHERE org_id = ? AND id = ?').get(orgId, String(id));
  if (!row) return null;
  if (!row.revoked_at) {
    row.revoked_at = now.toISOString();
    db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ?').run(row.revoked_at, row.id);
  }
  db.prepare('DELETE FROM sessions WHERE api_key_id = ?').run(row.id);
  return keyObject(row);
}
