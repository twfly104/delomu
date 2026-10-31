// Step 6: continuous monitoring. One check decides whether a deployment is due for a re-run
// (forced, its fingerprint changed, or the interval elapsed), runs the test set, compares the run
// with the previous one, and alerts on regressions with incident-style dedup. Every check is audited.
// This module is the v2 interface other versions wire to: checkDeployment, findDeployments, usage.

import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';
import { loadConfig } from '../deployment.mjs';
import { runDeployment, latestRun } from '../run.mjs';
import { readRawConfig, monitorConfig } from './config.mjs';
import { computeFingerprint, changedParts } from './fingerprint.mjs';
import { readState, writeState } from './state.mjs';
import { diffRuns, writeDiff } from './diff.mjs';
import { evaluateIncident, postWebhook } from './alerts.mjs';

export { findDeployments } from './discover.mjs';
export { usage } from './usage.mjs';

const HOUR_MS = 3_600_000;
const audit = (dir, action, detail, now, target = '') => appendAudit(dir, { actor: 'system', action, target, detail }, now);

// Returns { due: true, reason } or { due: false, reason } for a check at `now`.
export function dueReason(state, parts, { intervalHours }, now, force) {
  if (force) return { due: true, reason: 'forced' };
  if (!state.lastRunAt) return { due: true, reason: 'first monitored run' };
  const changed = changedParts(state.parts, parts);
  if (changed.length) return { due: true, reason: `fingerprint changed (${changed.join(', ')})` };
  const nextAt = Date.parse(state.lastRunAt) + intervalHours * HOUR_MS;
  if (!(now.getTime() < nextAt)) return { due: true, reason: `${intervalHours} h interval elapsed` };
  return { due: false, reason: `no change since run ${state.lastRunId}; next scheduled run after ${new Date(nextAt).toISOString()}` };
}

function readResults(runDir) {
  if (!runDir) return null;
  const file = path.join(runDir, 'results.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`cannot compare with the previous run: ${file} is not valid JSON (${e.message}); move that run folder away to compare with the one before it`);
  }
}

// Sends the message if a webhook is configured. Never throws: delivery problems go to the audit log.
// Returns { type, sent, skipped, reason? }; skipped means no webhook is configured, so there is nothing to retry.
async function deliver(dir, monitor, message, { env, fetchImpl, now }) {
  const url = monitor.webhookEnv ? env[monitor.webhookEnv] : undefined;
  const detail = { type: message.type, key: message.key };
  if (!url) {
    const reason = monitor.webhookEnv ? `environment variable ${monitor.webhookEnv} is not set` : 'no monitor.webhookEnv in delomu.json';
    audit(dir, 'monitor.alert.skipped', { ...detail, reason }, now);
    return { type: message.type, sent: false, skipped: true, reason };
  }
  try {
    await postWebhook(url, message.payload, { fetchImpl });
    audit(dir, 'monitor.alert.sent', detail, now);
    return { type: message.type, sent: true, skipped: false };
  } catch (e) {
    // The URL is a secret (it carries the token), so only the error message is logged.
    audit(dir, 'monitor.alert.failed', { ...detail, error: e.message }, now);
    return { type: message.type, sent: false, skipped: false, reason: e.message };
  }
}

// Applies a delivery outcome: the incident as it should be stored, and the message to keep for a retry
// (null once it arrived or when no webhook is configured, so there is nothing to retry).
function settle(incident, message, outcome) {
  const failed = !outcome.sent && !outcome.skipped;
  if (message.type === 'alert') return { incident: { ...incident, notified: !failed, announced: incident.announced || !failed }, outbox: failed ? message : null };
  return { incident: failed ? incident : null, outbox: failed ? message : null };
}

// options: now (Date), force (bool), judge (passed to runDeployment: false, true or a judge function),
// env (where the webhook env var is read, default process.env), fetchImpl (for the webhook).
export async function checkDeployment(dir, { now = new Date(), force = false, judge, env = process.env, fetchImpl } = {}) {
  let monitor, state, fp;
  try {
    const config = loadConfig(dir);
    monitor = monitorConfig(readRawConfig(dir));
    state = readState(dir);
    fp = await computeFingerprint(dir, { target: config.target, probe: monitor.versionProbe, previousVersion: state.parts?.version ?? null });
  } catch (e) {
    // A deployment with a broken config or no tests is still a check that happened.
    if (fs.existsSync(dir)) audit(dir, 'monitor.check', { ran: false, error: e.message }, now);
    throw e;
  }
  if (fp.probeError) audit(dir, 'monitor.probe.failed', { error: fp.probeError }, now);

  const { due, reason } = dueReason(state, fp.parts, monitor, now, force);
  if (!due) {
    // A message whose delivery failed is retried on every check, not only on the next run.
    let next = { ...state, lastCheckAt: now.toISOString() };
    let outcome = null;
    if (state.outbox) {
      outcome = await deliver(dir, monitor, state.outbox, { env, fetchImpl, now });
      next = { ...next, ...settle(state.incident ?? null, state.outbox, outcome) };
    }
    writeState(dir, next);
    audit(dir, 'monitor.check', { ran: false, reason, fingerprint: fp.hash, alert: outcome?.type ?? null }, now);
    return { ran: false, reason, alert: outcome };
  }

  let run, previous;
  try {
    previous = readResults(latestRun(dir));
    run = await runDeployment(dir, { judge, now });
  } catch (e) {
    audit(dir, 'monitor.check', { ran: false, reason, error: e.message, fingerprint: fp.hash }, now);
    throw e;
  }
  const { results, outDir } = run;
  const diff = diffRuns(previous, results);
  writeDiff(outDir, diff);

  const previousIncident = state.incident ?? null;
  const { incident: next, message } = evaluateIncident(previousIncident, { diff, results, reportPath: path.join(outDir, 'diff.html'), now });
  // A run recomputes the incident from scratch, so it replaces any message still waiting for a retry.
  let incident = next;
  let outbox = null;
  let outcome = null;
  if (message) {
    outcome = await deliver(dir, monitor, message, { env, fetchImpl, now });
    // A "resolved" that did not arrive keeps the incident open until it does.
    ({ incident, outbox } = settle(message.type === 'alert' ? next : previousIncident, message, outcome));
  }

  writeState(dir, {
    fingerprint: fp.hash,
    parts: fp.parts,
    lastRunId: results.runId,
    lastRunAt: now.toISOString(),
    lastCheckAt: now.toISOString(),
    incident,
    outbox,
  });
  audit(dir, 'monitor.check', {
    ran: true,
    reason,
    fingerprint: fp.hash,
    regressions: diff.regressions.length,
    passRate: results.summary.passRate,
    verdict: results.summary.verdict,
    alert: outcome?.type ?? null,
  }, now, results.runId);
  return { ran: true, reason, results, diff, alert: outcome };
}
