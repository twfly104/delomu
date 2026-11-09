// The client's private page of AI vendor records (src/v3/records.mjs): every agent it signed off, from any vendor,
// newest first, each a snapshot taken at the decision.
import { esc } from '../report.mjs';
import { layout, mark } from './html.mjs';

const day = iso => String(iso ?? '').slice(0, 10);

export function recordsPage({ entries }) {
  const vendors = new Set(entries.map(e => e.vendor)).size;
  const rows = entries.map(e => `<tr><td><span class="strong">${esc(e.agent)}</span><span class="subtle" style="display:block;font-size:12.5px">${esc(e.vendor)}${e.client ? ` · for ${esc(e.client)}` : ''}</span></td>
<td class="num">${e.broken ? `<span class="badge bad">${e.broken} of ${e.rules} broken</span>` : `<span class="badge good">All ${e.rules} kept</span>`}${e.high_broken ? `<span class="subtle" style="display:block;font-size:12px">${e.high_broken} high-risk</span>` : ''}</td>
<td>${e.decision === 'accepted' ? 'Accepted' : 'Sent back'} by ${esc(e.reviewer)}</td><td class="nowrap subtle">${esc(day(e.decided_at))}</td></tr>`).join('');
  return layout({
    title: 'Your AI vendors’ records',
    body: `<div class="auth-card" style="max-width:820px">
<span class="brand">${mark(26, 'm-rec')}<span>Grapim</span></span>
<h1>Your AI vendors’ records</h1>
<p class="lede">${entries.length} AI agent${entries.length === 1 ? '' : 's'} from ${vendors} vendor${vendors === 1 ? '' : 's'}, each checked against your own policies and signed off by your team. Each line is the record as it stood when your team decided.</p>
<div class="scroll" style="margin-top:18px"><table><thead><tr><th>AI agent</th><th>Policy check</th><th>Decision</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="subtle" style="margin-top:16px">Another AI vendor works for you? Ask them to run their agent through Grapim; when you sign off with the same work email, it joins this page. Keep this link private.</p>
</div>`,
  });
}
