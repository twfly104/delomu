// monitor.json in the deployment folder: what the monitor remembers between checks.
//   { fingerprint, parts, lastRunId, lastRunAt, lastCheckAt, incident, outbox }
// incident is the open alert ({ key, caseIds, belowAcceptance, openedAt, updatedAt, notified, announced }) or null.
// outbox is the alert or "resolved" message whose delivery failed ({ type, key, payload }), retried on each check.

import fs from 'node:fs';
import path from 'node:path';

const file = dir => path.join(dir, 'monitor.json');

export function readState(dir) {
  if (!fs.existsSync(file(dir))) return {};
  try {
    return JSON.parse(fs.readFileSync(file(dir), 'utf8'));
  } catch (e) {
    throw new Error(`${file(dir)} is not valid JSON: ${e.message}`);
  }
}

// Write to a temp file and rename, so a crash mid-write never leaves a half-written state file.
export function writeState(dir, state) {
  const tmp = `${file(dir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, file(dir));
}
