// The client's own record across AI vendors. A client's reviewer who accepts an agent on a sign-off link can keep
// the record under their work email; every later sign-off with the same email, from any vendor using Grapim, joins
// the same private page. A single vendor's "share the report" button cannot do this: it only ever shows that
// vendor's agent. The page survives the 30-day sign-off links because each entry keeps a snapshot of the decision.
//
// Access is by a secret link: only its hash is stored. The link is emailed to the address given; it is shown on
// screen only when the book is new (it then holds nothing but the record the person just signed), so typing
// someone else's email never reveals their records.

import crypto from 'node:crypto';

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const emailHash = email => sha256(`client-book:${String(email).trim().toLowerCase()}`);
const newToken = () => crypto.randomBytes(24).toString('base64url');
const newId = p => `${p}_${crypto.randomBytes(8).toString('hex')}`;

export const validEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e ?? '').trim()) && String(e).length <= 254;

// entry: { shareId, vendor, client, agent, decision, reviewer, decidedAt, rules, kept, broken, highBroken }.
// Returns { token, isNew }. A new book gets a link. An existing book gets a fresh link (the old one stops working)
// only when rotate is set, i.e. when the new link can be emailed; otherwise token is null and the old link stays.
export function addToBook(db, email, entry, now = new Date(), { rotate = false } = {}) {
  const hash = emailHash(email);
  let token = newToken();
  let book = db.prepare('SELECT * FROM client_books WHERE email_hash = ?').get(hash);
  const isNew = !book;
  if (isNew) {
    book = { id: newId('book') };
    db.prepare('INSERT INTO client_books (id, email_hash, token_hash, created_at) VALUES (?, ?, ?, ?)').run(book.id, hash, sha256(token), now.toISOString());
  } else if (rotate) {
    db.prepare('UPDATE client_books SET token_hash = ? WHERE id = ?').run(sha256(token), book.id);
  } else {
    token = null;
  }
  db.prepare(`INSERT INTO client_book_entries (id, book_id, share_id, vendor, client, agent, decision, reviewer, decided_at, rules, kept, broken, high_broken, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (book_id, share_id) DO NOTHING`)
    .run(newId('entry'), book.id, entry.shareId, String(entry.vendor).slice(0, 120), String(entry.client ?? '').slice(0, 120), String(entry.agent).slice(0, 120),
      entry.decision, String(entry.reviewer).slice(0, 120), entry.decidedAt, entry.rules | 0, entry.kept | 0, entry.broken | 0, entry.highBroken | 0, now.toISOString());
  return { token, isNew };
}

// The book a link opens, with its entries newest first, or null.
export function openBook(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const book = db.prepare('SELECT * FROM client_books WHERE token_hash = ?').get(sha256(token));
  if (!book) return null;
  const entries = db.prepare('SELECT * FROM client_book_entries WHERE book_id = ? ORDER BY decided_at DESC').all(book.id);
  return { book, entries };
}

export async function sendBookEmail({ apiKey, from }, { to, link, vendor }, send) {
  const message = {
    from, to: [to], subject: 'Your AI vendors’ policy records',
    text: `You signed off ${vendor}'s AI agent on Grapim. Every AI vendor record you sign with this email is kept on one private page:\n\n${link}\n\nKeep this link private; anyone with it can read the page. A newer email replaces it.`,
  };
  if (send) return send(message);
  const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(message) });
  if (!res.ok) throw new Error(`email provider answered ${res.status}`);
}
