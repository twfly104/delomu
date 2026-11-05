// Sign-in by email link: a one-time link, valid 15 minutes, sent through Resend when the operator sets
// RESEND_API_KEY and GRAPIM_EMAIL_FROM. Only a hash of the link's secret is stored, and each link works once.
import crypto from 'node:crypto';
import { randomToken } from './sessions.mjs';

export const LOGIN_LINK_TTL_MS = 15 * 60 * 1000;
const hash = secret => crypto.createHash('sha256').update(String(secret)).digest('hex');

// Returns the secret to put in the link, or null when no user has this email.
export function createLoginLink(db, email, now = new Date()) {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user) return null;
  const secret = randomToken();
  db.prepare('INSERT INTO login_links (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(hash(secret), user.id, now.toISOString(), new Date(now.getTime() + LOGIN_LINK_TTL_MS).toISOString());
  return secret;
}

// Uses a link once. Returns { userId, email, orgId } for its user's first organization, or null.
export function useLoginLink(db, secret, now = new Date()) {
  const row = db.prepare('SELECT token_hash, user_id, expires_at, used_at FROM login_links WHERE token_hash = ?').get(hash(secret));
  if (!row || row.used_at || row.expires_at < now.toISOString()) return null;
  const done = db.prepare('UPDATE login_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL').run(now.toISOString(), row.token_hash);
  if (!done.changes) return null;
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(row.user_id);
  const member = db.prepare('SELECT org_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1').get(row.user_id);
  if (!user || !member) return null;
  return { userId: user.id, email: user.email, orgId: member.org_id };
}

// Sends the link. send: (message) => Promise, injectable for tests; defaults to Resend's API.
export async function sendLoginEmail({ apiKey, from }, { to, link }, send) {
  const message = {
    from, to: [to], subject: 'Your Grapim sign-in link',
    text: `Sign in to Grapim:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
  };
  if (send) return send(message);
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(message) });
  if (!res.ok) throw new Error(`email provider answered ${res.status}`);
}
