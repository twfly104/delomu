// The release gate on a sign-off link: a check with a broken high-risk rule goes to the client only with a written
// reason. The reason is kept per link (waivers.json in the deployment folder), shown to the client on the link and
// written to the audit log by the caller.

import fs from 'node:fs';
import path from 'node:path';

const file = dir => path.join(dir, 'waivers.json');
const readAll = dir => { try { const x = JSON.parse(fs.readFileSync(file(dir), 'utf8')); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };

// Titles of the high-severity rules a check broke (an answer judged broken, after any person's override).
export const highRiskBroken = scan => (scan?.rules ?? [])
  .filter(r => r.severity === 'high' && (r.probes ?? []).some(p => p.status === 'broken'))
  .map(r => String(r.title || r.rule || r.id).slice(0, 80));

export function saveWaiver(dir, shareId, { reason, by, rules, scanId }, now = new Date()) {
  const all = readAll(dir);
  all[shareId] = { reason: String(reason).slice(0, 1000), by: String(by), rules, scanId, at: now.toISOString() };
  fs.writeFileSync(file(dir), JSON.stringify(all, null, 2) + '\n');
  return all[shareId];
}

export const waiverFor = (dir, shareId) => readAll(dir)[shareId] ?? null;
