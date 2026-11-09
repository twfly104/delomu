// Client questions on a sign-off link. The client's reviewer asks about one rule (or the agent in general) from the
// sign-off page, without an account; the question lands in the vendor's "Waiting for your decision" list and on the
// Rollout page, where the team answers it; the answer shows on the same link. Kept in the deployment folder
// (questions.json, oldest first) and in its audit log.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';

const file = dir => path.join(dir, 'questions.json');
export const MAX_QUESTION = 1000;
export const MAX_OPEN_PER_LINK = 20;

export function listQuestions(dir) {
  try { const all = JSON.parse(fs.readFileSync(file(dir), 'utf8')); return Array.isArray(all) ? all : []; } catch { return []; }
}
export const openQuestions = dir => listQuestions(dir).filter(q => !q.answer);
const save = (dir, all) => fs.writeFileSync(file(dir), JSON.stringify(all, null, 2) + '\n');

// rule: a rule id from the check the link opens, or '' for the agent in general. Returns the stored question, or
// { error } when it cannot be accepted.
export function askQuestion(dir, { rule = '', ruleTitle = '', text, name, shareId, scanId, ip = '' }, now = new Date()) {
  const q = {
    id: `q_${crypto.randomBytes(6).toString('hex')}`,
    rule: String(rule ?? '').slice(0, 120), ruleTitle: String(ruleTitle ?? '').trim().slice(0, 120),
    text: String(text ?? '').trim().slice(0, MAX_QUESTION), name: String(name ?? '').trim().slice(0, 120),
    shareId, scanId, at: now.toISOString(),
  };
  if (!q.name) return { error: 'Enter your name so the team knows who asked.' };
  if (!q.text) return { error: 'Write your question.' };
  const all = listQuestions(dir);
  if (all.filter(x => x.shareId === shareId && !x.answer).length >= MAX_OPEN_PER_LINK) return { error: 'This link already has many unanswered questions. Wait for the team to answer them first.' };
  all.push(q);
  save(dir, all);
  appendAudit(dir, { actor: `client:${q.name}`, action: 'signoff.question', target: q.id, detail: { rule: q.rule, share: shareId, ip } }, now);
  return { question: q };
}

export function answerQuestion(dir, id, { answer, by }, now = new Date()) {
  const all = listQuestions(dir);
  const q = all.find(x => x.id === id);
  if (!q) return { error: 'That question no longer exists.' };
  const text = String(answer ?? '').trim().slice(0, MAX_QUESTION);
  if (!text) return { error: 'Write the answer first.' };
  Object.assign(q, { answer: text, answeredBy: String(by ?? '').replace(/^human:/, ''), answeredAt: now.toISOString() });
  save(dir, all);
  appendAudit(dir, { actor: by, action: 'signoff.answer', target: id, detail: { rule: q.rule } }, now);
  return { question: q };
}
