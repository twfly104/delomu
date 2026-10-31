// Deployment folders on disk for a multi-tenant server: each org's deployments live in
// deploymentsRoot/<orgId>/<name>. Names are validated strictly and every path is re-checked to stay
// inside the org's folder. Also: run listing, the per-deployment run lock, draft appliers, audit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendAudit, readAudit, verifyAudit } from '../core/audit.mjs';
import { writeTests } from '../commands/v0.mjs';
import { paths } from '../deployment.mjs';
import { ApiError, invalid } from './http.mjs';

const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const RUN_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{3})?Z$/;
const ENV_REF = /\$\{([^}]*)\}/g;
const MAX_CASES_BYTES = 512 * 1024;

export function checkDeploymentName(name) {
  if (typeof name !== 'string' || !NAME.test(name) || WINDOWS_RESERVED.test(name)) {
    throw invalid('name must be 1 to 63 lowercase letters, digits or dashes, starting and ending with a letter or digit.', 'name');
  }
  return name;
}

export function deploymentDir(root, orgId, name) {
  checkDeploymentName(name);
  const base = path.resolve(root, orgId);
  const dir = path.resolve(base, name);
  const rel = path.relative(base, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) throw invalid('Invalid deployment name.', 'name');
  return dir;
}

// Targets run on this server, so a tenant may not run shell commands (unless the operator allows it)
// and may only reference environment variables with the operator's prefix (default CUSTOMER_).
export function checkTarget(config, { allowCommandTargets = false, envPrefix = 'CUSTOMER_' } = {}) {
  const target = config?.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw invalid('config.target must be an object.', 'config');
  if (!['http', 'command'].includes(target.type)) throw invalid('config.target.type must be "http" or "command".', 'config');
  if (target.type === 'command' && !allowCommandTargets) {
    throw new ApiError('permission_error', 'Command targets are disabled on this server; use an http target.');
  }
  if (target.type === 'http') {
    let url;
    try { url = new URL(target.url); } catch { throw invalid('config.target.url must be a URL.', 'config'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw invalid('config.target.url must use http or https.', 'config');
  }
  for (const [, name] of JSON.stringify(target).matchAll(ENV_REF)) {
    if (!name.startsWith(envPrefix)) throw new ApiError('permission_error', `Targets may only reference environment variables starting with ${envPrefix}.`);
  }
}

const deploymentObject = (r, dir) => ({ object: 'deployment', name: r.name, created_at: r.created_at, created_by: r.created_by, has_config: fs.existsSync(paths(dir).config) });

export function listDeployments(db, root, orgId) {
  return db.prepare('SELECT * FROM deployments WHERE org_id = ? ORDER BY name').all(orgId)
    .map(r => deploymentObject(r, deploymentDir(root, orgId, r.name)));
}

// Returns { deployment, dir } or null.
export function findDeployment(db, root, orgId, name) {
  const dir = deploymentDir(root, orgId, name);
  const row = db.prepare('SELECT * FROM deployments WHERE org_id = ? AND name = ?').get(orgId, name);
  return row ? { deployment: deploymentObject(row, dir), dir } : null;
}

// Registers a deployment. config is written as delomu.json; cases (CSV text) become cases.csv and tests.json.
// A folder an operator already placed on disk can be registered without config.
export function registerDeployment(db, root, orgId, { name, config, cases }, { actor, policy }, now = new Date()) {
  const dir = deploymentDir(root, orgId, name);
  if (db.prepare('SELECT 1 FROM deployments WHERE org_id = ? AND name = ?').get(orgId, name)) {
    throw new ApiError('conflict_error', `Deployment ${name} already exists.`);
  }
  const p = paths(dir);
  const hasConfig = fs.existsSync(p.config);
  if (config !== undefined) {
    if (hasConfig) throw new ApiError('conflict_error', 'This folder already has a delomu.json; register it without config.');
    checkTarget(config, policy);
  } else if (!hasConfig) {
    throw invalid('config is required for a new deployment.', 'config');
  }
  if (cases !== undefined && (typeof cases !== 'string' || !cases.trim() || Buffer.byteLength(cases) > MAX_CASES_BYTES)) {
    throw invalid(`cases must be non-empty CSV text up to ${MAX_CASES_BYTES} bytes.`, 'cases');
  }

  fs.mkdirSync(dir, { recursive: true });
  if (config !== undefined) fs.writeFileSync(p.config, JSON.stringify(config, null, 2) + '\n');
  let problems = [];
  let tests = null;
  if (cases !== undefined) {
    fs.writeFileSync(p.cases, cases);
    const built = writeTests(dir);
    problems = built.problems;
    tests = built.tests.length;
  }
  db.prepare('INSERT INTO deployments (org_id, name, created_by, created_at) VALUES (?, ?, ?, ?)').run(orgId, name, actor, now.toISOString());
  appendAudit(dir, { actor, action: 'deployment.register', target: name, detail: { tests } }, now);
  return { ...findDeployment(db, root, orgId, name).deployment, tests, problems };
}

function readResults(dir, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(paths(dir).runs, id, 'results.json'), 'utf8'));
  } catch {
    return null;
  }
}

export const runObject = r => ({
  object: 'run', id: r.runId, generated_at: r.generatedAt, judge: r.judge,
  summary: { total: r.summary.total, pass: r.summary.pass, fail: r.summary.fail, needs_review: r.summary.needs_review, error: r.summary.error, pass_rate: r.summary.passRate, verdict: r.summary.verdict },
});

export function listRuns(dir) {
  const runs = paths(dir).runs;
  if (!fs.existsSync(runs)) return [];
  return fs.readdirSync(runs).filter(id => RUN_ID.test(id)).sort().reverse()
    .map(id => readResults(dir, id)).filter(Boolean).map(runObject);
}

// Path of a run's report.html, or null when the run id is malformed or missing.
export function reportFile(dir, runId) {
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) return null;
  const file = path.join(paths(dir).runs, runId, 'report.html');
  return fs.existsSync(file) ? file : null;
}

// In-process locks. One run at a time per deployment (run ids have one-second resolution and share a
// folder), and one review at a time per draft, because applying is async and must not happen twice.
const held = new Set();
async function withLock(key, message, fn) {
  if (held.has(key)) throw new ApiError('conflict_error', message);
  held.add(key);
  try { return await fn(); } finally { held.delete(key); }
}

export const withRunLock = (dir, fn) => withLock(`run:${dir}`, 'A run is already in progress for this deployment.', fn);
export const withDraftLock = (dir, id, fn) => withLock(`draft:${dir}:${id}`, `Draft ${id} is already being reviewed.`, fn);

// Draft appliers are registered by command files at import time; load them all once before any review.
const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands');
let appliersLoaded;
export function loadAppliers() {
  appliersLoaded ??= (async () => {
    const failures = [];
    for (const f of fs.readdirSync(commandsDir).filter(f => f.endsWith('.mjs')).sort()) {
      try { await import(pathToFileURL(path.join(commandsDir, f)).href); } catch (e) { failures.push(`${f}: ${e.message}`); }
    }
    return failures;
  })();
  return appliersLoaded;
}

export function deploymentAudit(dir) {
  return { entries: readAudit(dir), verify: verifyAudit(dir) };
}
