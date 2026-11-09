// The client's guided review on a sign-off link: one rule per screen (the pattern of DocuSign's Start, Next,
// Finish), each marked "Looks right" or asked about, before "Accept" opens. The client is not a power user, so a
// short path through the rules is faster and leaves a better record than a long report: the audit log says which
// rules the client reviewed, not only that they clicked accept. Works without JavaScript.
//
// Stored per link in reviews.json in the deployment folder: { [shareId]: { name, rules: { [ruleId]: { state, at } } } }.

import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';
import { esc } from '../report.mjs';
import { layout, mark, possessive } from './html.mjs';

const file = dir => path.join(dir, 'reviews.json');
const readAll = dir => { try { const x = JSON.parse(fs.readFileSync(file(dir), 'utf8')); return x && typeof x === 'object' ? x : {}; } catch { return {}; } };

export function reviewOf(dir, shareId) {
  const r = readAll(dir)[shareId];
  return { name: r?.name ?? '', rules: r?.rules ?? {} };
}

// state: 'ok' (looks right) | 'asked' (a question was sent about it). Re-marking a rule replaces its state.
export function markRule(dir, { shareId, scanId, ruleId, state, name, ip = '' }, now = new Date()) {
  if (!['ok', 'asked'].includes(state)) throw new Error('state must be ok or asked');
  const all = readAll(dir);
  const r = all[shareId] ?? { name: '', rules: {} };
  if (name) r.name = String(name).trim().slice(0, 120);
  r.rules[ruleId] = { state, at: now.toISOString() };
  all[shareId] = r;
  fs.writeFileSync(file(dir), JSON.stringify(all, null, 2) + '\n');
  appendAudit(dir, { actor: `client:${r.name || 'sign-off link'}`, action: 'signoff.review', target: scanId, detail: { rule: ruleId, state, share: shareId, ip } }, now);
  return r;
}

// How far the review is, against the rules of the check the link opens.
export function reviewProgress(review, scan) {
  const ids = (scan?.rules ?? []).map(r => String(r.id));
  const done = ids.filter(id => review.rules[id]);
  const next = ids.findIndex(id => !review.rules[id]);
  return { total: ids.length, done: done.length, complete: ids.length > 0 && done.length === ids.length, next: next < 0 ? null : next + 1, asked: done.filter(id => review.rules[id].state === 'asked').length };
}

const isBroken = r => (r.probes ?? []).some(p => p.status === 'broken');

const STYLE = `.rv{max-width:640px}.rv-top{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 0 8px;font-size:13px;color:var(--text-2)}
.rv-bar{height:4px;border-radius:4px;background:var(--line);overflow:hidden;margin-bottom:22px}.rv-bar i{display:block;height:100%;background:var(--accent);transition:width .3s cubic-bezier(0,.4,0,1)}
.rv-dots{display:flex;gap:4px;flex-wrap:wrap}.rv-dots a{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:600;border:1px solid var(--line);color:var(--text-3)}
.rv-dots a.ok{background:color-mix(in srgb,var(--good) 16%,transparent);border-color:color-mix(in srgb,var(--good) 45%,var(--line));color:var(--good)}
.rv-dots a.asked{background:color-mix(in srgb,var(--accent) 14%,transparent);border-color:color-mix(in srgb,var(--accent) 45%,var(--line));color:var(--accent)}
.rv-dots a.now{outline:2px solid var(--text);outline-offset:1px}.rv-dots a:hover{text-decoration:none}
.rv-card{padding:22px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
.rv-card h1{font-size:22px;letter-spacing:-0.02em;margin:6px 0 10px;text-align:left}.rv-k{font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--text-3);text-transform:uppercase;margin:0}
.rv-quote{margin:0 0 16px;padding:10px 14px;border-left:3px solid var(--line-strong);color:var(--text-2);font-size:14.5px;line-height:1.55}.rv-quote cite{display:block;font-style:normal;font-size:12px;color:var(--text-3);margin-bottom:4px}
.rv-res{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin:0 0 14px;font-size:14px}
.rv-ex{display:grid;gap:8px;margin:0 0 6px}.rv-ex .cap{font-size:12px;color:var(--text-3);margin:0 0 3px}.rv-ex .bubble{font-size:14px}
.rv-amb{margin:14px 0 0;padding:10px 12px;border-radius:calc(var(--r) - 2px);background:color-mix(in srgb,var(--warn) 12%,transparent);font-size:13.5px}
.rv-hist{margin:14px 0 0;padding:10px 12px;border-radius:calc(var(--r) - 2px);background:var(--sunken);font-size:13.5px;color:var(--text-2)}
.rv-acts{display:grid;gap:12px;margin-top:20px}.rv-acts .row-inline{gap:8px}.rv-ask summary{cursor:pointer;color:var(--text-2);font-size:14px}
.rv-qs{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}.rv-qs li{padding:10px 12px;border:1px solid var(--line);border-radius:var(--r);font-size:13.5px}.rv-qs .so-ans{margin-top:8px;padding:8px 10px;border-radius:6px;background:var(--sunken)}
@media (prefers-reduced-motion:reduce){.rv-bar i{transition:none}}`;

// One rule of the check on its own screen. n: 1-based position; questions: this link's questions about the rule.
export function reviewStepPage({ token, csrf, preparedBy, client, title = '', name, scan, n, review, questions = [], before = null, error = '' }) {
  const rules = scan.rules ?? [];
  const rule = rules[n - 1];
  const prog = reviewProgress(review, scan);
  const mine = review.rules[String(rule.id)];
  const kept = !isBroken(rule);
  const show = rule.probes.find(p => p.status === 'broken') ?? rule.probes[0];
  const nBroke = rule.probes.filter(p => p.status === 'broken').length;
  const wasBroken = before && isBroken(before);
  const dots = rules.map((r, i) => { const st = review.rules[String(r.id)]?.state; return `<a href="/signoff/${esc(token)}/review/${i + 1}" class="${st ?? ''}${i + 1 === n ? ' now' : ''}" aria-label="Rule ${i + 1}${st === 'ok' ? ', looks right' : st === 'asked' ? ', asked about' : ''}"${i + 1 === n ? ' aria-current="step"' : ''}>${i + 1}</a>`; }).join('');
  const qs = questions.length ? `<ul class="rv-qs">${questions.map(q => `<li><span class="subtle">${esc(q.name)} · ${esc(q.at.slice(0, 10))}</span><br>${esc(q.text)}${q.answer ? `<div class="so-ans"><span class="subtle">${esc(q.answeredBy || preparedBy)} at ${esc(preparedBy)}</span><br>${esc(q.answer)}</div>` : `<br><span class="subtle">Waiting for ${esc(possessive(preparedBy))} answer.</span>`}</li>`).join('')}</ul>` : '';
  const hidden = `<input type="hidden" name="csrf" value="${esc(csrf)}"><input type="hidden" name="rule" value="${esc(rule.id)}">`;
  const nameField = review.name ? `<input type="hidden" name="name" value="${esc(review.name)}">` : `<label class="field"><span>Your name</span><input type="text" name="name" required maxlength="120" autocomplete="name"></label>`;
  return layout({
    title: `Rule ${n} of ${rules.length} · Sign off ${title || name}${client ? ` for ${client}` : ''}`,
    body: `<style>${STYLE}</style><div class="auth-card rv">
<span class="brand">${mark(26, 'm-rv')}<span>Grapim</span></span>
<div class="rv-top"><span>Review for ${esc(client || name)} · rule ${n} of ${rules.length}</span><a href="/signoff/${esc(token)}">Back to the summary</a></div>
<div class="rv-bar" role="progressbar" aria-label="Rules reviewed" aria-valuemin="0" aria-valuemax="${prog.total}" aria-valuenow="${prog.done}"><i style="width:${prog.total ? Math.round(100 * prog.done / prog.total) : 0}%"></i></div>
${error ? `<div class="notice" role="alert"><span>${esc(error)}</span></div>` : ''}
<section class="rv-card" aria-labelledby="rv-h">
<p class="rv-k">Rule ${n}</p><h1 id="rv-h">${esc(String(rule.title || rule.rule || rule.id))}</h1>
<blockquote class="rv-quote"><cite>Your policy${rule.clause ? `, ${esc(rule.clause)}` : ''}</cite>“${esc(rule.quote || rule.rule)}”</blockquote>
<p class="rv-res">${kept ? '<span class="badge good">Kept</span>' : '<span class="badge bad">Broken</span>'}<span>${kept ? `The agent kept this rule on all ${rule.probes.length} test message${rule.probes.length === 1 ? '' : 's'}.` : `The agent broke this rule on ${nBroke} of ${rule.probes.length} test messages.`}</span></p>
${show ? `<div class="rv-ex"><div><p class="cap">A customer wrote</p><div class="bubble">${esc(show.message)}</div></div><div><p class="cap">The agent replied</p><div class="bubble ai">${esc(show.answer || '—')}</div></div></div>` : ''}
${rule.ambiguity ? `<p class="rv-amb"><span class="strong">A question for you:</span> ${esc(rule.ambiguity)} Your policy can be read more than one way here. Answer it with “Ask about this rule” below, so ${esc(preparedBy)} tests the reading you mean.</p>` : ''}
${wasBroken ? `<p class="rv-hist">This rule broke in the first check. ${esc(preparedBy)} approved a fix, and the same messages were sent again: ${kept ? 'kept' : 'still broken'}.</p>` : ''}
${mine ? `<p class="subtle" style="margin:12px 0 0">${mine.state === 'ok' ? 'You marked this rule as looking right.' : 'You asked about this rule.'} You can change it.</p>` : ''}
<div class="rv-acts">
<form method="post" action="/signoff/${esc(token)}/review/${n}" novalidate>${hidden}<input type="hidden" name="state" value="ok">${nameField}
<div class="row-inline">${n > 1 ? `<a class="btn" href="/signoff/${esc(token)}/review/${n - 1}">Previous</a>` : ''}<button class="btn primary" data-busy="Saving…">Looks right${n < rules.length ? ', next rule' : ', finish'}</button></div></form>
<details class="rv-ask"${mine?.state === 'asked' || error ? ' open' : ''}><summary>Ask ${esc(preparedBy)} about this rule</summary>
<form method="post" action="/signoff/${esc(token)}/review/${n}" novalidate style="margin-top:10px">${hidden}<input type="hidden" name="state" value="asked">${nameField}
<label class="field"><span>Your question</span><textarea name="text" maxlength="1000" rows="3" required style="min-height:76px"></textarea></label>
<button class="btn" data-busy="Sending…">Send the question${n < rules.length ? ' and go on' : ''}</button></form></details>
${qs}</div></section>
<p class="subtle" style="margin-top:14px">Rules</p><nav class="rv-dots" aria-label="All rules">${dots}</nav>
</div>`,
  });
}

// The summary page's review panel: how far the client is, and the one button that continues.
export function reviewPanel({ token, scan, review }) {
  const p = reviewProgress(review, scan);
  if (!p.total) return '';
  const pct = Math.round(100 * p.done / p.total);
  const cta = p.complete
    ? `<a class="btn" href="/signoff/${esc(token)}/review/1">Look again</a>`
    : `<a class="btn primary" href="/signoff/${esc(token)}/review/${p.next}">${p.done ? `Continue: rule ${p.next} of ${p.total}` : `Start the review: ${p.total} rules`}</a>`;
  return `<section class="rv-panel" aria-label="Your review"><div><p class="strong" style="margin:0">${p.complete ? `You reviewed all ${p.total} rules` : p.done ? `${p.done} of ${p.total} rules reviewed` : `Review the ${p.total} rules, one at a time`}</p>
<p class="subtle" style="margin:2px 0 0">${p.complete ? `${p.asked ? `${p.asked} with a question. ` : ''}You can accept the agent below.` : 'For each rule: your policy, what the check found, and one real exchange. Mark it as looking right, or ask about it. About a minute per rule.'}</p>
<div class="rv-bar" style="margin:10px 0 0" aria-hidden="true"><i style="width:${pct}%"></i></div></div>${cta}</section>
<style>.rv-panel{display:flex;gap:16px;align-items:center;justify-content:space-between;margin:0 0 20px;padding:16px 18px;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}.rv-panel>div{flex:1;min-width:0}.rv-panel .rv-bar{height:4px;border-radius:4px;background:var(--line);overflow:hidden}.rv-panel .rv-bar i{display:block;height:100%;background:var(--accent)}@media (max-width:560px){.rv-panel{flex-direction:column;align-items:stretch}}</style>`;
}
