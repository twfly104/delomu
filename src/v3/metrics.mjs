// The deployment metrics from the plan, for one org (an AI vendor's include every client): engineer hours per
// deployment and the gate (deployment 5 under half of deployment 1), how much of each rollout the agent
// drafted, and days from start to the first live conversation. Pure reads; numbers come only from records.

import fs from 'node:fs';
import path from 'node:path';
import { compareDeployments } from '../v1/hours.mjs';
import { liveDir } from '../v1/live.mjs';
import { PLAYBOOK_NOTE } from '../v1/agent.mjs';

const AGENT_STEPS = ['mapping', 'integration', 'cases', 'fixes', 'launch-report'];

// The first live conversation's time, from the earliest month file in live/.
function firstLive(dir) {
  const root = liveDir(dir);
  if (!fs.existsSync(root)) return null;
  for (const f of fs.readdirSync(root).filter(n => /^\d{4}-\d{2}\.jsonl$/.test(n)).sort()) {
    const times = fs.readFileSync(path.join(root, f), 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return Date.parse(JSON.parse(l).checkedAt ?? JSON.parse(l).at); } catch { return NaN; } })
      .filter(Number.isFinite);
    if (times.length) return new Date(Math.min(...times));
  }
  return null;
}

// An approved draft the playbook helped with: test messages from it ("lib-" ids) or an integration started from it.
const fromPlaybook = d => d.status === 'approved'
  && ((d.content?.rows ?? []).some(r => String(r.id).startsWith('lib-')) || String(d.rationale ?? '').includes(PLAYBOOK_NOTE));
const average = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// rows: [{ org, name, dir, ov }] as the web app builds them.
export function deploymentMetrics(rows) {
  const byDir = new Map(rows.map(r => [r.dir, r]));
  const { deployments, gate } = compareDeployments(rows.map(r => r.dir));
  const list = deployments.map((d, i) => {
    const r = byDir.get(d.dir);
    const done = r.ov.steps.filter(s => AGENT_STEPS.includes(s.key) && s.state === 'done').map(s => s.key);
    const approved = new Set(r.ov.drafts.filter(x => x.status === 'approved').map(x => x.kind));
    const drafted = done.filter(k => approved.has(k)).length;
    const live = firstLive(d.dir);
    const playbookDrafts = r.ov.drafts.filter(fromPlaybook);
    return {
      usedPlaybook: playbookDrafts.length > 0,
      playbookCases: playbookDrafts.reduce((n, x) => n + (x.content?.rows ?? []).filter(row => String(row.id).startsWith('lib-')).length, 0),
      number: i + 1, org: r.org, name: r.name, startedAt: d.startedAt.toISOString(), hours: d.total, byStep: d.byStep,
      stepsDone: done.length, stepsDrafted: drafted,
      liveAt: live?.toISOString() ?? null, daysToLive: live ? Math.max(0, Math.round((live - d.startedAt) / 86400_000)) : null,
    };
  });
  const sum = f => list.reduce((n, d) => n + f(d), 0);
  const withLive = list.filter(d => d.daysToLive !== null);
  // Hours with and without the playbook, over rollouts that logged hours: does reuse make rollouts cheaper?
  const logged = list.filter(d => d.hours > 0);
  const group = used => { const g = logged.filter(d => d.usedPlaybook === used); return { count: g.length, averageHours: average(g.map(d => d.hours)) }; };
  return {
    deployments: list, gate,
    automation: sum(d => d.stepsDone) ? sum(d => d.stepsDrafted) / sum(d => d.stepsDone) : null,
    medianDaysToLive: withLive.length ? withLive.map(d => d.daysToLive).sort((a, b) => a - b)[Math.floor((withLive.length - 1) / 2)] : null,
    totalHours: sum(d => d.hours),
    playbook: { used: list.filter(d => d.usedPlaybook).length, cases: sum(d => d.playbookCases), withIt: group(true), without: group(false) },
  };
}
