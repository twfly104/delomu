// Step 5: the acceptance report the customer signs off on. Every value from the run is escaped.

import { TOKENS } from './theme.mjs';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pct = x => `${Math.round(x * 1000) / 10}%`;

const VERDICT = {
  accepted: ['Accepted', 'The AI met the agreed pass rate on the customer\'s own cases.'],
  not_accepted: ['Not accepted', 'The AI is below the agreed pass rate. The gaps below show what to fix.'],
  pending_review: ['Pending human review', 'Some cases need a person to decide before the result is final.'],
};

const STATUS_LABEL = { pass: 'Pass', fail: 'Fail', needs_review: 'Needs review', error: 'Error' };

const CHECK_LABEL = {
  contains: v => `Must mention "${v}"`,
  not_contains: v => `Must not say "${v}"`,
  regex: v => `Must match /${v}/`,
  judge: v => `Expected: ${v}`,
};

function caseBlock(c, open) {
  const checks = c.checks.map(k => `<li>
<span class="badge ${CLS[k.status] ?? ''}">${esc(STATUS_LABEL[k.status] ?? k.status)}</span>
<div><p>${esc((CHECK_LABEL[k.type] ?? (v => v))(k.value))}</p>
${k.reason ? `<p class="muted">${esc(k.reason)}</p>` : ''}
${k.fix ? `<p class="fix"><span class="strong">Suggested fix</span> ${esc(k.fix)}</p>` : ''}</div></li>`).join('');
  return `<details class="case"${open ? ' open' : ''}>
<summary><span class="badge ${CLS[c.status] ?? ''}">${esc(STATUS_LABEL[c.status])}</span><code>${esc(c.id)}</code>
${c.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</summary>
<div class="io"><div><p class="cap">Customer writes</p><pre>${esc(c.input)}</pre></div>
<div><p class="cap">AI answers</p><pre>${c.error ? esc(`No answer: ${c.error}`) : esc(c.output)}</pre></div></div>
${checks ? `<ul class="checks">${checks}</ul>` : ''}
</details>`;
}

const CLS = { pass: 'good', fail: 'bad', error: 'bad', needs_review: 'warn' };
const VERDICT_CLS = { accepted: 'good', not_accepted: 'bad', pending_review: 'warn' };

export function renderHtml(r) {
  const s = r.summary;
  const [title, line] = VERDICT[s.verdict];
  const order = { error: 0, fail: 1, needs_review: 2 };
  const gaps = r.cases.filter(c => c.status !== 'pass').sort((a, b) => order[a.status] - order[b.status]);
  const passed = r.cases.filter(c => c.status === 'pass');
  const tags = Object.entries(s.byTag).sort((a, b) => a[1].pass / a[1].total - b[1].pass / b[1].total);
  const goal = s.minPassRate;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Acceptance report · ${esc(r.customer)}</title>
<style>${TOKENS}
.strong{font-weight:600}
main{max-width:920px;margin:0 auto;padding:40px 24px 72px}
.top{display:flex;align-items:center;gap:7px;font-weight:600;letter-spacing:-0.03em;color:var(--text);font-size:16px;margin-bottom:28px}
h1{font-size:26px}h2{font-size:16px;margin:40px 0 12px}
.meta{margin-top:6px;color:var(--text-2)}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r)}
.verdict{margin-top:24px;padding:20px}
.verdict .head{display:flex;align-items:center;gap:10px}.verdict .head .badge{font-size:13px;height:24px}
.verdict p{margin-top:8px;color:var(--text-2)}
.figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:1px;margin-top:20px;background:var(--line);border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden}
.figures div{background:var(--surface);padding:12px 14px}
.figures dt{font-size:12px;color:var(--text-3)}.figures dd{margin:2px 0 0;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-0.01em}
.panel table th:first-child,.panel table td:first-child{padding-left:16px}.panel table th:last-child,.panel table td:last-child{padding-right:16px}
.meter{display:flex;align-items:center;gap:10px}.meter span.bar{flex:1;max-width:220px;height:6px;border-radius:3px;background:var(--sunken);position:relative;overflow:hidden}
.meter span.bar i{position:absolute;inset:0 auto 0 0;border-radius:3px;background:var(--bad)}.meter span.bar i.ok{background:var(--good)}
.case{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);margin:8px 0}
.case summary{display:flex;align-items:center;gap:8px;padding:12px 16px;cursor:pointer;flex-wrap:wrap}
.case[open] summary{border-bottom:1px solid var(--line)}
.chip{font-size:12px;color:var(--text-3);border:1px solid var(--line);border-radius:5px;padding:0 6px}
.io{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:16px}
.cap{font-size:12px;font-weight:500;color:var(--text-3);margin-bottom:6px}
pre{white-space:pre-wrap;word-break:break-word;margin:0;padding:10px 12px;background:var(--sunken);border-radius:var(--r-sm);font:13px/1.55 var(--font)}
.checks{list-style:none;margin:0;padding:0 16px 8px}.checks li{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line)}
.checks li p+p{margin-top:2px}.fix{margin-top:4px}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--text-3)}
@media (max-width:640px){.io{grid-template-columns:1fr}main{padding:24px 16px 56px}}
@media print{body{background:#fff}.case{break-inside:avoid}details.case:not([open])>*:not(summary){display:block}}
</style></head><body><main>
<div class="top"><svg width="18" height="18" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#0a0a0a"/><path d="M46 20 H24 V44 H40 V36 H32 V30 H46 V50 H18 V14 H46 Z" fill="#fff"/></svg>Grapim</div>
<h1>Acceptance report</h1>
<p class="meta">${esc(r.customer)} · ${esc(r.deployment)} · ${esc(r.generatedAt.slice(0, 10))}</p>

<section class="panel verdict"><div class="head"><span class="badge ${VERDICT_CLS[s.verdict] ?? ''}">${esc(title)}</span></div><p>${esc(line)}</p>
<dl class="figures">
<div><dt>Pass rate</dt><dd>${esc(pct(s.passRate))}</dd></div>
<div><dt>Required</dt><dd>${esc(pct(goal))}</dd></div>
<div><dt>Cases passed</dt><dd>${s.pass} / ${s.total}</dd></div>
<div><dt>Failed</dt><dd>${s.fail}</dd></div>
<div><dt>Need review</dt><dd>${s.needs_review}</dd></div>
<div><dt>Errors</dt><dd>${s.error}</dd></div>
</dl></section>

<h2>Pass rate by area</h2>
<section class="panel"><table><thead><tr><th>Area</th><th>Passed</th><th>Pass rate</th></tr></thead><tbody>
${tags.map(([t, v]) => `<tr><td>${esc(t)}</td><td>${v.pass} / ${v.total}</td><td><span class="meter"><span class="bar"><i class="${v.pass / v.total >= goal ? 'ok' : ''}" style="width:${Math.round((v.pass / v.total) * 100)}%"></i></span>${esc(pct(v.pass / v.total))}</span></td></tr>`).join('')}
</tbody></table></section>

<h2>Gaps and suggested fixes (${gaps.length})</h2>
${gaps.length ? gaps.map(c => caseBlock(c, true)).join('') : '<p class="muted">No gaps: every case passed.</p>'}

<h2>Decisions</h2>
${r.decisions.length ? `<section class="panel"><table><thead><tr><th>Date</th><th>Decision</th><th>Why</th></tr></thead><tbody>
${r.decisions.map(d => `<tr><td>${esc(d.date)}</td><td>${esc(d.decision)}</td><td class="muted">${esc(d.reason)}</td></tr>`).join('')}
</tbody></table></section>` : '<p class="muted">No decisions recorded.</p>'}

<h2>Passed cases (${passed.length})</h2>
${passed.map(c => caseBlock(c, false)).join('')}

<footer>Run ${esc(r.runId)} · target: ${esc(r.target)} · judge: ${esc(r.judge)}</footer>
</main></body></html>
`;
}
