// Client sign-off: the client opens a link (src/v3/shares.mjs), reads the result of one check and the launch
// summary, and accepts the AI agent or sends it back with a reason. Decisions are kept in the deployment
// folder (signoff.json, newest last) and in its audit log; the page itself needs no Grapim account.

import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';
import { esc } from '../report.mjs';
import { layout, mark } from './html.mjs';

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

// The page the client sees. scan: the check the link was made for; done: a decision already given on this link.
export function signoffPage({ csrf, token, preparedBy, client, name, scan, launch, done, error, values = {} }) {
  const s = scan?.summary;
  const verdict = !s ? '' : s.broken
    ? `<div class="notice" role="status"><span>The check found <span class="strong">${s.broken} of ${s.rules} policy rules broken</span>. Read the findings before you accept.</span></div>`
    : `<div class="notice good" role="status"><span>The AI kept all ${s.rules} policy rules in this check${s.unjudged ? `; ${s.unjudged} answer${s.unjudged === 1 ? '' : 's'} need a person to review` : ''}.</span></div>`;
  const decided = done ? `<div class="notice ${done.decision === 'accepted' ? 'good' : ''}" role="status"><span>${done.decision === 'accepted' ? 'Accepted' : 'Sent back'} by ${esc(done.name)} on ${esc(done.at.slice(0, 10))}.${done.note ? ` Note: ${esc(done.note)}` : ''}</span></div>` : '';
  const form = done || !scan ? '' : `<form method="post" action="/signoff/${esc(token)}" novalidate><input type="hidden" name="csrf" value="${esc(csrf)}">
<label class="field"><span>Your name</span><input type="text" name="name" required maxlength="120" autocomplete="name" value="${esc(values.name ?? '')}"></label>
<div class="field"><span>Decision</span><div class="choice">
<label><input type="radio" name="decision" value="accepted"${values.decision === 'declined' ? '' : ' checked'}><span><span class="strong">Accept this AI agent</span></span></label>
<label><input type="radio" name="decision" value="declined"${values.decision === 'declined' ? ' checked' : ''}><span><span class="strong">Send it back</span><span class="hint" style="display:block;margin:2px 0 0">Say what must change in the note.</span></span></label></div></div>
<label class="field"><span>Note <span class="subtle" style="font-weight:400">(optional)</span></span><textarea name="note" maxlength="${MAX_NOTE}" rows="3">${esc(values.note ?? '')}</textarea></label>
<label class="check" style="display:flex;gap:8px;align-items:flex-start;margin:0 0 16px"><input type="checkbox" name="reuse" value="yes"${values.reuse ? ' checked' : ''}><span><span class="strong">Let ${esc(preparedBy)} reuse what it learned here</span><span class="hint" style="display:block;margin:2px 0 0">Test messages and the shape of the integration, with names, contact details, keys and order data removed, for its other rollouts. Only with “Accept”. Ask ${esc(preparedBy)} to remove it at any time.</span></span></label>
<button class="btn primary block" data-busy="Saving…">Record my decision</button></form>`;
  return layout({
    title: `Sign off ${name}`,
    body: `<div class="auth-card" style="max-width:640px">
<span class="brand">${mark(26, 'm-sign')}<span>Grapim</span></span>
<h1>Accept ${esc(name)}${client ? ` for ${esc(client)}` : ''}?</h1>
<p class="lede">${esc(preparedBy)} asks you to review this AI agent before it goes live. Grapim tested it against your own policies and judged every answer against the exact clause.</p>
${error ? `<div class="notice" role="alert"><span>${esc(error)}</span></div>` : ''}
${scan ? `${verdict}<p><a class="btn block" href="/signoff/${esc(token)}/report.html">Read the full check report</a></p>
<p class="subtle">Check from ${esc(scan.createdAt.slice(0, 10))} · ${s.rules} rules · ${s.probes} test messages</p>` : '<p>There is no check to review yet.</p>'}
${launch ? `<h2 style="margin:20px 0 6px">Launch summary</h2><div class="subtle" style="white-space:pre-wrap">${esc(launch)}</div>` : ''}
${decided}${form}
<p class="subtle" style="margin-top:16px">Your decision, name and note are recorded in this AI agent’s audit log and shown to ${esc(preparedBy)}.</p>
</div>`,
  });
}
