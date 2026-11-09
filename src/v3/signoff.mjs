// Client sign-off: the client opens a link (src/v3/shares.mjs), reads the result of one check and the launch
// summary, and accepts the AI agent or sends it back with a reason. Decisions are kept in the deployment
// folder (signoff.json, newest last) and in its audit log; the page itself needs no Grapim account.

import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';
import { esc } from '../report.mjs';
import { layout, mark, possessive } from './html.mjs';
import { handoverSection, HANDOVER_STYLE } from './handover.mjs';
import { reviewPanel, reviewProgress } from './review.mjs';

const file = dir => path.join(dir, 'signoff.json');
const MAX_NOTE = 1000;

export function signoffs(dir) {
  try { return JSON.parse(fs.readFileSync(file(dir), 'utf8')); } catch { return []; }
}
export const latestSignoff = dir => signoffs(dir).at(-1) ?? null;

// decision: 'accepted' | 'declined'. Returns the stored record.
export function recordSignoff(dir, { decision, name, note = '', scanId, shareId, ip = '' }, now = new Date()) {
  if (!['accepted', 'declined'].includes(decision)) throw new Error('decision must be accepted or declined');
  const record = {
    decision, name: String(name).trim().slice(0, 120), note: String(note ?? '').trim().slice(0, MAX_NOTE),
    scanId, shareId, at: now.toISOString(),
  };
  const all = signoffs(dir);
  all.push(record);
  fs.writeFileSync(file(dir), JSON.stringify(all, null, 2) + '\n');
  appendAudit(dir, { actor: `client:${record.name}`, action: `signoff.${decision}`, target: scanId, detail: { share: shareId, note: record.note, ip } }, now);
  return record;
}

// How the check on a link came about: when it is a re-check, the check it repeated, what broke there, and the fix a
// named person approved in between. Null for a first check. Read from scans/ and fix.json; nothing estimated.
export function checkHistory(dir, scan, { getScan, getFix }) {
  if (!scan?.recheckOf) return null;
  const before = getScan(dir, scan.recheckOf);
  if (!before) return null;
  const brokenRules = (before.rules ?? []).filter(r => (r.probes ?? []).some(p => p.status === 'broken'));
  const fix = getFix(dir);
  const approved = fix && fix.scanId === before.id && fix.approvedAt ? { by: String(fix.approvedBy ?? '').replace(/^human:/, ''), at: fix.approvedAt } : null;
  return {
    before: { at: before.createdAt, rules: (before.rules ?? []).length, broken: brokenRules.length, titles: brokenRules.map(r => String(r.title || r.rule || r.id)) },
    fix: approved,
    after: { at: scan.createdAt, rules: scan.summary?.rules ?? 0, broken: scan.summary?.broken ?? 0, messages: scan.summary?.probes ?? 0 },
  };
}

function historySection(h, preparedBy) {
  if (!h || !h.before.broken) return '';
  const d = iso => esc(String(iso ?? '').slice(0, 10));
  return `<section class="so-history" aria-label="How this check came about"><h2 style="margin:0 0 10px;font-size:15px">How it got here</h2><ol>
<li><span class="so-dot bad"></span><div><p class="strong">First check, ${d(h.before.at)}: ${h.before.broken} of ${h.before.rules} rules broken</p><p class="subtle">${h.before.titles.map(esc).join(' · ')}</p></div></li>
<li><span class="so-dot"></span><div><p class="strong">Fix approved${h.fix ? ` by ${esc(h.fix.by)}, ${d(h.fix.at)}` : ''}</p><p class="subtle">${esc(preparedBy)} changed the agent’s instructions for the broken rules. Nothing changed until a person approved it.</p></div></li>
<li><span class="so-dot good"></span><div><p class="strong">Re-check, ${d(h.after.at)}: ${h.after.broken ? `${h.after.broken} of ${h.after.rules} rules still broken` : `all ${h.after.rules} rules kept`}</p><p class="subtle">The same ${h.after.messages} test messages, sent again.</p></div></li>
</ol></section>`;
}

// Questions on this link, and a form to ask one about a rule. rules: [{ id, title }] from the check.
function questionsSection({ token, csrf, preparedBy, rules, questions = [], qValues = {}, qError = '', asked = false }) {
  const list = questions.length ? `<ul class="so-qs">${questions.map(q => `<li><p class="subtle" style="margin:0 0 2px">${esc(q.name)}${q.ruleTitle ? ` on <span class="strong">${esc(q.ruleTitle)}</span>` : ''} · ${esc(q.at.slice(0, 10))}</p><p style="margin:0">${esc(q.text)}</p>
${q.answer ? `<div class="so-ans"><p class="subtle" style="margin:0 0 2px">${esc(q.answeredBy || preparedBy)} at ${esc(preparedBy)} · ${esc(q.answeredAt.slice(0, 10))}</p><p style="margin:0">${esc(q.answer)}</p></div>` : `<p class="subtle" style="margin:6px 0 0">Waiting for ${esc(possessive(preparedBy))} answer.</p>`}</li>`).join('')}</ul>` : '';
  const opts = rules.map(r => `<option value="${esc(r.id)}"${qValues.rule === r.id ? ' selected' : ''}>${esc(r.title)}</option>`).join('');
  return `<section id="ask" class="so-ask"><h2 style="margin:0 0 4px;font-size:15px">Questions for ${esc(preparedBy)}</h2>
<p class="subtle" style="margin:0 0 12px">Ask about one rule before you decide. The answer appears here, on this link.</p>
${asked ? `<div class="notice good" role="status"><span>Question sent to ${esc(preparedBy)}.</span></div>` : ''}${qError ? `<div class="notice" role="alert"><span>${esc(qError)}</span></div>` : ''}${list}
<form method="post" action="/signoff/${esc(token)}/question" novalidate><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>About</span><select name="rule"><option value="">The agent in general</option>${opts}</select></label>
<label class="field"><span>Your question</span><textarea name="text" maxlength="1000" rows="3" required>${esc(qValues.text ?? '')}</textarea></label>
<label class="field"><span>Your name</span><input type="text" name="name" required maxlength="120" autocomplete="name" value="${esc(qValues.name ?? '')}"></label>
<button class="btn" data-busy="Sending…">Send question</button></form></section>`;
}

// After an accepted sign-off: what the client keeps, and how to ask its other AI vendors for the same record. The
// client owns the record; the ask goes out by the client's own email, written here so it is one click to send.
function afterAccept({ token, preparedBy, client }) {
  const subject = 'The policy record we got for our AI agent';
  const body = `Hello,

Before ${preparedBy}'s AI agent went live for ${client || 'us'}, we received a record of how it was checked against our own written policies: every rule, the test messages, what broke, the fix someone approved by name, the re-check, and our sign-off.

Could you give us the same record for the AI agent you run for us, before your next change goes live?

Thanks`;
  return `<section class="so-after" aria-label="What you can do with this record"><h2 style="margin:0 0 10px;font-size:15px">What you keep</h2>
<ul><li><a href="/signoff/${esc(token)}/handover">The handover page</a>: the rules this agent keeps, and what happens when a policy changes.</li><li><a href="/signoff/${esc(token)}/report.html">The full check report</a>: every test message, answer and verdict. Print it or save it as a PDF.</li><li>This link stays readable for 30 days; your decision is in the agent’s audit log for good.</li></ul>
<h2 style="margin:18px 0 6px;font-size:15px">Other AI vendors working for ${esc(client || 'you')}?</h2>
<p class="subtle" style="margin:0 0 12px">Ask them for the same record: their agent checked against your policies, every fix approved by a named person, and your sign-off.</p>
<a class="btn" href="mailto:?subject=${encodeURIComponent(subject)}&amp;body=${encodeURIComponent(body)}">Write to another vendor</a> <a class="btn" href="/?ref=signoff">How this works</a></section>`;
}

const SIGNOFF_STYLE = `.so-history{margin:0 0 24px;padding:16px 18px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
.so-history ol{list-style:none;margin:0;padding:0;display:grid;gap:12px}.so-history li{display:grid;grid-template-columns:14px 1fr;gap:10px;align-items:start}.so-history li p{margin:0}
.so-dot{width:10px;height:10px;margin-top:6px;border-radius:50%;background:var(--accent)}.so-dot.bad{background:var(--bad)}.so-dot.good{background:var(--good)}
.so-after{margin:16px 0 0;padding:20px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}.so-after ul{margin:0;padding-left:18px;display:grid;gap:6px;font-size:14px;color:var(--text-2)}.choice label.off{opacity:.6}.so-ask{margin-top:16px;padding:20px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface);scroll-margin-top:16px}.so-ask textarea{min-height:76px}.so-qs{list-style:none;margin:0 0 16px;padding:0;display:grid;gap:12px}
.so-qs li{padding:12px 14px;border:1px solid var(--line);border-radius:var(--r)}.so-ans{margin-top:10px;padding:10px 12px;border-radius:calc(var(--r) - 2px);background:var(--sunken)}`;

// The page the client sees. scan: the check the link was made for; done: a decision already given on this link.
export function signoffPage({ csrf, token, preparedBy, client, name, title: agent = '', scan, launch, done, error, values = {}, handover = null, sender = '', history = null, questions = [], qValues, qError, asked, review = { name: '', rules: {} }, waiver = null }) {
  const s = scan?.summary;
  const verdict = !s ? '' : s.broken
    ? `<div class="notice" role="status"><span>The check found <span class="strong">${s.broken} of ${s.rules} policy rules broken</span>. Read the findings before you accept.</span></div>`
    : `<div class="notice good" role="status"><span>The AI kept all ${s.rules} policy rules in this check${s.unjudged ? `; ${s.unjudged} answer${s.unjudged === 1 ? '' : 's'} need a person to review` : ''}.</span></div>`;
  const decided = done ? `<div class="notice ${done.decision === 'accepted' ? 'good' : ''}" role="status"><span>${done.decision === 'accepted' ? 'Accepted' : 'Sent back'} by ${esc(done.name)} on ${esc(done.at.slice(0, 10))}.${done.note ? ` Note: ${esc(done.note)}` : ''}</span></div>` : '';
  // Accept opens once every rule was reviewed on this link; sending it back is always possible.
  const prog = reviewProgress(review, scan);
  const canAccept = prog.complete;
  const pick = values.decision ?? (canAccept ? 'accepted' : '');
  const form = done || !scan ? '' : `<form method="post" action="/signoff/${esc(token)}" novalidate><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>Your name</span><input type="text" name="name" required maxlength="120" autocomplete="name" value="${esc(values.name ?? review.name ?? '')}"></label>
<div class="field"><span>Decision</span><div class="choice">
<label${canAccept ? '' : ' class="off"'}><input type="radio" name="decision" value="accepted"${canAccept ? (pick === 'accepted' ? ' checked' : '') : ' disabled'}><span><span class="strong">Accept this AI agent</span>${canAccept ? '' : `<span class="hint" style="display:block;margin:2px 0 0">Opens once you have reviewed every rule (${prog.done} of ${prog.total} so far).</span>`}</span></label>
<label><input type="radio" name="decision" value="declined"${pick === 'declined' ? ' checked' : ''}><span><span class="strong">Send it back</span><span class="hint" style="display:block;margin:2px 0 0">Say what must change in the note.</span></span></label></div></div>
<label class="field"><span>Note <span class="subtle" style="font-weight:400">(optional)</span></span><textarea name="note" maxlength="${MAX_NOTE}" rows="3">${esc(values.note ?? '')}</textarea></label>
<label class="check" style="display:flex;gap:8px;align-items:flex-start;margin:0 0 16px"><input type="checkbox" name="reuse" value="yes"${values.reuse ? ' checked' : ''}><span><span class="strong">Let ${esc(preparedBy)} reuse what it learned here</span><span class="hint" style="display:block;margin:2px 0 0">Test messages and the shape of the integration, with names, contact details, keys and order data removed, for its other rollouts. Only with “Accept”. Ask ${esc(preparedBy)} to remove it at any time.</span></span></label>
<button class="btn primary block" data-busy="Saving…">Record my decision</button></form>`;
  // The ask and the decision come first; the handover detail (what to keep) follows the form.
  return layout({
    title: `Sign off ${agent || name}${client ? ` for ${client}` : ''}`,
    body: `<div class="auth-card" style="max-width:640px">
<span class="brand">${mark(26, 'm-sign')}<span>Grapim</span></span>
<h1>Accept ${esc(possessive(preparedBy))} AI agent${client ? ` for ${esc(client)}` : ''}?</h1>
<p class="lede">${esc(preparedBy)} asks you to review this AI agent before it goes live. Grapim tested it against your own policies and judged every answer against the exact clause.</p>
${sender ? `<p class="subtle" style="margin:-6px 0 16px">Sent by <a href="mailto:${esc(sender)}">${esc(sender)}</a> at ${esc(preparedBy)}</p>` : ''}
${error ? `<div class="notice" role="alert"><span>${esc(error)}</span></div>` : ''}
${scan && waiver ? `<div class="notice" role="note" style="margin-bottom:10px"><span><span class="strong">Sent while ${waiver.rules.length} high-risk rule${waiver.rules.length === 1 ? ' was' : 's were'} still broken</span> (${esc(waiver.rules.join('; '))}). ${esc(String(waiver.by).replace(/^human:/, ''))} at ${esc(preparedBy)} wrote: “${esc(waiver.reason)}”</span></div>` : ''}${scan ? `${verdict}<p class="subtle" style="margin:8px 0 12px">Check from ${esc(scan.createdAt.slice(0, 10))} · ${s.rules} rules · ${s.probes} test messages</p>
<div class="row-inline" style="gap:8px;flex-wrap:wrap;margin-bottom:24px">${form ? `<a class="btn${canAccept ? ' primary' : ''}" href="#decide">Decide</a>` : ''}<a class="btn" href="/signoff/${esc(token)}/report.html">Read the full check report</a>${handover ? `<a class="btn" href="/signoff/${esc(token)}/handover">Handover page</a>` : ''}<a class="btn" href="#ask">Ask a question</a></div>
<style>${SIGNOFF_STYLE}</style>${done ? '' : reviewPanel({ token, scan, review })}${historySection(history, preparedBy)}` : '<p>There is no check to review yet.</p>'}
${decided}${done?.decision === 'accepted' ? `<style>${SIGNOFF_STYLE}</style>${afterAccept({ token, preparedBy, client })}` : ''}${form ? `<section id="decide" class="signoff-decide"><h2 style="margin:0 0 12px">Your decision</h2>${form}<p class="subtle" style="margin-top:12px">Your decision, name and note are recorded in this AI agent’s audit log and shown to ${esc(preparedBy)}.</p></section>` : ''}
${scan ? questionsSection({ token, csrf, preparedBy, rules: (scan.rules ?? []).map(r => ({ id: String(r.id), title: String(r.title || r.rule || r.id).slice(0, 90) })), questions, qValues, qError, asked }) : ''}
${launch ? `<h2 style="margin:28px 0 6px">Launch summary</h2><div class="subtle" style="white-space:pre-wrap">${esc(launch)}</div>` : ''}
${handover && scan ? `<style>${HANDOVER_STYLE}</style><div style="margin-top:28px">${handoverSection(handover)}</div><p style="margin:16px 0 0"><a class="btn block" href="/signoff/${esc(token)}/handover">Open the handover page to keep</a></p>` : ''}
</div>`,
  });
}

// What a client sees on a sign-off link that was revoked or has expired: what happened and who to ask, never a
// bare 404. reason: 'revoked' | 'expired'. contact: the email of the person who made the link, when known.
export function signoffGonePage({ reason, preparedBy, client, contact = '' }) {
  const what = reason === 'revoked' ? `${preparedBy} replaced or withdrew this link` : 'This link has expired';
  const ask = contact ? `<a href="mailto:${esc(contact)}">${esc(contact)}</a> at ${esc(preparedBy)}` : esc(preparedBy);
  return layout({
    title: 'Sign-off link closed',
    body: `<div class="auth-card" style="max-width:520px">
<span class="brand">${mark(26, 'm-sign')}<span>Grapim</span></span>
<h1>${esc(what)}.</h1>
<p class="lede">It opened the review of ${esc(possessive(preparedBy))} AI agent${client ? ` for ${esc(client)}` : ''}. Sign-off links close when they are withdrawn or after 30 days, so an old link cannot be used to sign off on an out-of-date check.</p>
<p>Ask ${ask} for a new link.</p>
</div>`,
  });
}
