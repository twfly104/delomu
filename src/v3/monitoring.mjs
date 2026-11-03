// Step 6 on the hosted server: v2's regression monitor (src/v2/monitor.mjs) for every deployment that turned it
// on. The server checks them on a timer. A deployment re-runs its saved test set when the interval has passed,
// when its tests or connection change, or when the model version it reports changes. A regression posts to
// the deployment's alert webhook (the same one live monitoring uses), and the run counts toward the plan like
// any other run.

import fs from 'node:fs';
import { loadConfig, paths } from '../deployment.mjs';
import { checkTarget } from './workspace.mjs';
import { appendAudit } from '../core/audit.mjs';
import { checkDeployment } from '../v2/monitor.mjs';
import { readRawConfig } from '../v2/config.mjs';
import { readState } from '../v2/state.mjs';
import { getLiveSettings } from '../v1/live.mjs';

// The env var name the web app gives v2 for the webhook; its value comes from the deployment's live settings.
export const WEBHOOK_ENV = 'DELOMU_DEPLOYMENT_WEBHOOK';
export const INTERVALS = [6, 12, 24, 72];

export function monitorSettings(dir) {
  let m = {};
  try { m = readRawConfig(dir).monitor ?? {}; } catch { /* no config yet */ }
  return {
    enabled: m.enabled === true,
    intervalHours: INTERVALS.includes(m.intervalHours) ? m.intervalHours : 24,
    versionUrl: m.versionProbe?.type === 'http' ? m.versionProbe.url : '',
    versionPath: m.versionProbe?.type === 'http' ? m.versionProbe.path ?? '' : '',
  };
}

// Validates and writes the "monitor" section. Throws a message fit for the form.
export function setMonitor(dir, { enabled, intervalHours, versionUrl = '', versionPath = '' }, { actor, now = new Date() } = {}) {
  const hours = Number(intervalHours);
  if (!INTERVALS.includes(hours)) throw new Error(`Choose an interval of ${INTERVALS.join(', ')} hours.`);
  const url = String(versionUrl).trim();
  if (url && !/^https:\/\/\S+$/i.test(url)) throw new Error('The version URL must be an https:// address.');
  const field = String(versionPath).trim();
  if (field && !/^[\w.[\]-]{1,120}$/.test(field)) throw new Error('The version field must be a dot path such as model.version.');
  const raw = readRawConfig(dir);
  raw.monitor = {
    enabled: Boolean(enabled), intervalHours: hours, webhookEnv: WEBHOOK_ENV,
    ...(url && { versionProbe: { type: 'http', url, path: field } }),
  };
  fs.writeFileSync(paths(dir).config, JSON.stringify(raw, null, 2) + '\n');
  appendAudit(dir, { actor, action: enabled ? 'monitor.on' : 'monitor.off', target: 'monitor', detail: { intervalHours: hours, versionProbe: Boolean(url) } }, now);
  return monitorSettings(dir);
}

// What the page shows: the last check, the last run and any open regression.
export function monitorStatus(dir) {
  const s = readState(dir);
  return s.lastCheckAt ? {
    lastCheckAt: s.lastCheckAt, lastRunAt: s.lastRunAt ?? null, lastRunId: s.lastRunId ?? null,
    version: s.parts?.version ?? null, incident: s.incident ?? null,
  } : null;
}

// One pass over the deployments. list: [{ orgId, name, dir }]. Returns [{ name, ran, reason?, error? }].
// One deployment's failure never stops the others; each is written to that deployment's audit log by v2.
export async function monitorTick(ctx, list) {
  const out = [];
  for (const d of list) {
    if (!monitorSettings(d.dir).enabled) continue;
    let release = () => {};
    try {
      if (!fs.existsSync(paths(d.dir).tests)) { out.push({ orgId: d.orgId, name: d.name, ran: false, error: 'no saved test set yet' }); continue; }
      // The same connection rules as a run started by a person (no command targets unless the server allows them).
      checkTarget(loadConfig(d.dir), ctx.policy);
      const env = { ...ctx.env, [WEBHOOK_ENV]: getLiveSettings(d.dir).webhook || undefined };
      // A monitored run is a run: plan limits apply before it, and it is metered after it.
      release = ctx.billing?.reserveRun(d.orgId, d.name) ?? (() => {});
      const r = await checkDeployment(d.dir, { now: ctx.now(), judge: ctx.judge ?? true, env });
      if (r.ran) await ctx.billing?.afterRun(d.orgId, d.name);
      out.push({ orgId: d.orgId, name: d.name, ran: r.ran, reason: r.reason });
    } catch (e) {
      out.push({ orgId: d.orgId, name: d.name, ran: false, error: e.message });
    } finally {
      release();
    }
  }
  return out;
}
