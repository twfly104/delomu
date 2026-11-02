// Alerting with incident semantics, so a broken deployment pages once, not on every check.
// An incident is open while some cases that regressed are still not passing, or the run is below the
// agreed pass rate. Its dedup key is a hash of the open case ids plus the below-acceptance flag:
// the same key again sends nothing, a different key sends an update, and clearing sends "resolved".
// An alert whose delivery failed is stored with notified: false and is sent again on the next check.
// "announced" remembers that some alert of the incident did reach the channel, so a later failed update
// never stops the incident from being resolved there.
// Payloads are Slack incoming-webhook JSON ({ text, blocks }), which most chat tools also accept.

import { assertPublicUrl, redirectMode } from '../core/netguard.mjs';
import crypto from 'node:crypto';

const MAX_IDS_IN_MESSAGE = 20;
const pct = x => `${Math.round(x * 1000) / 10}%`;
// Slack treats &, < and > as control characters in mrkdwn.
const slackEsc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function incidentKey(caseIds, belowAcceptance) {
  return crypto.createHash('sha256').update(JSON.stringify([[...caseIds].sort(), !!belowAcceptance])).digest('hex').slice(0, 32);
}

function idText(ids) {
  const shown = ids.slice(0, MAX_IDS_IN_MESSAGE).map(id => `\`${slackEsc(id)}\``).join(', ');
  return ids.length > MAX_IDS_IN_MESSAGE ? `${shown} and ${ids.length - MAX_IDS_IN_MESSAGE} more` : shown;
}

function alertPayload({ results, caseIds, belowAcceptance, reportPath, update }) {
  const s = results.summary;
  const who = `${results.customer} / ${results.deployment}`;
  const what = [
    caseIds.length ? `${caseIds.length} regressed case${caseIds.length === 1 ? '' : 's'}` : '',
    belowAcceptance ? `pass rate ${pct(s.passRate)} is below the agreed ${pct(s.minPassRate)}` : '',
  ].filter(Boolean).join('; ');
  // Slack parses the top-level text as mrkdwn too (notifications), so it is escaped like the blocks.
  const text = slackEsc(`${update ? 'Updated' : 'New'} Delomu alert for ${who}: ${what}.`);
  const lines = [`*${text}*`];
  if (caseIds.length) lines.push(`Regressed: ${idText(caseIds)}`);
  lines.push(`Pass rate ${pct(s.passRate)} (need ${pct(s.minPassRate)}), run \`${slackEsc(results.runId)}\``);
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Comparison report: ${slackEsc(reportPath)}` }] },
    ],
  };
}

function resolvedPayload({ results, reportPath }) {
  const text = slackEsc(`Resolved: Delomu alert for ${results.customer} / ${results.deployment}. Pass rate is ${pct(results.summary.passRate)} and no regressed cases remain.`);
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${text}*` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Comparison report: ${slackEsc(reportPath)}` }] },
    ],
  };
}

// True when some alert of this incident reached the channel: the latest one (notified is not false)
// or an earlier one (announced).
export const wasAnnounced = incident => !!incident && (incident.notified !== false || incident.announced === true);

// Decides the next incident state and whether to send a message. Pure: no I/O.
// Returns { incident, message: null | { type: 'alert' | 'resolved', key, payload } }.
export function evaluateIncident(incident, { diff, results, reportPath, now }) {
  const notPassing = new Set(results.cases.filter(c => c.status !== 'pass').map(c => c.id));
  const stillOpen = (incident?.caseIds ?? []).filter(id => notPassing.has(id));
  const caseIds = [...new Set([...stillOpen, ...diff.regressions.map(r => r.id)])].sort();
  const belowAcceptance = results.summary.verdict === 'not_accepted';

  if (!caseIds.length && !belowAcceptance) {
    // Nothing to resolve if no alert was open, or if none of its alerts ever reached anyone.
    if (!wasAnnounced(incident)) return { incident: null, message: null };
    return { incident: null, message: { type: 'resolved', key: incident.key, payload: resolvedPayload({ results, reportPath }) } };
  }

  const key = incidentKey(caseIds, belowAcceptance);
  if (incident?.key === key && incident.notified !== false) return { incident, message: null };
  const announced = wasAnnounced(incident);
  const next = { key, caseIds, belowAcceptance, openedAt: incident?.openedAt ?? now.toISOString(), updatedAt: now.toISOString(), announced };
  return { incident: next, message: { type: 'alert', key, payload: alertPayload({ results, caseIds, belowAcceptance, reportPath, update: announced }) } };
}

// Posts the payload. Throws on a network error, a timeout or a non-2xx response. The URL carries the
// webhook's token, so it is cut out of any error message (fetch quotes it, e.g. "Failed to parse URL from ...").
export async function postWebhook(url, payload, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('webhook URL must start with http:// or https://');
  let res;
  try {
    await assertPublicUrl(url);
    res = await fetchImpl(url, {
      redirect: redirectMode(),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new Error(String(e.message).split(url).join('<webhook URL>'));
  }
  if (!res.ok) throw new Error(`webhook answered HTTP ${res.status}`);
}
