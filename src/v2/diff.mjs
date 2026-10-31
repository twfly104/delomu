// Compares two runs case by case, the way an experiment comparison view does: which cases regressed
// (pass -> anything else), which were fixed, which are new or removed, and how the pass rate moved.
// Writes runs/<id>/diff.json and diff.html next to the run's results.

import fs from 'node:fs';
import path from 'node:path';
import { esc } from '../report.mjs';

const pct = x => `${Math.round(x * 1000) / 10}%`;
const signedPct = x => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${pct(Math.abs(x))}`;

// previous may be null (first monitored run): every case is then "new" and nothing regressed.
export function diffRuns(previous, current) {
  const before = new Map((previous?.cases ?? []).map(c => [c.id, c]));
  const after = new Map(current.cases.map(c => [c.id, c]));
  const regressions = [];
  const fixed = [];
  const added = [];
  const changed = [];
  for (const [id, c] of after) {
    const p = before.get(id);
    if (!p) { added.push({ id, status: c.status }); continue; }
    const row = { id, from: p.status, to: c.status, input: c.input, output: c.output ?? null, error: c.error ?? null };
    if (p.status === 'pass' && c.status !== 'pass') regressions.push(row);
    else if (p.status !== 'pass' && c.status === 'pass') fixed.push(row);
    else if (p.status !== c.status) changed.push(row);
  }
  const removed = [...before.keys()].filter(id => !after.has(id)).map(id => ({ id, status: before.get(id).status }));
  const prevRate = previous?.summary.passRate ?? null;
  return {
    previousRunId: previous?.runId ?? null,
    runId: current.runId,
    generatedAt: current.generatedAt,
    customer: current.customer,
    deployment: current.deployment,
    passRate: { before: prevRate, after: current.summary.passRate, delta: prevRate === null ? null : current.summary.passRate - prevRate },
    verdict: { before: previous?.summary.verdict ?? null, after: current.summary.verdict },
    minPassRate: current.summary.minPassRate,
    regressions,
    fixed,
    added,
    removed,
    changed,
  };
}

const STATUS_LABEL = { pass: 'Pass', fail: 'Fail', needs_review: 'Needs review', error: 'Error' };
const tag = s => `<span class="tag ${esc(s)}">${esc(STATUS_LABEL[s] ?? s)}</span>`;

function transitions(title, rows, open) {
  if (!rows.length) return '';
  return `<h2>${esc(title)} (${rows.length})</h2>
${rows.map(r => `<details class="case"${open ? ' open' : ''}><summary><code>${esc(r.id)}</code> ${tag(r.from)} → ${tag(r.to)}</summary>
<div class="io"><div><h4>User message</h4><pre>${esc(r.input)}</pre></div>
<div><h4>AI answer now</h4><pre>${r.error ? esc(`No answer: ${r.error}`) : esc(r.output)}</pre></div></div></details>`).join('\n')}`;
}

const idList = (title, rows) => (rows.length
  ? `<h2>${esc(title)} (${rows.length})</h2><p>${rows.map(r => `<code>${esc(r.id)}</code> ${tag(r.status)}`).join(' · ')}</p>`
  : '');

export function renderDiffHtml(d) {
  const worse = d.regressions.length > 0 || (d.passRate.delta ?? 0) < 0;
  const headline = d.previousRunId === null ? 'Baseline run' : worse ? 'Regressions found' : 'No regressions';
  const tone = d.previousRunId === null ? '' : worse ? 'not_accepted' : 'accepted';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Run comparison</title>
<style>
:root{--bg:#fff;--fg:#1a1a1f;--muted:#5d5d6b;--line:#e3e3ea;--card:#f7f7fa;--good:#1f7a4d;--bad:#b42318;--warn:#a15c07;--accent:#4b4bd6}
@media (prefers-color-scheme:dark){:root{--bg:#121216;--fg:#ececf1;--muted:#a3a3b2;--line:#2c2c35;--card:#1b1b22;--good:#4cc38a;--bad:#f97066;--warn:#f5b546;--accent:#8f8ff5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:920px;margin:0 auto;padding:32px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 12px}
h4{margin:0 0 4px;font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.muted{color:var(--muted)}
.verdict{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:16px 20px;margin:20px 0;background:var(--card)}
.verdict.accepted{border-left-color:var(--good)}.verdict.not_accepted{border-left-color:var(--bad)}
.verdict b{font-size:20px}.stats{display:flex;flex-wrap:wrap;gap:24px;margin-top:10px}.stats div{min-width:90px}.stats strong{display:block;font-size:20px}
.case{border:1px solid var(--line);border-radius:8px;margin:8px 0;padding:10px 14px}.case summary{cursor:pointer}
.io{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}@media (max-width:640px){.io{grid-template-columns:1fr}}
pre{white-space:pre-wrap;word-break:break-word;margin:0;padding:10px;background:var(--card);border-radius:6px;font:13px/1.5 ui-monospace,Consolas,monospace}
.tag{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid currentColor}
.tag.pass{color:var(--good)}.tag.fail,.tag.error{color:var(--bad)}.tag.needs_review{color:var(--warn)}
footer{margin-top:40px;font-size:13px;color:var(--muted)}
</style></head><body><main>
<h1>Run comparison</h1>
<div class="muted">${esc(d.customer)} · ${esc(d.deployment)} · ${esc(String(d.generatedAt).slice(0, 10))}</div>

<section class="verdict ${esc(tone)}"><b>${esc(headline)}</b>
<div>${d.previousRunId === null ? 'There is no earlier run to compare with; later runs are compared with this one.' : `Compared with run ${esc(d.previousRunId)}.`}</div>
<div class="stats">
<div><strong>${esc(pct(d.passRate.after))}</strong>pass rate now</div>
<div><strong>${d.passRate.delta === null ? '–' : esc(signedPct(d.passRate.delta))}</strong>change</div>
<div><strong>${esc(pct(d.minPassRate))}</strong>required</div>
<div><strong>${d.regressions.length}</strong>regressed</div>
<div><strong>${d.fixed.length}</strong>fixed</div>
<div><strong>${d.added.length} / ${d.removed.length}</strong>new / removed</div>
</div></section>

${transitions('Regressions', d.regressions, true)}
${transitions('Fixed', d.fixed, false)}
${transitions('Other status changes', d.changed, false)}
${idList('New cases', d.added)}
${idList('Removed cases', d.removed)}

<footer>Run ${esc(d.runId)} · verdict ${esc(d.verdict.before ?? '–')} → ${esc(d.verdict.after)}</footer>
</main></body></html>
`;
}

export function writeDiff(outDir, diff) {
  fs.writeFileSync(path.join(outDir, 'diff.json'), JSON.stringify(diff, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'diff.html'), renderDiffHtml(diff));
}
