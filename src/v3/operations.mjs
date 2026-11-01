// Operations shared by the JSON API and the web UI, so both enforce the same rules: org access checks,
// starting a run, reviewing a draft and the audit overview. Each one records an org audit event.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDraft, listDrafts, reviewDraft } from '../core/drafts.mjs';
import { loadConfig } from '../deployment.mjs';
import { runDeployment } from '../run.mjs';
import { getOrg } from './accounts.mjs';
import { recordEvent } from './events.mjs';
import { ApiError, forbidden, invalid, notFound } from './http.mjs';
import { principalAllows, roleIn } from './rbac.mjs';
import { checkTarget, deploymentAudit, findDeployment, listDeployments, loadAppliers, runObject, withDraftLock, withRunLock } from './workspace.mjs';

const ORG_ID = /^org_[0-9a-f]{16}$/;
const MAX_NOTE = 2000;

// Resolves the org and the principal's role in it. Orgs the principal cannot see are reported as
// missing (404), not forbidden, so ids from other tenants reveal nothing.
export function access(ctx, principal, orgId, permission) {
  const org = ORG_ID.test(orgId) ? getOrg(ctx.db, orgId) : null;
  const role = org ? roleIn(ctx.db, principal, org.id) : null;
  if (!role) throw notFound('org');
  if (!principalAllows(principal, role, permission)) throw forbidden(`Your role (${role}${principal.scopes ? ', restricted key' : ''}) does not allow ${permission}.`);
  return { org, role };
}

export function deploymentFor(ctx, orgId, name) {
  const found = findDeployment(ctx.db, ctx.deploymentsRoot, orgId, name);
  if (!found) throw notFound('deployment');
  return found;
}

export function event(ctx, principal, orgId, action, target, detail = {}) {
  recordEvent(ctx.db, { orgId, actor: principal.actor, action, target, detail: { via: principal.via, ...detail }, ip: principal.ip }, ctx.now());
}

const pathSafe = (message, dir, name) => message.split(dir).join(name);

export async function startRun(ctx, principal, orgId, name, { judge = false } = {}) {
  if (typeof judge !== 'boolean') throw invalid('judge must be true or false.', 'judge');
  const { dir } = deploymentFor(ctx, orgId, name);
  return withRunLock(dir, async () => {
    // Plan limits: refuses (402) a run that would make one deployment too many active this month.
    const release = ctx.billing?.reserveRun(orgId, name) ?? (() => {});
    try {
      return await runOnce(ctx, principal, orgId, name, dir, judge);
    } finally {
      release();
    }
  });
}

async function runOnce(ctx, principal, orgId, name, dir, judge) {
  let results;
  try {
    checkTarget(loadConfig(dir), ctx.policy);
    ({ results } = await runDeployment(dir, { judge: judge ? (ctx.judge ?? true) : false, now: ctx.now() }));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw invalid(`Run could not start: ${pathSafe(e.message, dir, name)}`);
  }
  event(ctx, principal, orgId, 'run.create', `${name}/${results.runId}`, { verdict: results.summary.verdict, judge: results.judge });
  await ctx.billing?.afterRun(orgId, name); // Team overage meter event; never throws
  return runObject(results);
}

export function draftsOf(ctx, orgId, name, status) {
  if (status !== undefined && !['pending', 'approved', 'rejected'].includes(status)) throw invalid('status must be pending, approved or rejected.', 'status');
  return listDrafts(deploymentFor(ctx, orgId, name).dir, { status });
}

export function draftOf(ctx, orgId, name, id) {
  const { dir } = deploymentFor(ctx, orgId, name);
  try { return getDraft(dir, id); } catch { throw notFound('draft'); }
}

let appliersReported = false;

// decision approve|reject; content (optional) is the reviewer's edited version, applied instead of the draft's.
export async function reviewDeploymentDraft(ctx, principal, orgId, name, id, { decision, note = '', content }) {
  const { dir } = deploymentFor(ctx, orgId, name);
  if (!['approve', 'reject'].includes(decision)) throw invalid('decision must be approve or reject.', 'decision');
  if (typeof note !== 'string' || note.length > MAX_NOTE) throw invalid(`note must be text up to ${MAX_NOTE} characters.`, 'note');
  if (content !== undefined && decision !== 'approve') throw invalid('content can only be sent with approve.', 'content');
  const failures = await loadAppliers();
  if (failures.length && !appliersReported) {
    appliersReported = true;
    ctx.log(`some command files could not be loaded, so their draft kinds cannot be applied: ${failures.join('; ')}`);
  }

  return withDraftLock(dir, id, async () => {
    const draft = draftOf(ctx, orgId, name, id);
    if (draft.status !== 'pending') throw new ApiError('conflict_error', `Draft ${id} is already ${draft.status}.`);
    let reviewed;
    try {
      reviewed = await reviewDraft(dir, id, { decision, by: principal.email, note, content }, ctx.now());
    } catch (e) {
      throw invalid(`Draft could not be ${decision === 'approve' ? 'applied' : 'rejected'}: ${pathSafe(e.message, dir, name)}`);
    }
    event(ctx, principal, orgId, `draft.${reviewed.status}`, `${name}/${id}`, { kind: reviewed.kind, edited: !!reviewed.edited });
    return reviewed;
  });
}

// Every deployment's audit.jsonl with its hash-chain status.
export function deploymentAudits(ctx, orgId) {
  return listDeployments(ctx.db, ctx.deploymentsRoot, orgId).map(d => ({ name: d.name, ...deploymentAudit(deploymentFor(ctx, orgId, d.name).dir) }));
}

const monitorFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'v2', 'monitor.mjs');

// Usage metering comes from v2; returns null when v2 is not installed.
export async function orgUsage(ctx, orgId, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw invalid('month must look like 2026-10.', 'month');
  if (!fs.existsSync(monitorFile)) return null;
  const { usage } = await import(pathToFileURL(monitorFile).href);
  if (typeof usage !== 'function') return null;
  const root = path.join(path.resolve(ctx.deploymentsRoot), orgId);
  fs.mkdirSync(root, { recursive: true });
  return usage(root, { month });
}
