// Productization health: the plan's guard against becoming a services company, as software. It reads what the
// team already records (logged hours, drafts a person rewrote or rejected, connections) plus three small inputs:
// a tag on a manual step, the revenue each client brings, and the org's team size and focus. From those it
// lists the manual work that keeps coming back (three times means it should become a feature), tracks the
// four numbers from the plan, and says plainly when the trend looks like services, not software.
//
// Per deployment: interventions.jsonl (manual steps someone tagged), revenue.json (onboarding fee and monthly
// fee). Per org: <deployments root>/<org id>/.productization.json (team size, focus).

import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';
import { listDrafts } from '../core/drafts.mjs';
import { readRawConfig } from '../v4/deployment.mjs';

export const REPEAT_THRESHOLD = 3;
// Connections that count as one of the few supported systems; anything else is one-off work.
export const STANDARD_CONNECTIONS = ['openai', 'http', 'intercom', 'zendesk'];
const MAX_NOTE = 200;

export const normTag = t => String(t ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, '-').slice(0, 60);
const interventionsFile = dir => path.join(dir, 'interventions.jsonl');
const revenueFile = dir => path.join(dir, 'revenue.json');
const orgFile = (root, orgId) => path.join(root, orgId, '.productization.json');
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// A manual step someone tagged: { at, step, tag, hours, note, by }.
export function logIntervention(dir, { step, tag, hours = 0, note = '', by }, now = new Date()) {
  const t = normTag(tag);
  if (!t) throw new Error('Name what needed a person, for example “client API has no docs”.');
  const entry = { at: now.toISOString(), step: String(step ?? ''), tag: t, hours: Number(hours) || 0, note: String(note).replace(/[\r\n]+/g, ' ').slice(0, MAX_NOTE), by };
  fs.appendFileSync(interventionsFile(dir), JSON.stringify(entry) + '\n');
  appendAudit(dir, { actor: by, action: 'intervention.log', target: t, detail: { step: entry.step, hours: entry.hours } }, now);
  return entry;
}

export function readInterventions(dir) {
  if (!fs.existsSync(interventionsFile(dir))) return [];
  return fs.readFileSync(interventionsFile(dir), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// Drafts a person had to rewrite or turn down are manual work too, recorded without anyone tagging them.
export function draftInterventions(dir) {
  return listDrafts(dir).filter(d => (d.status === 'approved' && d.edited) || d.status === 'rejected').map(d => ({
    at: d.reviewedAt ?? d.createdAt, step: d.kind, tag: `${d.status === 'rejected' ? 'rejected' : 'rewrote'}-${d.kind}-draft`, hours: 0, note: d.note ?? '', by: d.reviewedBy ?? '', auto: true,
  }));
}

// Revenue from one client, in the vendor's own numbers: a one-time onboarding fee and a monthly fee since a month.
export function getRevenue(dir) {
  return { onboardingUsd: 0, onboardingAt: null, monthlyUsd: 0, since: null, ...readJson(revenueFile(dir), {}) };
}
export function setRevenue(dir, { onboardingUsd, monthlyUsd, since }, { actor, now = new Date() } = {}) {
  const money = (v, label) => {
    const n = v === '' || v === undefined || v === null ? 0 : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new Error(`${label} must be a number of US dollars, 0 or more.`);
    return Math.round(n * 100) / 100;
  };
  const prev = getRevenue(dir);
  const onboarding = money(onboardingUsd, 'The onboarding fee');
  const monthly = money(monthlyUsd, 'The monthly fee');
  const month = String(since ?? '').trim() || now.toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('The monthly fee start must be a month like 2026-11.');
  const record = {
    onboardingUsd: onboarding, onboardingAt: onboarding ? (prev.onboardingUsd === onboarding && prev.onboardingAt ? prev.onboardingAt : now.toISOString().slice(0, 10)) : null,
    monthlyUsd: monthly, since: monthly ? month : null,
  };
  fs.writeFileSync(revenueFile(dir), JSON.stringify(record, null, 2) + '\n');
  appendAudit(dir, { actor, action: 'revenue.set', target: 'revenue', detail: record }, now);
  return record;
}

// Org settings: { teamSize, focus: { kinds: [...agentKind], industry, connections: [...] } }.
export function getOrgSettings(root, orgId) {
  const s = readJson(orgFile(root, orgId), {});
  return { teamSize: s.teamSize ?? null, focus: { kinds: s.focus?.kinds ?? [], industry: s.focus?.industry ?? '', connections: s.focus?.connections?.length ? s.focus.connections : STANDARD_CONNECTIONS } };
}
export function setOrgSettings(root, orgId, { teamSize, kinds = [], industry = '', connections = [] }) {
  const size = teamSize === '' || teamSize === undefined ? null : Number(teamSize);
  if (size !== null && !(Number.isInteger(size) && size >= 1 && size <= 10_000)) throw new Error('Team size must be a whole number of people, 1 or more.');
  const record = {
    teamSize: size,
    focus: {
      kinds: [...new Set([].concat(kinds).map(String).filter(Boolean))].slice(0, 5),
      industry: String(industry).trim().toLowerCase().slice(0, 60),
      connections: [...new Set([].concat(connections).map(String).filter(c => STANDARD_CONNECTIONS.includes(c)))],
    },
  };
  fs.mkdirSync(path.dirname(orgFile(root, orgId)), { recursive: true });
  fs.writeFileSync(orgFile(root, orgId), JSON.stringify(record, null, 2) + '\n');
  return getOrgSettings(root, orgId);
}

const connectionOf = config => config.target?.preset ?? config.target?.type ?? null;

// Why a client sits outside the focus, if it does: a different kind of agent, another industry, or a
// connection that is not one of the supported few (one-off integration work).
export function focusIssues(config, focus) {
  const issues = [];
  const kind = config.agentKind ?? 'support';
  if (focus.kinds.length && !focus.kinds.includes(kind)) issues.push({ type: 'kind', text: `${kind} agent, outside your focus (${focus.kinds.join(', ')})` });
  const industry = typeof config.industry === 'string' ? config.industry.trim().toLowerCase() : '';
  if (focus.industry && industry && industry !== focus.industry) issues.push({ type: 'industry', text: `${industry}, outside your focus (${focus.industry})` });
  const conn = connectionOf(config);
  if (conn && !focus.connections.includes(conn)) issues.push({ type: 'one-off', text: conn === 'command' ? 'custom command integration: one-off work' : `${conn} connection is not one of your supported systems` });
  return issues;
}

const monthsBetween = (fromMonth, to) => {
  const [y, m] = fromMonth.split('-').map(Number);
  return (to.getUTCFullYear() - y) * 12 + (to.getUTCMonth() + 1 - m) + 1;
};
const quarterOf = d => `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;

// Service share by quarter, newest last: onboarding fees over all revenue in that quarter.
export function revenueByQuarter(revenues, now = new Date(), quarters = 4) {
  const out = [];
  for (let i = quarters - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3 - 3 * i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1));
    let service = 0, software = 0;
    for (const r of revenues) {
      if (r.onboardingUsd && r.onboardingAt) { const at = new Date(`${r.onboardingAt}T00:00:00Z`); if (at >= start && at < end) service += r.onboardingUsd; }
      if (r.monthlyUsd && r.since) {
        for (let k = 0; k < 3; k++) {
          const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k, 1));
          if (month > now) break;
          if (`${month.toISOString().slice(0, 7)}` >= r.since) software += r.monthlyUsd;
        }
      }
    }
    const total = service + software;
    out.push({ quarter: quarterOf(start), service, software, serviceShare: total ? service / total : null });
  }
  return out;
}

// rows: [{ org, name, dir, ov }] as the web app builds them (vendor and its clients); m: deploymentMetrics().
export function productizationHealth({ rows, m, settings, now = new Date() }) {

  const all = rows.flatMap(r => [...readInterventions(r.dir), ...draftInterventions(r.dir)].map(i => ({ ...i, deployment: r.name, client: r.org.name })));
  const groups = new Map();
  for (const i of all) {
    const g = groups.get(i.tag) ?? { tag: i.tag, count: 0, hours: 0, clients: new Set(), steps: new Set(), last: '', auto: true, notes: [] };
    g.count++; g.hours += i.hours || 0; g.clients.add(i.client); if (i.step) g.steps.add(i.step);
    if (i.at > g.last) g.last = i.at;
    if (!i.auto) g.auto = false;
    if (i.note && g.notes.length < 3) g.notes.push(i.note);
    groups.set(i.tag, g);
  }
  const tags = [...groups.values()].map(g => ({ ...g, clients: [...g.clients], steps: [...g.steps] }))
    .sort((a, b) => b.count - a.count || b.hours - a.hours || a.tag.localeCompare(b.tag));
  const backlog = tags.filter(t => t.count >= REPEAT_THRESHOLD);

  const offFocus = rows.map(r => {
    let config = {};
    try { config = readRawConfig(r.dir); } catch { /* not configured */ }
    return { org: r.org, name: r.name, issues: focusIssues(config, settings.focus) };
  }).filter(x => x.issues.length);

  const revenues = rows.map(r => getRevenue(r.dir));
  const quarters = revenueByQuarter(revenues, now);
  const mrr = revenues.reduce((n, r) => n + (r.monthlyUsd || 0), 0);
  const yearAgo = new Date(now.getTime() - 365 * 86400_000).toISOString().slice(0, 10);
  const fees12 = revenues.reduce((n, r) => n + (r.onboardingAt && r.onboardingAt >= yearAgo ? r.onboardingUsd : 0), 0);
  const recurring12 = revenues.reduce((n, r) => n + (r.monthlyUsd && r.since ? r.monthlyUsd * Math.min(12, Math.max(0, monthsBetween(r.since, now))) : 0), 0);
  const revenuePerPerson = settings.teamSize ? (fees12 + recurring12) / settings.teamSize : null;
  const hasRevenue = revenues.some(r => r.onboardingUsd || r.monthlyUsd);

  // The warning: after 3 rollouts with hours, the later ones are not getting cheaper.
  const logged = m.deployments.filter(d => d.hours > 0);
  const reasons = [];
  let verdict = 'not_enough_data';
  if (logged.length >= 3) {
    const half = Math.floor(logged.length / 2);
    const early = logged.slice(0, half).reduce((n, d) => n + d.hours, 0) / half;
    const late = logged.slice(-half).reduce((n, d) => n + d.hours, 0) / half;
    const falling = late < early * 0.85;
    verdict = falling ? 'software' : 'services';
    reasons.push(`Later rollouts average ${late.toFixed(1)} h against ${early.toFixed(1)} h for the first ones${falling ? '' : ': hours are not falling'}.`);
  }
  const shares = quarters.filter(q => q.serviceShare !== null);
  if (shares.length >= 2 && shares.at(-1).serviceShare > shares.at(-2).serviceShare) {
    reasons.push(`Service share rose from ${Math.round(shares.at(-2).serviceShare * 100)}% to ${Math.round(shares.at(-1).serviceShare * 100)}% last quarter.`);
    if (verdict === 'software') verdict = 'watch';
  }
  if (backlog.length) reasons.push(`${backlog.length} kind${backlog.length === 1 ? '' : 's'} of manual work came back ${REPEAT_THRESHOLD} times or more: make ${backlog.length === 1 ? 'it' : 'them'} a feature.`);
  if (offFocus.length) reasons.push(`${offFocus.length} client${offFocus.length === 1 ? '' : 's'} outside your focus or on one-off integrations.`);
  if (verdict === 'services' && offFocus.length) reasons.push('Narrow the focus: say no to clients outside it.');
  if (verdict === 'services' && backlog.length) reasons.push('Turn the repeated work into the product before taking more clients.');

  return {
    verdict, reasons, tags, backlog, offFocus, quarters, mrr, revenuePerPerson, teamSize: settings.teamSize, hasRevenue,
    interventions: all.length, automation: m.automation, gate: m.gate, deployments: m.deployments.length,
  };
}
