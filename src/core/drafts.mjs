// Human-in-the-loop store. Agents never change a deployment directly: they create a draft,
// a person approves, edits or rejects it, and only an approved draft is applied.
// Each draft kind registers an applier that knows how to apply its content.
//
// drafts/<id>.json: { id, kind, step, status: pending|approved|rejected, createdAt, createdBy,
//                     rationale, content, reviewedAt?, reviewedBy?, note?, edited? }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendAudit } from './audit.mjs';

const appliers = new Map();
const draftsDir = dir => path.join(dir, 'drafts');

// apply(dir, content) performs the change; it may return a short summary string.
export function registerApplier(kind, apply) {
  appliers.set(kind, apply);
}

export function createDraft(dir, { kind, step, content, rationale = '', actor = 'agent' }, now = new Date()) {
  if (!kind || content === undefined) throw new Error('draft needs kind and content');
  const id = `${now.toISOString().slice(0, 10)}-${kind}-${crypto.randomBytes(3).toString('hex')}`;
  const draft = { id, kind, step: step ?? null, status: 'pending', createdAt: now.toISOString(), createdBy: actor, rationale, content };
  fs.mkdirSync(draftsDir(dir), { recursive: true });
  fs.writeFileSync(path.join(draftsDir(dir), `${id}.json`), JSON.stringify(draft, null, 2) + '\n');
  appendAudit(dir, { actor, action: 'draft.create', target: id, detail: { kind, step } }, now);
  return draft;
}

export function getDraft(dir, id) {
  if (!/^[\w.-]+$/.test(id)) throw new Error('invalid draft id');
  const f = path.join(draftsDir(dir), `${id}.json`);
  if (!fs.existsSync(f)) throw new Error(`no draft ${id}`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export function listDrafts(dir, { status } = {}) {
  if (!fs.existsSync(draftsDir(dir))) return [];
  return fs.readdirSync(draftsDir(dir)).filter(f => f.endsWith('.json')).sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(draftsDir(dir), f), 'utf8')))
    .filter(d => !status || d.status === status);
}

// decision: "approve" | "reject". Passing content on approve records a human edit before applying.
export async function reviewDraft(dir, id, { decision, by, note = '', content }, now = new Date()) {
  if (!by) throw new Error('review needs the reviewer name (by)');
  if (!['approve', 'reject'].includes(decision)) throw new Error('decision must be approve or reject');
  const draft = getDraft(dir, id);
  if (draft.status !== 'pending') throw new Error(`draft ${id} is already ${draft.status}`);
  const actor = `human:${by}`;

  let summary = '';
  if (decision === 'approve') {
    const apply = appliers.get(draft.kind);
    if (!apply) throw new Error(`no applier registered for draft kind "${draft.kind}"`);
    if (content !== undefined) { draft.content = content; draft.edited = true; }
    summary = (await apply(dir, draft.content)) ?? '';
  }
  Object.assign(draft, { status: decision === 'approve' ? 'approved' : 'rejected', reviewedAt: now.toISOString(), reviewedBy: by, note });
  fs.writeFileSync(path.join(draftsDir(dir), `${id}.json`), JSON.stringify(draft, null, 2) + '\n');
  appendAudit(dir, { actor, action: `draft.${draft.status}`, target: id, detail: { kind: draft.kind, edited: !!draft.edited, note, summary } }, now);
  return draft;
}
