// Gate 1 of the plan: does the agent make deployments cheaper? Finds every deployment under a root,
// orders them by when they started, totals the engineer hours logged in each hours.csv, and checks
// whether the 5th deployment took under half the hours of the 1st.

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from '../csv.mjs';
import { paths, hoursByStep } from '../deployment.mjs';
import { readAudit } from '../core/audit.mjs';

const SKIP = new Set(['node_modules', '.git', 'runs', 'drafts', 'inputs']);
const MAX_DEPTH = 4;

// Folders under root (root included) that hold a delomu.json, without following symlinks.
export function findDeploymentDirs(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`${root} is not a folder`);
  const out = [];
  const walk = (dir, depth) => {
    if (fs.existsSync(paths(dir).config)) out.push(dir);
    if (depth >= MAX_DEPTH) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

// When a deployment started: delomu.json "createdAt" if set, else the earliest of the first hours.csv
// date and the first audit entry, else the config file's modification time.
export function startedAt(dir) {
  const config = JSON.parse(fs.readFileSync(paths(dir).config, 'utf8'));
  if (config.createdAt && !Number.isNaN(Date.parse(config.createdAt))) return new Date(config.createdAt);
  const seen = [];
  if (fs.existsSync(paths(dir).hours)) {
    for (const r of parseCsv(fs.readFileSync(paths(dir).hours, 'utf8'))) if (!Number.isNaN(Date.parse(r.date))) seen.push(new Date(r.date));
  }
  const first = readAudit(dir)[0];
  if (first) seen.push(new Date(first.ts));
  if (seen.length) return new Date(Math.min(...seen));
  return fs.statSync(paths(dir).config).mtime;
}

export const compareHours = root => compareDeployments(findDeploymentDirs(root));

// The same comparison over a given list of deployment folders (the web app passes an org's own).
export function compareDeployments(dirs) {
  const deployments = dirs.map(dir => {
    const byStep = hoursByStep(dir);
    const total = Object.values(byStep).reduce((a, b) => a + b, 0);
    return { dir, startedAt: startedAt(dir), total, byStep };
  }).sort((a, b) => a.startedAt - b.startedAt || a.dir.localeCompare(b.dir));

  // A hand-edited hours.csv with a non-numeric value makes a total NaN; say which one instead of comparing it.
  const broken = [0, 4].find(i => deployments[i] && !Number.isFinite(deployments[i].total)) ?? -1;
  let gate;
  if (broken !== -1) gate = { status: 'not_enough_data', message: `deployment ${broken + 1} (${deployments[broken].dir}) has non-numeric hours in hours.csv` };
  else if (deployments.length < 5) gate = { status: 'not_enough_data', message: `need 5 deployments, found ${deployments.length}` };
  else if (deployments[0].total <= 0 || deployments[4].total <= 0) {
    gate = { status: 'not_enough_data', message: `deployment ${deployments[0].total <= 0 ? 1 : 5} has no hours logged` };
  }
  else {
    const [first, fifth] = [deployments[0].total, deployments[4].total];
    const met = fifth < first / 2;
    gate = { status: met ? 'met' : 'not_met', message: `deployment 5 used ${fifth.toFixed(1)} h, ${(100 * fifth / first).toFixed(0)}% of deployment 1 (${first.toFixed(1)} h); target is under 50%` };
  }
  return { deployments, gate };
}
