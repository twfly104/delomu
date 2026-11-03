// An agent's public page, off until an owner turns it on: facts from Grapim's own records, each with its
// date (the latest check, live monitoring in the last 7 days, whether the audit log is intact). No score and
// no "certified" wording: it says what was checked and when, nothing more.

import { verifyAudit } from '../core/audit.mjs';
import { esc } from '../report.mjs';
import { listScans } from '../v1/risk.mjs';
import { liveSummary } from '../v1/live.mjs';
import { layout, mark } from './html.mjs';

export function verifiedFacts(dir, now = new Date()) {
  const scan = listScans(dir)[0] ?? null;
  const week = liveSummary(dir, now)?.week ?? { checked: 0, flagged: 0 };
  const audit = verifyAudit(dir);
  return {
    asOf: now.toISOString(),
    check: scan && { at: scan.createdAt, rules: scan.summary.rules, kept: scan.summary.rules - scan.summary.broken, broken: scan.summary.broken },
    live: { checked: week.checked ?? 0, flagged: week.flagged ?? 0 },
    audit: audit.ok ? { ok: true, entries: audit.count } : { ok: false, brokenAt: audit.brokenAt },
  };
}

export function verifiedPage({ company, name, facts }) {
  const day = iso => esc(iso.slice(0, 10));
  const row = (label, value, note = '') => `<tr><th scope="row" style="width:42%">${esc(label)}</th><td>${value}${note ? `<div class="subtle">${note}</div>` : ''}</td></tr>`;
  const c = facts.check;
  return layout({
    title: `${name} · ${company}`,
    body: `<div class="auth-card" style="max-width:600px">
<span class="brand">${mark(26, 'm-ver')}<span>Grapim</span></span>
<h1>${esc(name)}</h1><p class="lede">${esc(company)} tests this AI agent against its own written policies with Grapim. These are the facts in Grapim’s records.</p>
<table class="kv"><tbody>
${row('Latest policy check', c ? `${day(c.at)}: kept ${c.kept} of ${c.rules} rules` : 'None yet', c?.broken ? `${c.broken} rule${c.broken === 1 ? '' : 's'} broken in that check` : '')}
${row('Live monitoring, last 7 days', facts.live.checked ? `${facts.live.checked.toLocaleString('en-US')} conversations checked` : 'No conversations checked', facts.live.checked ? `${facts.live.flagged} broke a rule` : '')}
${row('Audit log', facts.audit.ok ? `Intact, ${facts.audit.entries} entries` : `Broken at entry ${esc(String(facts.audit.brokenAt))}`, 'Every action is chained to the one before it, so an edit shows.')}
</tbody></table>
<p class="subtle" style="margin-top:16px">As of ${day(facts.asOf)}. This page states what was checked and when; it is not a certification or a guarantee of future answers.</p>
</div>`,
  });
}
