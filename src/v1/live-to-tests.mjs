// A live conversation that broke a rule becomes test messages: the customer's message (already scrubbed of
// personal data when it was stored) is drafted into the saved test set once per broken rule, so the next check and
// every monitoring re-run send it again. A draft, like every other change: a person approves it.

import fs from 'node:fs';
import { appendAudit } from '../core/audit.mjs';
import { createDraft, listDrafts } from '../core/drafts.mjs';
import { caseIds, readCases } from './appliers.mjs';
import { listConversations, liveDir } from './live.mjs';

function findConversation(dir, id) {
  if (!fs.existsSync(liveDir(dir))) return null;
  const months = fs.readdirSync(liveDir(dir)).filter(f => /^\d{4}-\d{2}\.jsonl$/.test(f)).map(f => f.slice(0, 7)).sort().reverse();
  for (const m of months) { const c = listConversations(dir, m).find(x => x.id === id); if (c) return c; }
  return null;
}

// Returns { ok: true, draft, existing } or { ok: false, reason }.
export function conversationToTests(dir, id, { actor = 'agent', now = new Date() } = {}) {
  const c = findConversation(dir, id);
  if (!c) return { ok: false, reason: 'That conversation is no longer stored.' };
  if (c.status !== 'flagged' || !c.violations.length) return { ok: false, reason: 'Only a conversation that broke a rule can become a test.' };
  const pending = listDrafts(dir, { status: 'pending' });
  const same = pending.find(d => d.kind === 'cases' && d.content?.fromConversation === c.id);
  if (same) return { ok: true, draft: same, existing: true };
  const taken = caseIds(readCases(dir));
  for (const d of pending) for (const r of d.content?.rows ?? []) taken.add(r.id);
  const rows = c.violations.map(v => {
    let rowId = `live-${String(v.rule || 'rule').replace(/[^a-z0-9-]/gi, '').slice(0, 40)}-${c.id.slice(3, 9)}`;
    while (taken.has(rowId)) rowId += 'b';
    taken.add(rowId);
    return { id: rowId, input: c.message, expected: `Keeps the rule: ${v.text ?? v.rule}${v.clause ? ` (${v.clause})` : ''}`, must_include: '', must_not_include: '', regex: '', tags: ['live', v.severity ?? 'medium', v.rule ?? ''].filter(Boolean).join('|') };
  });
  const draft = createDraft(dir, {
    kind: 'cases', step: 3, actor,
    content: { rows, fromConversation: c.id },
    rationale: `From a live conversation on ${c.at.slice(0, 10)} that broke ${c.violations.length} rule${c.violations.length === 1 ? '' : 's'}. Saving ${rows.length === 1 ? 'this test message' : `these ${rows.length} test messages`} sends the same customer message on every check from now on.`,
  }, now);
  appendAudit(dir, { actor, action: 'live.to_tests', target: c.id, detail: { draft: draft.id, rows: rows.length } }, now);
  return { ok: true, draft, existing: false };
}
