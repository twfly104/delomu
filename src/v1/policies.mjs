// Has the customer's policy changed since the last check? A check stores a hash of the policy documents it
// read (every file in inputs/ except CSV ticket exports); a different hash now means its rules may be stale.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const isPolicy = name => !name.toLowerCase().endsWith('.csv');

export function policyFingerprint(dir) {
  const root = path.join(dir, 'inputs');
  const hash = crypto.createHash('sha256');
  if (!fs.existsSync(root)) return null;
  const files = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isFile() && isPolicy(e.name)).map(e => e.name).sort();
  if (!files.length) return null;
  for (const name of files) hash.update(`${name}\n`).update(fs.readFileSync(path.join(root, name))).update('\n');
  return hash.digest('hex');
}

// True when the latest check read different policy documents than the ones there now. A check made before
// checks stored the hash counts as changed only when a policy file was modified after it.
export function policiesChanged(dir, scan) {
  if (!scan) return false;
  if (scan.policyHash) return policyFingerprint(dir) !== scan.policyHash;
  const root = path.join(dir, 'inputs');
  if (!fs.existsSync(root)) return false;
  return fs.readdirSync(root, { withFileTypes: true }).some(e => e.isFile() && isPolicy(e.name) && fs.statSync(path.join(root, e.name)).mtime.toISOString() > scan.createdAt);
}
