// The client's security and AI questionnaire, filled in from this agent's own records. Enterprise buyers send a
// spreadsheet of questions before launch; most AI-specific ones (how was it tested against our rules, who
// approves changes, is it monitored, is there an audit trail) Grapim can answer from what it recorded. Each
// answer says where it came from. Questions only the vendor can answer (certifications, hosting, data
// residency) are kept as the vendor's own text, saved per agent, and never filled in by Grapim.

import fs from 'node:fs';
import path from 'node:path';
import { readAudit, verifyAudit } from '../core/audit.mjs';
import { esc } from '../report.mjs';
import { listScans } from '../v1/risk.mjs';
import { getLiveSettings, countConversations } from '../v1/live.mjs';
import { monitorSettings } from './monitoring.mjs';
import { latestSignoff } from './signoff.mjs';
import { layout, mark } from './html.mjs';

const file = dir => path.join(dir, 'questionnaire.json');
const MAX_ANSWER = 2000;

// Questions the vendor answers. Keys are stable; the text is what the client's form usually asks.
export const VENDOR_QUESTIONS = [
  ['certifications', 'Which security certifications do you hold (SOC 2, ISO 27001, ISO 42001), and when was the last audit?'],
  ['hosting', 'Where is our data processed and stored, and for how long?'],
  ['models', 'Which AI models and subprocessors handle our customers’ conversations?'],
  ['pentest', 'When was the last penetration test, and can we run our own?'],
  ['ai_act', 'How is this AI system classified under the EU AI Act, and how is human oversight provided?'],
];

export function vendorAnswers(dir) {
  try { return JSON.parse(fs.readFileSync(file(dir), 'utf8')); } catch { return {}; }
}
export function saveVendorAnswers(dir, form) {
  const out = {};
  for (const [k] of VENDOR_QUESTIONS) { const v = String(form[k] ?? '').trim().slice(0, MAX_ANSWER); if (v) out[k] = v; }
  fs.writeFileSync(file(dir), JSON.stringify(out, null, 2) + '\n');
  return out;
}

const HANDOFF = /\bhuman\b|hand(?:s|ed)?[ -]?off|hand (?:it |the [a-z]+ )?(?:over|to)|escalat|transfer|a person\b|staff member|team member|route[sd]? to/i;
const brokenOf = r => (r.probes ?? []).some(p => p.status === 'broken');
const title = r => String(r.title || r.rule || '').trim();

// Rows: { section, question, answer, source: 'records' | 'vendor' }.
export function buildQuestionnaire(dir, { now = new Date() } = {}) {
  const scans = listScans(dir);
  const scan = scans[0] ?? null;
  const rules = scan?.rules ?? [];
  const broken = rules.filter(brokenOf);
  const messages = rules.reduce((n, r) => n + (r.probes?.length ?? 0), 0);
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'inputs')).filter(f => !f.startsWith('.')); } catch { /* none */ }
  const docs = files.filter(f => !f.toLowerCase().endsWith('.csv'));
  const cited = docs.filter(f => rules.some(r => String(r.clause ?? '').includes(f)));
  const policies = cited.length ? cited : docs;
  const tickets = files.filter(f => f.toLowerCase().endsWith('.csv'));
  const audit = readAudit(dir);
  const chain = verifyAudit(dir);
  const approvals = audit.filter(e => e.action === 'fix.apply' || e.action === 'fix.applied_manually');
  const approvers = [...new Set(approvals.map(e => String(e.actor).replace(/^human:/, '')))];
  const autoUndo = audit.filter(e => e.action === 'fix.revert' && e.actor === 'grapim').length;
  // What the rule itself requires (its title and rule), not the surrounding policy text it quotes.
  const handoff = rules.filter(r => HANDOFF.test(`${r.title ?? ''} ${r.rule ?? ''}`));
  const monitor = monitorSettings(dir);
  const webhook = Boolean(getLiveSettings(dir).webhook);
  const month = now.toISOString().slice(0, 7);
  const live = countConversations(dir, month);
  const signoff = latestSignoff(dir);
  const day = iso => String(iso ?? '').slice(0, 10);
  const vendor = vendorAnswers(dir);
  const rec = (section, question, answer) => ({ section, question, answer, source: 'records' });

  const rows = [
    rec('Testing', 'How was the AI agent tested against our policies before launch?', scan
      ? `Grapim read ${policies.length ? policies.join(', ') : 'the policy documents'}, wrote ${messages} test messages aimed at breaking ${rules.length} rules, sent them to the agent and judged every answer against the exact clause. Latest check: ${day(scan.createdAt)}, ${rules.length - broken.length} of ${rules.length} rules kept. ${scans.length} check${scans.length === 1 ? '' : 's'} on record.`
      : 'No check has been run yet.'),
    rec('Testing', 'Which of our rules does it break today?', !scan ? 'No check has been run yet.'
      : broken.length ? `${broken.length} in the check on ${day(scan.createdAt)}: ${broken.map(title).join('; ')}.` : `None in the check on ${day(scan.createdAt)}.`),
    rec('Change control', 'How are problems fixed, and who approves a change?', `The agent drafts each fix; a named person reviews and approves it before it takes effect, and the same test messages are sent again. A fix applied by Grapim that makes the result worse is undone automatically.${approvals.length ? ` ${approvals.length} approved fix${approvals.length === 1 ? '' : 'es'} on record, by ${approvers.join(', ')}.` : ' No fix approved yet.'}${autoUndo ? ` ${autoUndo} undone automatically.` : ''}`),
    rec('Change control', 'How are changes to our policies or to the agent tested before customers see them?', `After the first check, uploading a changed policy starts a full check by itself.${monitor.enabled ? ` Scheduled re-checks are on: the saved test messages run again at least every ${monitor.intervalHours} hours and whenever the agent’s connection or tests change${monitor.versionUrl ? ', or the model version it reports changes' : ''}.` : ' Scheduled re-checks are off.'}`),
    rec('Human oversight', 'When does the agent hand a conversation to a person?', handoff.length
      ? `${handoff.length} rule${handoff.length === 1 ? '' : 's'} from your policies ${handoff.length === 1 ? 'covers' : 'cover'} hand-offs: ${handoff.map(r => `${title(r)} (${brokenOf(r) ? 'broken' : 'kept'} in the latest check)`).join('; ')}.`
      : 'None of the checked rules mention handing over to a person. Add the hand-off rule to the policies to have it tested.'),
    rec('Monitoring', 'Is the agent monitored after launch, and how are incidents raised?', `${live ? `${live} live conversation${live === 1 ? '' : 's'} checked against the same rules this month.` : 'No live conversations checked this month yet.'} ${webhook ? 'A broken high-risk rule posts an alert to the team’s webhook.' : 'No alert webhook is set yet.'}`),
    rec('Data handling', 'What data does the testing use, and how is personal data handled?', `The test messages are written from the policy documents${tickets.length ? `; ${tickets.length} ticket export${tickets.length === 1 ? '' : 's'} (${tickets.join(', ')}) shaped their style` : ''}. Live conversations are scrubbed of emails, phone numbers, card numbers and keys before they are stored or judged.`),
    rec('Audit', 'Is there an audit trail of tests, changes and approvals?', chain.ok
      ? `Yes. ${chain.count} entries, each linked to the one before by a hash; verified intact on ${day(now.toISOString())}.`
      : `The audit trail failed verification at entry ${chain.brokenAt} (${chain.reason}).`),
    rec('Sign-off', 'Has our team reviewed and accepted the agent?', signoff ? `${signoff.decision === 'accepted' ? 'Accepted' : 'Sent back'} by ${signoff.name} on ${day(signoff.at)}${signoff.note ? `: “${signoff.note}”` : ''}.` : 'Not yet. A sign-off link lets your team review the check without an account.'),
    ...VENDOR_QUESTIONS.map(([k, q]) => ({ section: 'Vendor', key: k, question: q, answer: vendor[k] ?? '', source: 'vendor' })),
  ];
  return rows;
}

const csvCell = v => /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
export function questionnaireCsv(rows) {
  const lines = [['Section', 'Question', 'Answer', 'Source'], ...rows.map(r => [r.section, r.question, r.answer || '(to be answered by the vendor)', r.source === 'records' ? 'Grapim records' : 'Vendor'])];
  return '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function questionnairePage({ rows, preparedBy, client, name, csrf, canEdit, action, back, saved }) {
  const group = rows.reduce((m, r) => (m.get(r.section) ?? m.set(r.section, []).get(r.section)).push(r) && m, new Map());
  const filled = rows.filter(r => r.source === 'records').length;
  const open = rows.filter(r => r.source === 'vendor' && !r.answer).length;
  const block = ([section, list]) => section === 'Vendor'
    ? `<h2>Answered by ${esc(preparedBy)}</h2><p class="subtle">Grapim does not know these. Write them once for this agent; they go into the download too.</p>
${canEdit ? `<form method="post" action="${esc(action)}" class="qn-form"><input type="hidden" name="csrf" value="${esc(csrf)}">${list.map(r => `<label class="field"><span>${esc(r.question)}</span><textarea name="${esc(r.key)}" rows="2" style="min-height:64px" maxlength="${MAX_ANSWER}">${esc(r.answer)}</textarea></label>`).join('')}<button class="btn" data-busy="Saving…">Save answers</button></form>`
      : `<dl class="qn">${list.map(r => `<dt>${esc(r.question)}</dt><dd>${r.answer ? esc(r.answer) : '<span class="subtle">Not answered yet.</span>'}</dd>`).join('')}</dl>`}`
    : `<h2>${esc(section)}</h2><dl class="qn">${list.map(r => `<dt>${esc(r.question)}</dt><dd>${esc(r.answer)}<span class="qn-src">From Grapim’s records</span></dd>`).join('')}</dl>`;
  return layout({
    title: `Security questionnaire · ${name}`,
    body: `<style>.qn{margin:10px 0 0;display:grid;gap:14px}.qn dt{font-weight:600}.qn dd{margin:4px 0 0;color:var(--text-2);line-height:1.6}.qn-src{display:block;margin-top:2px;font-size:12px;color:var(--text-3)}
.qn-wrap h2{margin:30px 0 4px;font-size:17px}.qn-form{display:grid;gap:12px;margin-top:12px}.qn-form .field{margin:0}@media print{.no-print,.qn-form button{display:none!important}}</style>
<div class="auth-card qn-wrap" style="max-width:760px">
<span class="brand">${mark(26, 'm-qn')}<span>Grapim</span></span>
<h1>Security and AI questionnaire</h1>
<p class="lede">${esc(preparedBy)}’s AI agent${client ? ` for ${esc(client)}` : ''}. ${filled} answers come from this agent’s own records; ${open ? `${open} still need${open === 1 ? 's' : ''} ${esc(preparedBy)}’s answer` : `the vendor questions are answered`}.</p>
${saved ? '<div class="notice good" role="status"><span>Answers saved.</span></div>' : ''}
<p class="no-print" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><a class="btn primary" href="${esc(action)}.csv">Download as a spreadsheet (CSV)</a>${back ? `<a class="btn" href="${esc(back)}">Back</a>` : ''}</p>
${[...group].map(block).join('\n')}
</div>`,
  });
}
