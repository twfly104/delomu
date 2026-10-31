// Step 5: the acceptance report the customer signs off on. Every value from the run is escaped.

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
  const checks = c.checks.map(k => `
      <li class="${esc(k.status)}">
        <span class="tag ${esc(k.status)}">${esc(STATUS_LABEL[k.status] ?? k.status)}</span>
        ${esc((CHECK_LABEL[k.type] ?? (v => v))(k.value))}
        ${k.reason ? `<div class="why">${esc(k.reason)}</div>` : ''}
        ${k.fix ? `<div class="fix"><b>Suggested fix:</b> ${esc(k.fix)}</div>` : ''}
      </li>`).join('');
  return `
  <details class="case"${open ? ' open' : ''}>
    <summary><span class="tag ${esc(c.status)}">${esc(STATUS_LABEL[c.status])}</span> <code>${esc(c.id)}</code>
      ${c.tags.map(t => `<span class="label">${esc(t)}</span>`).join(' ')}</summary>
    <div class="io"><div><h4>User message</h4><pre>${esc(c.input)}</pre></div>
    <div><h4>AI answer</h4><pre>${c.error ? esc(`No answer: ${c.error}`) : esc(c.output)}</pre></div></div>
    ${checks ? `<ul class="checks">${checks}</ul>` : ''}
  </details>`;
}

export function renderHtml(r) {
  const s = r.summary;
  const [title, line] = VERDICT[s.verdict];
  const order = { error: 0, fail: 1, needs_review: 2 };
  const gaps = r.cases.filter(c => c.status !== 'pass').sort((a, b) => order[a.status] - order[b.status]);
  const passed = r.cases.filter(c => c.status === 'pass');
  const tags = Object.entries(s.byTag).sort((a, b) => a[1].pass / a[1].total - b[1].pass / b[1].total);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Acceptance report</title>
<style>
:root{--bg:#fff;--fg:#1a1a1f;--muted:#5d5d6b;--line:#e3e3ea;--card:#f7f7fa;--good:#1f7a4d;--bad:#b42318;--warn:#a15c07;--accent:#4b4bd6}
@media (prefers-color-scheme:dark){:root{--bg:#121216;--fg:#ececf1;--muted:#a3a3b2;--line:#2c2c35;--card:#1b1b22;--good:#4cc38a;--bad:#f97066;--warn:#f5b546;--accent:#8f8ff5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 12px}
h4{margin:0 0 4px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.muted{color:var(--muted)}
.verdict{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:16px 20px;margin:20px 0;background:var(--card)}
.verdict.accepted{border-left-color:var(--good)}.verdict.not_accepted{border-left-color:var(--bad)}.verdict.pending_review{border-left-color:var(--warn)}
.verdict b{font-size:20px}.stats{display:flex;flex-wrap:wrap;gap:24px;margin-top:10px}.stats div{min-width:90px}.stats strong{display:block;font-size:20px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}th{font-size:13px;color:var(--muted);font-weight:600}
.case{border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:10px 14px}.case summary{cursor:pointer}
.io{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}@media (max-width:640px){.io{grid-template-columns:1fr}}
pre{white-space:pre-wrap;word-break:break-word;margin:0;padding:10px;background:var(--card);border-radius:6px;font:13px/1.5 ui-monospace,Consolas,monospace}
.checks{list-style:none;padding:0;margin:12px 0 0}.checks li{padding:6px 0;border-top:1px solid var(--line)}
.why{color:var(--muted);margin-top:2px}.fix{margin-top:2px}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid currentColor}
.tag.pass{color:var(--good)}.tag.fail,.tag.error{color:var(--bad)}.tag.needs_review{color:var(--warn)}
.label{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 6px}
footer{margin-top:40px;font-size:13px;color:var(--muted)}
</style></head><body><main>
<h1>Acceptance report</h1>
<div class="muted">${esc(r.customer)} · ${esc(r.deployment)} · ${esc(r.generatedAt.slice(0, 10))}</div>

<section class="verdict ${esc(s.verdict)}"><b>${esc(title)}</b><div>${esc(line)}</div>
<div class="stats">
<div><strong>${esc(pct(s.passRate))}</strong>pass rate</div>
<div><strong>${esc(pct(s.minPassRate))}</strong>required</div>
<div><strong>${s.pass} / ${s.total}</strong>cases passed</div>
<div><strong>${s.fail}</strong>failed</div>
<div><strong>${s.needs_review}</strong>need review</div>
<div><strong>${s.error}</strong>errors</div>
</div></section>

<h2>Pass rate by area</h2>
<table><thead><tr><th>Area</th><th>Passed</th><th>Pass rate</th></tr></thead><tbody>
${tags.map(([t, v]) => `<tr><td>${esc(t)}</td><td>${v.pass} / ${v.total}</td><td>${esc(pct(v.pass / v.total))}</td></tr>`).join('\n')}
</tbody></table>

<h2>Gaps and suggested fixes (${gaps.length})</h2>
${gaps.length ? gaps.map(c => caseBlock(c, true)).join('') : '<p class="muted">No gaps: every case passed.</p>'}

<h2>Decisions</h2>
${r.decisions.length ? `<table><thead><tr><th>Date</th><th>Decision</th><th>Why</th></tr></thead><tbody>
${r.decisions.map(d => `<tr><td>${esc(d.date)}</td><td>${esc(d.decision)}</td><td>${esc(d.reason)}</td></tr>`).join('\n')}
</tbody></table>` : '<p class="muted">No decisions recorded.</p>'}

<h2>Passed cases (${passed.length})</h2>
${passed.map(c => caseBlock(c, false)).join('')}

<footer>Run ${esc(r.runId)} · target: ${esc(r.target)} · judge: ${esc(r.judge)}</footer>
</main></body></html>
`;
}
