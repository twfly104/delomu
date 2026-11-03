// Links a person outside Grapim opens without signing in: a client's sign-off page for one check, and (later)
// an agent's public page. Only a hash of each token is stored, so a link is shown once when it is made; a
// link can expire and can be revoked.

import crypto from 'node:crypto';
import { newId } from './db.mjs';
import { randomToken } from './sessions.mjs';

export const SIGNOFF_TTL_MS = 30 * 86400_000;
const sha256 = text => crypto.createHash('sha256').update(String(text)).digest('hex');

// purpose: 'signoff' | 'verified'. subject: what the link shows (a scan id for a sign-off). ttlMs null = no expiry.
export function createShare(db, { orgId, deployment, purpose, subject = '', createdBy }, now = new Date(), ttlMs = SIGNOFF_TTL_MS) {
  const token = randomToken();
  const share = {
    id: newId('share'), org_id: orgId, deployment, purpose, subject, created_by: createdBy, created_at: now.toISOString(),
    expires_at: ttlMs === null ? null : new Date(now.getTime() + ttlMs).toISOString(),
  };
  db.prepare('INSERT INTO share_links (id, org_id, deployment, purpose, subject, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(share.id, orgId, deployment, purpose, subject, sha256(token), createdBy, share.created_at, share.expires_at);
  return { token, share };
}

// The live link for a token, or null when it is unknown, revoked, expired or for another purpose.
export function findShare(db, token, purpose, now = new Date()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db.prepare('SELECT * FROM share_links WHERE token_hash = ? AND purpose = ?').get(sha256(token), purpose);
  if (!row || row.revoked_at || (row.expires_at && row.expires_at <= now.toISOString())) return null;
  return row;
}

export const activeShares = (db, orgId, deployment, purpose, now = new Date()) => db.prepare(
  'SELECT * FROM share_links WHERE org_id = ? AND deployment = ? AND purpose = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC',
).all(orgId, deployment, purpose, now.toISOString());

export function revokeShares(db, orgId, deployment, purpose, now = new Date()) {
  return db.prepare('UPDATE share_links SET revoked_at = ? WHERE org_id = ? AND deployment = ? AND purpose = ? AND revoked_at IS NULL')
    .run(now.toISOString(), orgId, deployment, purpose).changes;
}
