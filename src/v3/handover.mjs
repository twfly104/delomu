// The handover: one page the vendor gives the client's team at sign-off. Which rules the AI agent keeps (from
// the latest check), what happens when a policy changes (Grapim re-checks every rule and drafts the fix), and
// what keeps running after launch. Every line comes from the deployment's own records; nothing is estimated.

import fs from 'node:fs';
import path from 'node:path';
import { esc } from '../report.mjs';
import { layout, mark, possessive } from './html.mjs';
import { listScans } from '../v1/risk.mjs';
import { monitorSettings } from './monitoring.mjs';

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// scan: the check to describe (the one the sign-off link was made for, or the latest).
export function handoverData(dir, { scan = listScans(dir)[0] ?? null, preparedBy, client, name }) {
  const rules = (scan?.rules ?? []).map(r => ({
    title: clip(r.title || r.rule, 90), quote: clip(r.quote, 160),
    broken: r.probes.some(p => p.status === 'broken'),
  }));
  // The documents the rules were read from: the files their clauses cite, else every policy file (not ticket CSVs).
  let files = [];
  try { files = fs.readdirSync(path.join(dir, 'inputs')).filter(f => !f.startsWith('.') && !f.toLowerCase().endsWith('.csv')).sort(); } catch { /* none yet */ }
  const cited = files.filter(f => (scan?.rules ?? []).some(r => String(r.clause ?? '').includes(f)));
  const policies = cited.length ? cited : files;
  return { preparedBy, client, name, scan, rules, policies, monitor: monitorSettings(dir) };
}

// The block itself, shared by the client's sign-off page and the printable page.
export function handoverSection({ preparedBy, scan, rules, policies, monitor }) {
  const who = esc(preparedBy);
  const kept = rules.filter(r => !r.broken).length;
  const list = rules.length
    ? `<ul class="ho-rules">${rules.map(r => `<li><span class="ho-mark ${r.broken ? 'bad' : 'good'}">${r.broken ? 'Broken' : 'Kept'}</span><span><span class="strong">${esc(r.title)}</span>${r.quote ? `<span class="ho-quote">“${esc(r.quote)}”</span>` : ''}</span></li>`).join('')}</ul>`
    : '<p class="subtle">There is no check yet, so no rules to list.</p>';
  const live = monitor.enabled
    ? `Grapim runs the saved test messages again at least every ${monitor.intervalHours} hours, and at once when the agent’s connection or tests change. If an answer that passed starts failing, ${who} is alerted.`
    : `Scheduled re-checks are off for now. Ask ${who} to turn them on, so the saved test messages run again on a schedule and whenever the agent changes.`;
  return `<section class="ho">
<h2>The rules this agent keeps</h2>
<p class="subtle">${scan ? `From the check on ${esc(scan.createdAt.slice(0, 10))}: ${kept} of ${rules.length} kept.` : ''}${policies.length ? ` Taken from ${policies.map(esc).join(', ')}.` : ''}</p>
${list}
<h2>When a policy changes</h2>
<ol class="ho-steps">
<li><span class="strong">Send the new version to ${who}.</span> A changed refund window, a new escalation team, a rule you want removed: the written policy is what counts.</li>
<li><span class="strong">Grapim checks every rule again.</span> Uploading the new version starts a full check by itself, with new test messages written for the changed rules. Nobody has to remember to.</li>
<li><span class="strong">If a rule breaks, Grapim drafts the fix.</span> ${who} reviews and approves it, the same messages run again, and you get a new link to sign off.</li>
</ol>
<h2>While it is live</h2>
<p>${live}</p>
<p class="subtle">Every check, fix and sign-off is written to this agent’s audit log, which cannot be edited after the fact.</p>
</section>`;
}

export const HANDOVER_STYLE = `.ho h2{margin:28px 0 6px;font-size:17px;letter-spacing:-0.01em}.ho p{margin:0 0 8px}
.ho-rules{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:10px}.ho-rules li{display:flex;gap:12px;align-items:flex-start}
.ho-mark{flex:none;min-width:58px;text-align:center;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600}.ho-mark.good{background:color-mix(in srgb,var(--good) 14%,transparent);color:var(--good)}.ho-mark.bad{background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad)}
.ho-quote{display:block;margin-top:2px;font-size:13px;color:var(--text-3)}
.ho-steps{margin:10px 0 0;padding-left:20px;display:grid;gap:10px}.ho-steps .strong{display:block}
@media print{.no-print{display:none!important}body{background:#fff}}`;

// The printable page: for the vendor to save as PDF, and for the client from their sign-off link.
export function handoverPage(data, { back = '' } = {}) {
  return layout({
    title: `Handover · ${data.name}`,
    body: `<style>${HANDOVER_STYLE}</style><div class="auth-card" style="max-width:720px">
<span class="brand">${mark(26, 'm-ho')}<span>Grapim</span></span>
<h1>${esc(possessive(data.preparedBy))} AI agent${data.client ? ` for ${esc(data.client)}` : ''}</h1>
<p class="lede">What the agent keeps to, and what happens when your policies change. Prepared by ${esc(data.preparedBy)} with Grapim.</p>
${handoverSection(data)}
<p class="no-print" style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap">${back ? `<a class="btn" href="${esc(back)}">Back</a>` : ''}<span class="subtle">Use your browser’s Print to save it as a PDF.</span></p>
</div>`,
  });
}
