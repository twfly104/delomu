// Append-only, hash-chained audit log (audit.jsonl in the deployment folder).
// Every agent action and every human review is written here. Editing or deleting
// an earlier line breaks the chain, which verifyAudit reports.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const file = dir => path.join(dir, 'audit.jsonl');
const GENESIS = '0'.repeat(64);

const digest = entry => crypto.createHash('sha256')
  .update(JSON.stringify([entry.seq, entry.ts, entry.actor, entry.action, entry.target, entry.detail, entry.prev]))
  .digest('hex');

export function readAudit(dir) {
  if (!fs.existsSync(file(dir))) return [];
  return fs.readFileSync(file(dir), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// actor: "agent" | "human:<name>" | "system"; action: short verb like "draft.create"
export function appendAudit(dir, { actor, action, target = '', detail = {} }, now = new Date()) {
  if (!actor || !action) throw new Error('audit entry needs actor and action');
  const entries = readAudit(dir);
  const last = entries.at(-1);
  const entry = { seq: (last?.seq ?? 0) + 1, ts: now.toISOString(), actor, action, target, detail, prev: last?.hash ?? GENESIS };
  entry.hash = digest(entry);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file(dir), JSON.stringify(entry) + '\n');
  return entry;
}

// Returns { ok: true, count } or { ok: false, brokenAt: seq, reason }.
export function verifyAudit(dir) {
  let prev = GENESIS;
  const entries = readAudit(dir);
  for (const [i, e] of entries.entries()) {
    if (e.seq !== i + 1) return { ok: false, brokenAt: i + 1, reason: 'sequence gap' };
    if (e.prev !== prev) return { ok: false, brokenAt: e.seq, reason: 'previous hash does not match' };
    if (digest(e) !== e.hash) return { ok: false, brokenAt: e.seq, reason: 'entry was modified' };
    prev = e.hash;
  }
  return { ok: true, count: entries.length };
}
