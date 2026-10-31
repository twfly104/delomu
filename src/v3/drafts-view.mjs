// Draft review: each agent draft rendered as the thing it proposes (a table of test cases, a list of
// fixes, a launch summary), with the agent's reasoning beside it and one decision form underneath.
// Raw JSON stays available under "Edit before approving" for the rare hand edit.

import { esc } from '../report.mjs';
import { icon } from './icons.mjs';
import { KIND_LABEL } from './insights.mjs';

const list = v => (Array.isArray(v) ? v : String(v ?? '').split('|')).map(x => String(x).trim()).filter(Boolean);
const chips = (items, cls = '') => items.map(t => `<span class="chip ${cls}">${esc(t)}</span>`).join(' ');
const empty = text => `<p class="subtle">${esc(text)}</p>`;

function mappingView(c) {
  const systems = (c.systems ?? []).map(s => `<tr><td class="strong">${esc(s.name)}</td><td>${esc(s.purpose)}</td></tr>`).join('');
  const entities = (c.entities ?? []).map(e => `<div class="sub">
<h4>${esc(e.name)} <span class="subtle">· ${esc(e.system)}</span></h4>
<table><thead><tr><th>Field</th><th>Meaning</th><th>Example</th></tr></thead><tbody>
${(e.fields ?? []).map(f => `<tr><td><code>${esc(f.name)}</code></td><td>${esc(f.meaning)}</td><td class="muted">${esc(f.example)}</td></tr>`).join('')}
</tbody></table></div>`).join('');
  const questions = list(c.openQuestions);
  return `${systems ? `<table class="kv"><thead><tr><th>System</th><th>Purpose</th></tr></thead><tbody>${systems}</tbody></table>` : ''}
${entities || empty('No entities.')}
${questions.length ? `<div class="sub"><h4>Open questions for the customer</h4><ul class="plain">${questions.map(q => `<li>${esc(q)}</li>`).join('')}</ul></div>` : ''}`;
}

function integrationView(c) {
  const t = c.target ?? {};
  const rows = [
    ['Type', t.type === 'http' ? 'HTTP endpoint' : t.type === 'command' ? 'Command' : t.type],
    ['URL', t.url], ['Method', t.url ? (t.method ?? 'POST') : undefined], ['Command', t.command],
    ['Request body', t.body !== undefined ? JSON.stringify(t.body) : undefined], ['Answer at', t.output],
    ['Timeout', t.timeoutMs ? `${t.timeoutMs / 1000} s` : undefined],
  ].filter(([, v]) => v !== undefined && v !== '');
  const headers = Object.entries(t.headers ?? {});
  return `<table class="kv"><tbody>
${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td><code>${esc(v)}</code></td></tr>`).join('')}
${headers.map(([k, v]) => `<tr><th scope="row">Header <code>${esc(k)}</code></th><td><code>${esc(v)}</code></td></tr>`).join('')}
</tbody></table>
${c.notes ? `<div class="sub"><h4>Notes</h4><p class="prose">${esc(c.notes)}</p></div>` : ''}`;
}

function casesView(c) {
  const rows = c.rows ?? [];
  if (!rows.length) return empty('No cases.');
  return `<p class="muted count">${rows.length} test case${rows.length === 1 ? '' : 's'}</p>
<div class="scroll"><table class="cases"><thead><tr><th>Case</th><th>Customer writes</th><th>A correct answer</th><th>Checks</th></tr></thead><tbody>
${rows.map(r => {
    const inc = list(r.must_include);
    const not = list(r.must_not_include);
    return `<tr><td><code>${esc(r.id)}</code><div class="tags">${chips(list(r.tags), 'tag')}</div></td>
<td>${esc(r.input)}</td><td>${esc(r.expected) || '<span class="subtle">—</span>'}</td>
<td class="checks">${inc.length ? `<div><span class="subtle">Must say</span> ${chips(inc, 'good')}</div>` : ''}${not.length ? `<div><span class="subtle">Never says</span> ${chips(not, 'bad')}</div>` : ''}${r.regex ? `<div><span class="subtle">Matches</span> <code>${esc(r.regex)}</code></div>` : ''}${!inc.length && !not.length && !r.regex ? '<span class="subtle">Judge only</span>' : ''}</td></tr>`;
  }).join('')}
</tbody></table></div>`;
}

function fixesView(c) {
  const groups = c.groups ?? [];
  if (!groups.length) return empty('No fixes proposed.');
  return `<ol class="fixes">${groups.map(g => `<li>
<p class="strong">${esc(g.cause)}</p>
<p class="prose">${esc(g.fix)}</p>
<p class="meta">${g.owner ? `<span class="subtle">Owner</span> ${esc(g.owner)} · ` : ''}<span class="subtle">Cases</span> ${chips(list(g.caseIds), 'tag')}</p>
</li>`).join('')}</ol>`;
}

function launchView(c) {
  const risks = list(c.risks);
  const decisions = c.decisions ?? [];
  return `<p class="prose lead">${esc(c.summary)}</p>
${risks.length ? `<div class="sub"><h4>Risks</h4><ul class="plain">${risks.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
${decisions.length ? `<div class="sub"><h4>Decisions</h4><table><thead><tr><th>Date</th><th>Decision</th><th>Why</th></tr></thead><tbody>
${decisions.map(d => `<tr><td class="num nowrap">${esc(d.date)}</td><td>${esc(d.decision)}</td><td class="muted">${esc(d.reason)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

const VIEWS = { mapping: mappingView, integration: integrationView, cases: casesView, fixes: fixesView, 'launch-report': launchView };

export function draftContent(d) {
  const view = VIEWS[d.kind];
  try {
    if (view) return view(d.content ?? {});
  } catch { /* fall through to the raw view */ }
  return `<pre class="raw">${esc(JSON.stringify(d.content, null, 2))}</pre>`;
}

export const draftTitle = d => KIND_LABEL[d.kind] ?? d.kind;

// The agent's reasoning, collapsed to its first sentence; the rest opens on request.
function reasoningBlock(text) {
  const first = String(text).match(/^.*?[.!?](\s|$)/s)?.[0].trim() ?? String(text);
  const rest = String(text).slice(first.length).trim();
  const head = `${icon('spark')}<div><p class="label">Why the agent proposes this</p><p class="prose">${esc(first)}</p></div>`;
  if (!rest) return `<aside class="reasoning">${head}</aside>`;
  return `<details class="reasoning"><summary>${head}<span class="more">Show all</span></summary><p class="prose rest">${esc(rest)}</p></details>`;
}

// A pending draft with its review form, or a read-only one when the viewer cannot review.
export function draftCard(d, { action, csrf, canReview, when }) {
  const head = `<header class="draft-head">
<div><h3>${esc(draftTitle(d))}</h3><p class="subtle">Step ${esc(d.step ?? '–')} · drafted by ${esc(d.createdBy)} · ${esc(when(d.createdAt))}</p></div>
<span class="badge warn">Waiting for review</span></header>`;
  const reasoning = d.rationale ? reasoningBlock(d.rationale) : '';
  const body = `<div class="draft-body">${draftContent(d)}</div>`;
  if (!canReview) return `<article class="panel draft">${head}${reasoning}${body}<footer class="draft-foot"><p class="subtle">You can read this draft. Reviewers and engineers decide on it.</p></footer></article>`;
  const id = esc(d.id);
  return `<form class="panel draft" method="post" action="${esc(action)}">${head}${reasoning}${body}
<input type="hidden" name="csrf" value="${esc(csrf)}">
<details class="edit"><summary>Edit before approving</summary>
<p class="hint">Change the proposal as JSON. Your edit is applied instead of the agent's version and recorded as a human edit.</p>
<label class="sr" for="c-${id}">Draft content</label><textarea id="c-${id}" name="content" spellcheck="false">${esc(JSON.stringify(d.content, null, 2))}</textarea></details>
<footer class="draft-foot">
<label class="sr" for="n-${id}">Note</label><input type="text" id="n-${id}" name="note" maxlength="2000" placeholder="Add a note for the audit log (optional)">
<button class="btn" name="decision" value="reject" data-busy="Rejecting…">${icon('x')}Reject</button>
<button class="btn primary" name="decision" value="approve" data-busy="Applying…">${icon('check')}Approve and apply</button>
</footer></form>`;
}

export function reviewedRow(d, { when }) {
  const cls = d.status === 'approved' ? 'good' : 'bad';
  return `<details class="history"><summary>
<span class="badge ${cls}">${d.status === 'approved' ? 'Approved' : 'Rejected'}</span>
<span class="strong">${esc(draftTitle(d))}</span>
<span class="subtle">${esc(d.reviewedBy ?? '')}${d.edited ? ' · with edits' : ''} · ${esc(when(d.reviewedAt ?? d.createdAt))}</span>
${d.note ? `<span class="muted note">“${esc(d.note)}”</span>` : ''}</summary>
<div class="draft-body">${draftContent(d)}</div></details>`;
}
