// Org-level audit events (who did what in which org, from where), cursor-paged newest first, and a
// CSV export that also folds in every deployment's hash-chained audit.jsonl, for compliance reviews.

import { newId, parseJson } from './db.mjs';
import { decodeCursor, encodeCursor, invalid, listObject, pageLimit } from './http.mjs';

export function recordEvent(db, { orgId, actor, action, target = '', detail = {}, ip = '' }, now = new Date()) {
  if (!orgId || !actor || !action) throw new Error('audit event needs orgId, actor and action');
  const id = newId('evt');
  db.prepare('INSERT INTO audit_events (id, org_id, ts, actor, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, orgId, now.toISOString(), actor, action, String(target), JSON.stringify(detail), ip);
  return id;
}

const eventObject = r => ({
  object: 'audit_event', id: r.id, ts: r.ts, actor: r.actor, action: r.action, target: r.target, detail: parseJson(r.detail, {}), ip: r.ip,
});

export function listEvents(db, orgId, searchParams) {
  const limit = pageLimit(searchParams, 50);
  const cursor = searchParams.get('cursor');
  let before = Number.MAX_SAFE_INTEGER;
  if (cursor) {
    before = decodeCursor(cursor);
    if (!Number.isInteger(before)) throw invalid('Invalid cursor.', 'cursor');
  }
  const rows = db.prepare('SELECT * FROM audit_events WHERE org_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?').all(orgId, before, limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return listObject(page.map(eventObject), hasMore, hasMore ? encodeCursor(page.at(-1).seq) : null);
}

export const allEvents = (db, orgId) => db.prepare('SELECT * FROM audit_events WHERE org_id = ? ORDER BY seq').all(orgId).map(eventObject);

// A leading = + - @ (or tab/CR) makes spreadsheets run the cell as a formula; prefix those with a quote.
function csvCell(value) {
  let s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// orgEvents: from allEvents; deployments: [{ name, entries, verify }] from each audit.jsonl.
export function eventsCsv(orgEvents, deployments) {
  const lines = [['source', 'id', 'ts', 'actor', 'action', 'target', 'detail', 'ip', 'chain'].join(',')];
  for (const e of orgEvents) lines.push(['org', e.id, e.ts, e.actor, e.action, e.target, e.detail, e.ip, ''].map(csvCell).join(','));
  for (const d of deployments) {
    const chain = d.verify.ok ? 'intact' : `broken at ${d.verify.brokenAt}: ${d.verify.reason}`;
    for (const e of d.entries) lines.push([`deployment:${d.name}`, e.seq, e.ts, e.actor, e.action, e.target, e.detail, '', chain].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
