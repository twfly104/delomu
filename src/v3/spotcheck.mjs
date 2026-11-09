// A random spot-check of the judge. People look at broken findings anyway; what nobody looks at is the answers the
// judge called kept, which is where a lenient judge hides its misses. Each check offers a few kept answers picked at
// random (fixed per check, so reloads show the same ones); a person marks each "agree" or "the judge was wrong".
// "Wrong" also records an override (the answer becomes broken). The evidence pack then reports a measured miss rate
// on this random sample, not only a floor (Lee 2026; Cresta and Coval calibrate their judges the same way;
// research_notes/papers-2026-agent-eval.md, unicorn-quality-mechanisms-2026-11.md).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';

export const SPOT_SIZE = 5;
const file = dir => path.join(dir, 'spotchecks.json');
const readAll = dir => { try { const x = JSON.parse(fs.readFileSync(file(dir), 'utf8')); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };
const rank = (scanId, key) => crypto.createHash('sha256').update(`${scanId}\u0000${key}`).digest('hex');

// The kept answers this check offers for review: [{ rule, index, key, probe }]. Uses the judge's own verdict, so an
// answer a person already changed stays in the sample (that is the point of the sample).
export function spotSample(scan, n = SPOT_SIZE) {
  const kept = [];
  for (const r of scan?.rules ?? []) (r.probes ?? []).forEach((p, i) => { if ((p.judgeStatus ?? p.status) === 'kept') kept.push({ rule: r, index: i, key: `${r.id}/${i}`, probe: p }); });
  return kept.sort((a, b) => rank(scan.id, a.key).localeCompare(rank(scan.id, b.key))).slice(0, n);
}

export const spotsFor = (dir, scanId) => readAll(dir)[scanId] ?? {};

export function recordSpot(dir, { scanId, key, agree, actor }, now = new Date()) {
  const all = readAll(dir);
  all[scanId] = { ...(all[scanId] ?? {}), [key]: { agree: Boolean(agree), by: String(actor), at: now.toISOString() } };
  fs.writeFileSync(file(dir), JSON.stringify(all, null, 2) + '\n');
  appendAudit(dir, { actor, action: 'judge.spotcheck', target: scanId, detail: { answer: key, agree: Boolean(agree) } }, now);
}

// Across checks: how many sampled kept answers people reviewed, and how many the judge got wrong.
export function spotRecord(dir, scanIds) {
  const all = readAll(dir);
  let reviewed = 0, wrong = 0;
  for (const id of scanIds) for (const v of Object.values(all[id] ?? {})) { reviewed++; if (!v.agree) wrong++; }
  return { reviewed, wrong };
}
