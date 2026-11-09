import { cl } from './html.mjs';
// The evidence pack: one AI agent's record over a date range, for legal, risk and compliance. It gathers what
// Grapim already wrote down (checks and re-checks in scans/, the fix in fix.json, live/<month>.jsonl and the
// audit log) and estimates nothing: every number names the records it was counted from. buildEvidence returns
// plain data; renderEvidence turns it into self-contained, printable HTML with every value escaped.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAudit, verifyAudit } from '../core/audit.mjs';
import { esc } from '../report.mjs';
import { TOKENS } from '../theme.mjs';
import { getFix } from '../v1/fix.mjs';
import { listConversations, liveDir } from '../v1/live.mjs';
import { listScans } from '../v1/risk.mjs';
import { signoffs } from './signoff.mjs';
import { policyFingerprint } from '../v1/policies.mjs';

const DAY_MS = 86_400_000;
export const DEFAULT_DAYS = 90;
const TOP_RULES = 5;

const FIX_ACTIONS = { 'fix.apply': 'Approved and applied by Grapim', 'fix.applied_manually': 'Approved, applied by the team in their own tool', 'fix.revert': 'Reverted to the earlier instructions' };

const isoDay = d => d.toISOString().slice(0, 10);

// A real calendar day in YYYY-MM-DD, or null. new Date rolls 2026-02-30 over to March, so round-trip it.
function parseDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && isoDay(d) === s ? d : null;
}

// Reads ?from=&to= (both optional, inclusive days in UTC). Missing ends default to the last 90 days up to today.
// Returns { ok: true, from, to } as YYYY-MM-DD, or { ok: false, reason }.
export function evidenceRange({ from, to } = {}, now = new Date()) {
  const toDay = to ? parseDay(to) : parseDay(isoDay(now));
  if (!toDay) return { ok: false, reason: 'The "to" date must be a real date written YYYY-MM-DD.' };
  const fromDay = from ? parseDay(from) : new Date(toDay.getTime() - (DEFAULT_DAYS - 1) * DAY_MS);
  if (!fromDay) return { ok: false, reason: 'The "from" date must be a real date written YYYY-MM-DD.' };
  if (fromDay > toDay) return { ok: false, reason: 'The "from" date is after the "to" date.' };
  return { ok: true, from: isoDay(fromDay), to: isoDay(toDay) };
}

const ruleStatus = r => (r.probes?.some(p => p.status === 'broken') ? 'broken'
  : r.probes?.some(p => p.status === 'unjudged' || p.status === 'error') ? 'review' : 'kept');
// A re-check copies the rules of the check it repeats, so id and wording together name the same rule.
const ruleKey = r => `${r.id}\u0000${r.rule}`;
const ruleLabel = r => ({ id: String(r.id ?? ''), text: String(r.rule ?? r.id ?? ''), clause: String(r.clause ?? ''), severity: r.severity ?? 'medium' });

// Every month YYYY-MM from the month of `from` to the month of `to`.
function monthsBetween(from, to) {
  const out = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  while (isoDay(d).slice(0, 7) <= to.slice(0, 7)) {
    out.push(isoDay(d).slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

// The audit log as read, without throwing on a line that is not JSON (that line is where the chain breaks).
function auditState(dir) {
  try {
    const entries = readAudit(dir);
    return { entries, verify: verifyAudit(dir) };
  } catch {
    const lines = fs.readFileSync(path.join(dir, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean);
    const bad = lines.findIndex(l => { try { JSON.parse(l); return false; } catch { return true; } });
    const entries = lines.slice(0, bad).map(l => JSON.parse(l));
    // An earlier entry may already be broken: verify the readable lines before it on their own.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-audit-'));
    try {
      fs.writeFileSync(path.join(tmp, 'audit.jsonl'), lines.slice(0, bad).map(l => `${l}
`).join(''));
      const prefix = verifyAudit(tmp);
      return { entries, verify: prefix.ok ? { ok: false, brokenAt: bad + 1, reason: 'the line is not valid JSON' } : prefix, lines: lines.length };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

// dir: the deployment folder. from, to: YYYY-MM-DD (inclusive, UTC). now: the generation time.
export function buildEvidence(dir, { from, to, now = new Date() }) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`) + DAY_MS;
  const inRange = iso => { const t = Date.parse(iso); return t >= start && t < end; };

  const all = listScans(dir);
  const byId = new Map(all.map(s => [s.id, s]));
  const scans = all.filter(s => inRange(s.createdAt)).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const checks = scans.map(s => ({
    id: s.id, createdAt: s.createdAt, recheckOf: s.recheckOf ?? null,
    rules: (s.rules ?? []).length, broken: (s.rules ?? []).filter(r => ruleStatus(r) === 'broken').length,
    messages: (s.rules ?? []).reduce((n, r) => n + (r.probes?.length ?? 0), 0),
  }));

  const rechecks = scans.filter(s => s.recheckOf).map(after => {
    const before = byId.get(after.recheckOf);
    const was = new Map((before?.rules ?? []).map(r => [ruleKey(r), ruleStatus(r)]));
    const fixed = []; const stillBroken = []; const newlyBroken = [];
    for (const r of after.rules ?? []) {
      const st = ruleStatus(r);
      const then = was.get(ruleKey(r));
      if (then === 'broken' && st === 'kept') fixed.push(ruleLabel(r));
      else if (then === 'broken' && st === 'broken') stillBroken.push(ruleLabel(r));
      else if (then && then !== 'broken' && st === 'broken') newlyBroken.push(ruleLabel(r));
    }
    return {
      id: after.id, createdAt: after.createdAt, of: after.recheckOf, ofFound: Boolean(before),
      beforeBroken: before ? before.rules.filter(r => ruleStatus(r) === 'broken').length : null,
      afterBroken: (after.rules ?? []).filter(r => ruleStatus(r) === 'broken').length,
      messages: (after.rules ?? []).reduce((n, r) => n + (r.probes?.length ?? 0), 0),
      fixed, stillBroken, newlyBroken,
    };
  });

  // Time to fix: a rule broken in a check opens an episode; the first later re-check that keeps it closes it.
  const open = new Map();
  const fixes = [];
  for (const s of scans) for (const r of s.rules ?? []) {
    const key = ruleKey(r);
    const st = ruleStatus(r);
    if (st === 'broken' && !open.has(key)) open.set(key, { scan: s, rule: r });
    else if (st === 'kept' && s.recheckOf && open.has(key)) {
      const o = open.get(key);
      fixes.push({ ...ruleLabel(r), brokenIn: o.scan.id, brokenAt: o.scan.createdAt, keptIn: s.id, keptAt: s.createdAt, ms: Date.parse(s.createdAt) - Date.parse(o.scan.createdAt) });
      open.delete(key);
    }
  }
  const timeToFix = {
    samples: fixes,
    meanMs: fixes.length ? Math.round(fixes.reduce((n, f) => n + f.ms, 0) / fixes.length) : null,
    stillOpen: [...open.values()].map(o => ({ ...ruleLabel(o.rule), brokenIn: o.scan.id, brokenAt: o.scan.createdAt })),
  };

  const audit = auditState(dir);
  const fixEvents = audit.entries.filter(e => FIX_ACTIONS[e.action] && inRange(e.ts)).map(e => ({ at: e.ts, action: e.action, actor: String(e.actor ?? ''), scanId: String(e.target ?? ''), seq: e.seq, source: 'audit' }));
  const fix = getFix(dir);
  if (fix) {
    for (const e of fixEvents) if (e.scanId === fix.scanId) Object.assign(e, { summary: fix.summary ?? '', rules: (fix.rules ?? []).length });
    // fix.json says it was approved or reverted in range but the audit log has no matching line: show it, flagged.
    const has = act => fixEvents.some(e => e.scanId === fix.scanId && act.includes(e.action));
    if (fix.approvedAt && inRange(fix.approvedAt) && !has(['fix.apply', 'fix.applied_manually'])) {
      fixEvents.push({ at: fix.approvedAt, action: fix.appliedByGrapim ? 'fix.apply' : 'fix.applied_manually', actor: String(fix.approvedBy ?? ''), scanId: fix.scanId, seq: null, source: 'fix.json', summary: fix.summary ?? '', rules: (fix.rules ?? []).length });
    }
    if (fix.revertedAt && inRange(fix.revertedAt) && !has(['fix.revert'])) {
      fixEvents.push({ at: fix.revertedAt, action: 'fix.revert', actor: String(fix.revertedBy ?? ''), scanId: fix.scanId, seq: null, source: 'fix.json', summary: fix.summary ?? '', rules: (fix.rules ?? []).length });
    }
  }
  fixEvents.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // Live: every stored month file, counted by when the conversation happened (its `at`).
  const files = fs.existsSync(liveDir(dir)) ? fs.readdirSync(liveDir(dir)).filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f)) : [];
  const convs = files.flatMap(f => listConversations(dir, f.slice(0, 7))).filter(c => inRange(c.at));
  const months = monthsBetween(from, to).map(month => {
    const list = convs.filter(c => c.at.slice(0, 7) === month);
    return { month, checked: list.length, flagged: list.filter(c => c.status === 'flagged').length, unjudged: list.filter(c => c.status === 'unjudged').length };
  });
  const byRule = new Map();
  for (const c of convs) for (const v of c.violations) {
    const r = byRule.get(v.rule) ?? { id: String(v.rule ?? ''), text: String(v.text ?? v.rule ?? ''), clause: String(v.clause ?? ''), severity: v.severity ?? 'medium', count: 0 };
    r.count++;
    byRule.set(v.rule, r);
  }
  const live = {
    months, checked: convs.length, flagged: convs.filter(c => c.status === 'flagged').length, unjudged: convs.filter(c => c.status === 'unjudged').length,
    topRules: [...byRule.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, TOP_RULES),
    files: files.length,
  };

  // The client's decisions on sign-off links, and every rule text checked in the period (for the framework map).
  const signed = signoffs(dir).filter(x => inRange(x.at)).map(x => ({ decision: x.decision, name: String(x.name ?? ''), note: String(x.note ?? ''), at: x.at, scanId: String(x.scanId ?? '') }));
  const ruleTexts = [...new Set(scans.flatMap(sc => (sc.rules ?? []).map(r => `${r.title ?? ''} ${r.rule ?? ''}`)))];

  const last = audit.entries.at(-1);
  return {
    range: { from, to }, generatedAt: now.toISOString(),
    checks, rechecks, fixes: fixEvents, timeToFix, live, signoffs: signed, ruleTexts, judge: judgeRecord(scans),
    // The policy files as they are now, and whether the latest check ran on that same version.
    policy: (() => { const fp = policyFingerprint(dir); const latest = all[0]; return fp ? { fingerprint: fp, checkedOnIt: Boolean(latest?.policyHash) && latest.policyHash === fp } : null; })(),
    audit: {
      ok: audit.verify.ok, brokenAt: audit.verify.brokenAt ?? null, reason: audit.verify.reason ?? '',
      count: audit.lines ?? audit.entries.length, inRange: audit.entries.filter(e => inRange(e.ts)).length,
      latest: last ? { seq: last.seq, ts: last.ts, hash: typeof last.hash === 'string' ? last.hash : null } : null,
    },
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const stamp = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${isoDay(d)} ${d.toISOString().slice(11, 16)} UTC`; };
const monthName = m => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

export function duration(ms) {
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 2 * DAY_MS) return `${(ms / 3_600_000).toFixed(1)} hours`;
  return `${(ms / DAY_MS).toFixed(1)} days`;
}

const STYLE = `${TOKENS}
body{background:var(--surface)}
main{max-width:860px;margin:0 auto;padding:48px 32px 64px}
.top{display:flex;justify-content:space-between;gap:16px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:28px;font-size:13px;color:var(--text-3)}
.top .brand{font-weight:600;color:var(--text);letter-spacing:-0.02em;font-size:15px}
h1{font-size:28px;letter-spacing:-0.03em}h2{font-size:17px;margin:36px 0 10px}
.lede{color:var(--text-2);margin-top:6px}
.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);border-radius:var(--r);margin-top:24px}
.facts div{padding:12px 14px;border-left:1px solid var(--line)}.facts div:first-child{border-left:0}
.facts b{display:block;font-size:20px;letter-spacing:-0.02em}.facts span{font-size:12.5px;color:var(--text-3)}
table{border:1px solid var(--line);border-radius:var(--r);border-collapse:separate;border-spacing:0;overflow:hidden;width:100%}
td,th{padding:9px 12px;text-align:left;vertical-align:top}td{font-size:13.5px}
.src{font-size:12.5px;color:var(--text-3);margin:6px 0 0}
.empty{color:var(--text-2);font-size:13.5px;border:1px dashed var(--line-strong);border-radius:var(--r);padding:12px 14px}
.chain{font-size:15px;font-weight:600;margin:4px 0}.chain.bad{color:var(--bad)}.chain.good{color:var(--good)}
.hash{font-family:var(--mono, monospace);font-size:12px;overflow-wrap:anywhere}
.method{color:var(--text-2);font-size:13.5px;line-height:1.6}.method li+li{margin-top:4px}
ul.rules{margin:4px 0 0;padding-left:18px;font-size:13px}
.foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--text-3)}
.print-hint{font-size:12.5px;color:var(--text-3)}
.snapshot{font-size:13px;color:var(--text-2);margin:14px 0 4px;padding:8px 12px;border:1px solid var(--line);border-radius:var(--r);background:var(--sunken)}
.recheck{border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;margin-top:10px;break-inside:avoid}
@media (max-width:640px){main{padding:28px 16px}.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.facts div:nth-child(3){border-left:0}table{display:block;overflow-x:auto}}
@media print{.print-hint{display:none}main{padding:0}body{background:#fff}}
`;

const EMPTY = '<p class="empty">No records in this period.</p>';
const src = text => `<p class="src">Source: ${text}</p>`;
const ruleList = list => (list.length ? `<ul class="rules">${list.map(r => `<li>${esc(r.text)}${r.clause ? ` <span class="subtle">(${esc(cl(r.clause))})</span>` : ''}</li>`).join('')}</ul>` : '');

// How often people overruled the AI judge on the answers in this period's checks. Every override is kept with who
// made it (overrides.json), so this is counted, not estimated. It covers answers someone chose to look at; it is
// not a random sample, so it bounds the judge's errors from below rather than measuring them.
export function judgeRecord(scans) {
  let judged = 0, falseAlarms = 0, misses = 0;
  for (const s of scans) for (const r of s.rules ?? []) for (const p of r.probes ?? []) {
    const verdict = p.judgeStatus ?? p.status;
    if (verdict !== 'kept' && verdict !== 'broken') continue;
    judged++;
    if (p.judgeStatus === 'broken' && p.status === 'kept') falseAlarms++;
    if (p.judgeStatus === 'kept' && p.status === 'broken') misses++;
  }
  return { judged, overturned: falseAlarms + misses, falseAlarms, misses };
}
function judgeSection(j) {
  if (!j?.judged) return '<p class="empty">No judged answers in this period.</p>';
  return `<p class="num">The AI judge gave <b>${j.judged}</b> verdicts in this period. People reviewed the findings and changed <b>${j.overturned}</b>${j.overturned ? `: ${j.falseAlarms} judged broken that a person marked kept, ${j.misses} judged kept that a person marked broken` : ''}.</p>
${src('verdicts in the checks above and the overrides recorded against them, each with who changed it and when. People look mostly at broken findings, so this is a floor on the judge’s errors, not a measured accuracy.')}`;
}

function signoffSection(list, checkRef) {
  if (!list.length) return '<p class="empty">No sign-off in this period. A sign-off link lets the client review a check and accept the agent or send it back, without an account.</p>';
  return `<table><thead><tr><th>Date</th><th>Decision</th><th>By</th><th>For check</th></tr></thead><tbody>
${list.map(x => `<tr><td class="nowrap">${esc(stamp(x.at))}</td><td><b>${x.decision === 'accepted' ? 'Accepted' : 'Sent back'}</b>${x.note ? `<br><span class="subtle">“${esc(x.note)}”</span>` : ''}</td><td>${esc(x.name)}</td><td>${checkRef(x.scanId)}</td></tr>`).join('\n')}
</tbody></table>${src('<code>signoff.json</code>, one record per decision given on a sign-off link, also written to the audit log as <code>signoff.accepted</code> or <code>signoff.declined</code>.')}`;
}

// The questions common AI frameworks ask, and which records in this pack answer them. A map for the reader, not a
// certification: each row says whether this period holds records for it, and names the section.
const DISCLOSURE = /disclos|\b(?:is|are|it's|as) an? (?:AI|virtual|automated)\b|not a (?:human|person)|tell[^.]{0,40}\bAI\b|\bAI\b[^.]{0,30}(?:identify|disclose)/i;
export function frameworkRows(data) {
  const checks = data.checks.length;
  const rechecks = data.rechecks.length;
  const approvals = data.fixes.filter(f => f.action !== 'fix.revert').length;
  const signed = (data.signoffs ?? []).length;
  const disclosure = (data.ruleTexts ?? []).some(t => DISCLOSURE.test(t));
  const has = (ok, yes, no) => ({ ok, text: ok ? yes : no });
  const s = n => (n === 1 ? '' : 's');
  return [
    ['ISO/IEC 42001:2023, Annex A.6.2.4', 'AI system verification and validation', 'Checks run; Breaks found and fixed',
      has(checks > 0, `${checks} check${s(checks)} against the written policies, ${rechecks} re-check${s(rechecks)} on the same messages.`, 'No check in this period.')],
    ['ISO/IEC 42001:2023, Annex A.6.2.6', 'AI system operation and monitoring', 'Live monitoring',
      has(data.live.checked > 0, `${data.live.checked} live conversation${s(data.live.checked)} judged against the same rules.`, 'No live conversations were checked in this period.')],
    ['ISO/IEC 42001:2023, Annex A.6.2.8', 'Recording of event logs', 'Audit chain',
      has(data.audit.count > 0 && data.audit.ok, 'Hash-linked audit log, verified intact when this pack was generated.', data.audit.count ? 'The audit log failed verification; see Audit chain.' : 'The audit log is empty.')],
    ['NIST AI RMF 1.0, Measure', 'AI risks are tested and evaluated, before deployment and in operation', 'Checks run; Live monitoring',
      has(checks > 0, 'Test messages written from each rule; every answer judged against the exact clause.', 'No check in this period.')],
    ['NIST AI RMF 1.0, Manage', 'Identified risks are prioritized and responded to', 'Approved fixes; Mean time to fix',
      has(approvals > 0, `${approvals} fix${approvals === 1 ? '' : 'es'} approved by a named person and re-tested.`, 'No fix approved in this period.')],
    ['AIUC-1, Reliability and Accountability', 'The agent is tested for failures, and changes are owned by named people', 'Checks run; Approved fixes; Client sign-off',
      has(checks > 0 && (approvals > 0 || signed > 0), 'Failures found by test, fixes approved by name, decisions recorded.', checks ? 'Checks ran, but no fix or sign-off is recorded in this period.' : 'No check in this period.')],
    ['EU AI Act, Article 14 (human oversight, high-risk systems)', 'People can oversee and correct the system', 'Approved fixes; Client sign-off',
      has(approvals > 0 || signed > 0, 'No change took effect without a named person approving it, and the client’s decision is recorded.', 'No approval or sign-off recorded in this period.')],
    ['EU AI Act, Article 50 (transparency)', 'People are told when they are talking to an AI', 'Checks run',
      has(disclosure, 'At least one checked rule covers telling the customer they are talking to an AI.', 'No checked rule covers this. Add the disclosure rule to the policies to have it tested.')],
  ];
}
function frameworkSection(data) {
  const rows = frameworkRows(data);
  return `<p class="lede" style="margin:0 0 10px">For reviewers who work from a framework: each row names what it asks and the section of this pack that holds the records. This is a map, not a certification or an audit opinion.</p>
<table><thead><tr><th>Framework</th><th>What it asks</th><th>In this pack</th><th>This period</th></tr></thead><tbody>
${rows.map(([fw, asks, where, st]) => `<tr><td>${esc(fw)}</td><td>${esc(asks)}</td><td class="subtle">${esc(where)}</td><td><b>${st.ok ? 'Records' : 'Gap'}</b><br><span class="subtle">${esc(st.text)}</span></td></tr>`).join('\n')}
</tbody></table>${src('the counts in the sections above. Framework names belong to their publishers; which controls apply to this AI is the reviewer’s decision.')}`;
}

// data: from buildEvidence; name: the AI agent; customer: whose AI (optional); org: the org name.
export function renderEvidence(data, { name, title: agent, customer, org } = {}) {
  const { range, checks, rechecks, fixes, timeToFix, live, audit } = data;
  const signed = data.signoffs ?? [];
  const title = `Evidence pack: ${agent || name}${customer ? ` for ${customer}` : ''}`;
  // People read "Check 2", not a timestamp id; the id stays beside it as the record reference.
  const num = new Map(checks.map((c, i) => [c.id, i + 1]));
  const checkRef = id => (num.has(id) ? `Check ${num.get(id)} <span class="hash subtle">${esc(id)}</span>` : `<span class="hash">${esc(id)}</span>`);
  const period = `${day(`${range.from}T00:00:00Z`)} to ${day(`${range.to}T00:00:00Z`)}`;
  const fixedRules = rechecks.reduce((n, r) => n + r.fixed.length, 0);
  const approvals = fixes.filter(f => f.action !== 'fix.revert').length;

  const checksTable = checks.length ? `<table><thead><tr><th>Date</th><th>Check</th><th>Rules</th><th>Broken</th><th>Re-check?</th></tr></thead><tbody>
${checks.map(c => `<tr><td class="nowrap">${esc(stamp(c.createdAt))}</td><td>${checkRef(c.id)}</td><td class="num">${c.rules}</td><td class="num">${c.broken}</td><td>${c.recheckOf ? `Yes, of ${num.has(c.recheckOf) ? `check ${num.get(c.recheckOf)}` : `<span class="hash">${esc(c.recheckOf)}</span>`}` : 'No'}</td></tr>`).join('\n')}
</tbody></table>${src(`${checks.length} check record${checks.length === 1 ? '' : 's'} in <code>scans/</code> created in this period. “Broken” counts rules with at least one test message judged as breaking them.`)}` : EMPTY;

  const recheckBlocks = rechecks.length ? rechecks.map(r => `<div class="recheck">
<p><b>${esc(stamp(r.createdAt))}</b> · ${checkRef(r.id)}, re-check of ${checkRef(r.of)}</p>
<p class="num">Rules broken before: <b>${r.beforeBroken ?? 'unknown'}</b> → after: <b>${r.afterBroken}</b>, on the same ${r.messages} test messages.</p>
${r.ofFound ? '' : '<p class="src">The earlier check is no longer in scans/, so the before count is unknown.</p>'}
${r.fixed.length ? `<p style="margin-top:6px">Fixed (${r.fixed.length}):</p>${ruleList(r.fixed)}` : ''}
${r.stillBroken.length ? `<p style="margin-top:6px">Still broken (${r.stillBroken.length}):</p>${ruleList(r.stillBroken)}` : ''}
${r.newlyBroken.length ? `<p style="margin-top:6px">Newly broken (${r.newlyBroken.length}):</p>${ruleList(r.newlyBroken)}` : ''}
</div>`).join('') + src('each re-check record (its <code>recheckOf</code> field) compared rule by rule with the check it repeated; a re-check sends the exact same messages again.') : EMPTY;

  const fixesTable = fixes.length ? `<table><thead><tr><th>Date</th><th>What happened</th><th>By</th><th>For check</th><th>Record</th></tr></thead><tbody>
${fixes.map(f => `<tr><td class="nowrap">${esc(stamp(f.at))}</td><td>${esc(FIX_ACTIONS[f.action])}${f.summary ? `<br><span class="subtle">${esc(f.summary)}</span>` : ''}${f.rules ? `<br><span class="subtle num">Covers ${f.rules} rule${f.rules === 1 ? '' : 's'}</span>` : ''}</td><td>${esc(f.actor.replace(/^human:/, ''))}</td><td>${checkRef(f.scanId)}</td><td>${f.source === 'audit' ? `Audit entry ${f.seq}` : '<b>fix.json only, no audit entry</b>'}</td></tr>`).join('\n')}
</tbody></table>${src('audit log entries <code>fix.apply</code>, <code>fix.applied_manually</code> and <code>fix.revert</code> in this period; summaries from <code>fix.json</code>, which keeps only the latest fix.')}` : EMPTY;

  const ttf = timeToFix.meanMs === null
    ? `<p class="empty">Not enough data: no rule broken in a check in this period was kept by a later re-check in this period.</p>`
    : `<p class="num">Mean time to fix: <b>${esc(duration(timeToFix.meanMs))}</b>, over ${timeToFix.samples.length} fixed rule${timeToFix.samples.length === 1 ? '' : 's'}.</p>
<table><thead><tr><th>Rule</th><th>Broken in check</th><th>Kept in re-check</th><th>Time</th></tr></thead><tbody>
${timeToFix.samples.map(f => `<tr><td>${esc(f.text)}</td><td class="nowrap">${esc(stamp(f.brokenAt))}</td><td class="nowrap">${esc(stamp(f.keptAt))}</td><td class="num nowrap">${esc(duration(f.ms))}</td></tr>`).join('\n')}
</tbody></table>`;
  const ttfSection = `${ttf}${timeToFix.stillOpen.length ? `<p style="margin-top:8px">Broken and not yet kept by a re-check in this period (${timeToFix.stillOpen.length}):</p>${ruleList(timeToFix.stillOpen)}` : ''}
${src('the timestamps of the checks above. For each rule, from the first check in this period that found it broken to the first later re-check that kept it on every message. Checks before the period are not counted.')}`;

  const liveSection = live.checked ? `<table><thead><tr><th>Month</th><th>Conversations checked</th><th>Broke a rule</th><th>Could not be judged</th></tr></thead><tbody>
${live.months.map(m => `<tr><td>${esc(monthName(m.month))}</td><td class="num">${m.checked}</td><td class="num">${m.flagged}</td><td class="num">${m.unjudged}</td></tr>`).join('\n')}
<tr><td><b>Total</b></td><td class="num"><b>${live.checked}</b></td><td class="num"><b>${live.flagged}</b></td><td class="num"><b>${live.unjudged}</b></td></tr>
</tbody></table>
${live.topRules.length ? `<h3 style="font-size:14px;margin:16px 0 6px">Most-broken rules</h3><table><thead><tr><th>Rule</th><th>Source</th><th>Times broken</th></tr></thead><tbody>
${live.topRules.map(r => `<tr><td>${esc(r.text)}</td><td class="subtle">${esc(cl(r.clause))}</td><td class="num">${r.count}</td></tr>`).join('\n')}
</tbody></table>` : '<p class="src">No conversation in this period broke a rule.</p>'}
${src('real conversations stored in <code>live/&lt;month&gt;.jsonl</code>, counted by the time the conversation happened. A conversation that broke two rules counts once in “Broke a rule” and once for each rule below it.')}` : EMPTY;

  const chain = audit.count === 0
    ? '<p class="empty">No records in this period. The audit log is empty.</p>'
    : `<p class="chain ${audit.ok ? 'good' : 'bad'}">${audit.ok ? 'Intact: every entry links to the one before it.' : `Broken at entry ${esc(String(audit.brokenAt))}: ${esc(audit.reason)}.`}</p>
<p class="num">${audit.count} entr${audit.count === 1 ? 'y' : 'ies'} in total, ${audit.inRange} in this period.</p>
${audit.latest ? `<p class="src">Latest entry: ${audit.latest.seq} at ${esc(stamp(audit.latest.ts))}${audit.latest.hash ? `, hash <span class="hash">${esc(audit.latest.hash)}</span>` : ''}</p>` : ''}
${src('<code>audit.jsonl</code>, re-verified when this pack was generated. Each entry stores the SHA-256 of its contents and of the entry before it, so editing or deleting an earlier entry breaks the chain from that point.')}`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>
<div class="top"><span class="brand">Grapim</span><span>${esc(period)}${org ? ` · Prepared by ${esc(org)}` : ''}</span></div>
<h1>${esc(title)}</h1>
<p class="lede">The record of how this AI was tested against the company’s written policies, what was fixed, and what live monitoring saw, from ${esc(period)}. Every figure is counted from stored records; nothing is estimated.</p>
<p class="snapshot">Snapshot generated ${esc(stamp(data.generatedAt))}${data.policy ? ` · policy files <span class="hash">${esc(data.policy.fingerprint.slice(0, 12))}</span>, ${data.policy.checkedOnIt ? 'the same version the latest check ran on' : '<b>changed since the latest check</b>'}` : ''}. Later checks are not included; generate it again for a newer record.</p>
<p class="print-hint">To save as PDF: Print (Ctrl+P or ⌘P), then Save as PDF.</p>
<div class="facts"><div><b class="num">${checks.length}</b><span>Checks run</span></div><div><b class="num">${fixedRules}</b><span>Broken rules fixed on re-check</span></div>
<div><b class="num">${approvals}</b><span>Fixes approved</span></div><div><b class="num">${live.checked}</b><span>Live conversations checked</span></div></div>
<h2>Checks run</h2>${checksTable}
<h2>Breaks found and fixed</h2>${recheckBlocks}
<h2>Approved fixes</h2>${fixesTable}
<h2>Mean time to fix</h2>${ttfSection}
<h2>The judge, checked by people</h2>${judgeSection(data.judge)}
<h2>Live monitoring</h2>${liveSection}
<h2>Client sign-off</h2>${signoffSection(signed, checkRef)}
<h2>Audit chain</h2>${chain}
<h2>Where this fits common AI frameworks</h2>${frameworkSection(data)}
<h2>How to read this</h2>
<ul class="method">
<li>A <b>check</b> sends test messages written from each policy rule to the AI and judges every answer against the exact clause. A rule is <b>broken</b> when at least one answer breaks it.</li>
<li>A <b>re-check</b> sends the same messages again after a fix, so before and after compare like for like.</li>
<li>A <b>fix</b> is a change to the AI’s instructions that a named person approved. A revert puts the earlier instructions back.</li>
<li><b>Live monitoring</b> judges real conversations after launch against the same rules. It is evidence, not a guarantee for every possible conversation.</li>
<li>The <b>audit chain</b> shows whether any record of these actions was changed after it was written.</li>
<li>All times are UTC. The period includes both end dates.</li>
</ul>
<p class="foot">Grapim evidence pack · ${esc(agent || name)} · period ${esc(range.from)} to ${esc(range.to)} · generated ${esc(stamp(data.generatedAt))}</p>
</main></body></html>
`;
}
