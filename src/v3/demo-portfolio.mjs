// The Brightdesk AI demo: one click gives an AI vendor three sample clients at three stages, so the Clients page
// shows a deployment lead's real week before any real client exists.
//   Quillby Bank    (bank)   pre-launch check, rules broken: needs a fix
//   Velmora Health  (health) checked, sign-off link sent: waiting for the client
//   Linden & Co.    (store)  checked and accepted by the client
// Each check result is a real Grapim check recorded on the sample agent (src/v3/demo-portfolio/<id>.json), copied in
// with a new id and date and marked demo: true, so nobody waits minutes or pays for a model call to see the page.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { appendAudit } from '../core/audit.mjs';
import { scansDir } from '../v1/risk.mjs';
import { policyFingerprint } from '../v1/policies.mjs';
import { recordSignoff } from './signoff.mjs';

const HERE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'demo-portfolio');

export const DEMO_CLIENTS = [
  { industry: 'bank', stage: 'fix', ageHours: 3 },
  { industry: 'health', stage: 'signoff', ageHours: 26 },
  { industry: 'store', stage: 'accepted', ageHours: 72 },
];

export const demoScan = industry => JSON.parse(fs.readFileSync(path.join(HERE, `${industry}.json`), 'utf8'));

// Writes the recorded check into a deployment folder as its latest check. Returns the new check.
export function seedDemoScan(dir, industry, now = new Date(), ageHours = 1) {
  const at = new Date(now.getTime() - ageHours * 3_600_000);
  const scan = { ...demoScan(industry), demo: true };
  scan.id = `${at.toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(2).toString('hex')}`;
  scan.createdAt = at.toISOString();
  scan.policyHash = policyFingerprint(dir);
  delete scan.draftId;
  // A check recorded after a fix: the demo agent gets the same approved instructions, so checking again matches.
  const applied = scan.appliedInstructions;
  delete scan.appliedInstructions;
  if (applied) {
    const file = path.join(dir, 'delomu.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.target = { ...config.target, instructionsField: 'instructions', body: { ...(config.target.body ?? {}), instructions: applied } };
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  }
  delete scan.recheckOf;
  fs.mkdirSync(scansDir(dir), { recursive: true });
  fs.writeFileSync(path.join(scansDir(dir), `${scan.id}.json`), JSON.stringify(scan, null, 2) + '\n');
  appendAudit(dir, { actor: 'grapim', action: 'scan.create', target: scan.id, detail: { demo: true, rules: scan.summary.rules, broken: scan.summary.broken } }, at);
  return scan;
}

// The client's decision for an accepted demo client.
export function seedDemoAcceptance(dir, scan, now = new Date()) {
  return recordSignoff(dir, { decision: 'accepted', name: 'Dana Lee (demo)', note: 'Demo sign-off.', scanId: scan.id, shareId: 'demo' }, now);
}
