// The pre-launch check as a standalone document an AI vendor can hand to its customer (or a support lead to
// legal): the result, every rule with its clause, the exchanges behind each finding, and how the check works.
// Self-contained HTML with no scripts; "Print, then Save as PDF" turns it into a file. Every value is escaped.

import { esc } from '../report.mjs';
import { TOKENS } from '../theme.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
const SEVERITY = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' };
const STATUS = { broken: ['bad', 'Broken'], review: ['warn', 'Needs review'], kept: ['good', 'Kept'] };

const ruleStatus = r => (r.probes.some(p => p.status === 'broken') ? 'broken'
  : r.probes.some(p => p.status === 'unjudged' || p.status === 'error') ? 'review' : 'kept');

const STYLE = `${TOKENS}
body{background:var(--surface)}
main{max-width:860px;margin:0 auto;padding:48px 32px 64px}
.top{display:flex;justify-content:space-between;gap:16px;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:28px;font-size:13px;color:var(--text-3)}
.top .brand{font-weight:600;color:var(--text);letter-spacing:-0.02em;font-size:15px}
h1{font-size:28px;letter-spacing:-0.03em}h2{font-size:17px;margin:36px 0 12px}
.lede{color:var(--text-2);margin-top:6px}
.verdict{margin:28px 0 8px;font-size:22px;font-weight:600;letter-spacing:-0.02em}.verdict.bad{color:var(--bad)}.verdict.warn{color:var(--warn)}.verdict.good{color:var(--good)}
.facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);border-radius:var(--r);margin-top:16px}
.facts div{padding:12px 14px;border-left:1px solid var(--line)}.facts div:first-child{border-left:0}
.facts b{display:block;font-size:20px;letter-spacing:-0.02em}.facts span{font-size:12.5px;color:var(--text-3)}
table{border:1px solid var(--line);border-radius:var(--r);border-collapse:separate;border-spacing:0;overflow:hidden}
td,th{padding:10px 12px}td{font-size:13.5px}
.rule{border:1px solid var(--line);border-radius:var(--r);padding:16px;margin-top:12px;break-inside:avoid}
.rule h3{font-size:15px;line-height:1.4}.rule .meta{display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap}
.clause{margin:10px 0 0;padding:2px 0 2px 12px;border-left:2px solid var(--line-strong);color:var(--text-2);font-size:13.5px}
.ex{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:14px}
.cap{font-size:12px;color:var(--text-3);margin-bottom:4px}
.bubble{padding:9px 12px;border-radius:10px;background:var(--sunken);font-size:13.5px;line-height:1.5;white-space:pre-line;overflow-wrap:anywhere}
.bubble.ai{border:1px solid color-mix(in srgb,var(--bad) 40%,var(--line));background:var(--bad-weak)}
.why{grid-column:1/-1;font-size:13.5px}.why b{font-weight:600}
.method{color:var(--text-2);font-size:13.5px;line-height:1.6}.method li+li{margin-top:4px}
.foot{margin-top:40px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--text-3)}
.print-hint{font-size:12.5px;color:var(--text-3)}
@media (max-width:640px){main{padding:28px 16px}.facts{grid-template-columns:repeat(2,minmax(0,1fr))}.facts div:nth-child(3){border-left:0}.ex{grid-template-columns:minmax(0,1fr)}}
@media print{.print-hint{display:none}main{padding:0}body{background:#fff}}
`;

// scan: a full scan from risk.mjs; name: the AI agent; customer: whose AI or policies (optional); org: the org name.
export function renderScanReport({ scan, name, customer, org }) {
  const s = scan.summary;
  const rules = scan.rules.map(r => ({ ...r, st: ruleStatus(r) }));
  const order = { broken: 0, review: 1, kept: 2 };
  const sev = { high: 0, medium: 1, low: 2 };
  rules.sort((a, b) => order[a.st] - order[b.st] || sev[a.severity] - sev[b.severity]);
  const broken = rules.filter(r => r.st === 'broken');
  const review = rules.filter(r => r.st === 'review');
  const [vcls, vtext] = broken.length ? ['bad', `${broken.length} of ${s.rules} policy rules broken`]
    : review.length ? ['warn', `${review.length} of ${s.rules} rules could not be checked`]
      : ['good', `All ${s.rules} policy rules kept`];
  const badge = st => `<span class="badge ${STATUS[st][0]}">${STATUS[st][1]}</span>`;
  const detail = r => `<section class="rule"><h3>${esc(r.rule)}</h3>
<div class="meta">${badge(r.st)}<span class="badge plain">${esc(SEVERITY[r.severity] ?? 'Medium risk')}</span><span class="subtle" style="font-size:12.5px">${esc(r.clause)}</span></div>
<p class="clause">“${esc(r.quote)}”</p>
${r.probes.filter(p => p.status !== 'kept').map(p => `<div class="ex">
<div><p class="cap">Customer wrote</p><div class="bubble">${esc(p.message)}</div></div>
<div><p class="cap">The AI replied</p><div class="bubble ai">${esc(p.answer || 'No answer')}</div></div>
<p class="why"><b>Finding:</b> ${esc(p.what_happened)}${p.fix ? `<br><b>Recommended fix:</b> ${esc(p.fix)}` : ''}</p></div>`).join('')}</section>`;
  const title = `Pre-launch policy check: ${name}${customer ? ` for ${customer}` : ''}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">
<title>${esc(title)}</title><style>${STYLE}</style></head><body><main>
<div class="top"><span class="brand">Grapim</span><span>${esc(day(scan.createdAt))}${org ? ` · Prepared by ${esc(org)}` : ''}</span></div>
<h1>${esc(title)}</h1>
<p class="lede">Every written policy rule was tested with the customer messages most likely to make the AI break it, and each answer was judged against the exact clause.</p>
<p class="print-hint">To save as PDF: Print (Ctrl+P or ⌘P), then Save as PDF.</p>
<p class="verdict ${vcls}">${esc(vtext)}</p>
<div class="facts"><div><b class="num">${s.rules}</b><span>Policy rules</span></div><div><b class="num">${s.probes}</b><span>Test messages</span></div>
<div><b class="num">${s.failed}</b><span>Broke a rule</span></div><div><b class="num">${s.unjudged}</b><span>Need review</span></div></div>
<h2>All rules</h2>
<table><thead><tr><th>Rule</th><th>Source</th><th>Result</th></tr></thead><tbody>
${rules.map(r => `<tr><td>${esc(r.rule)}</td><td class="subtle nowrap">${esc(r.clause)}</td><td>${badge(r.st)}</td></tr>`).join('\n')}
</tbody></table>
${broken.length ? `<h2>Findings</h2>${broken.map(detail).join('')}` : ''}
${review.length ? `<h2>Needs a person to review</h2><p class="method">The AI gave no answer, or no verdict could be reached. These rules are not counted as kept.</p>${review.map(detail).join('')}` : ''}
<h2>How this check works</h2>
<ul class="method">
<li>Policies read: ${scan.documents.map(esc).join(', ')}.</li>
<li>For each rule, Grapim wrote customer messages aimed at its edges: boundary dates, claimed approvals, everyday rewording and pressure.</li>
<li>Each message was sent to the AI as a customer would send it, and the answer was judged against the clause by ${esc(scan.model)}.</li>
<li>A kept rule means the AI handled these messages correctly. It is evidence, not a guarantee for every possible conversation; live monitoring checks real conversations after launch.</li>
</ul>
<p class="foot">Grapim · check ${esc(scan.id)} · ${s.probes} messages · ${scan.seconds} s</p>
</main></body></html>
`;
}
