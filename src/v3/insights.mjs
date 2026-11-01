// Reads a deployment folder and works out what a person needs to see: where the rollout is in the six
// steps, the run history, the latest failures and the one next action. Pure reads; no writes.

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../deployment.mjs';
import { listDrafts } from '../core/drafts.mjs';
import { readAudit } from '../core/audit.mjs';
import { listScans } from '../v1/risk.mjs';
import { liveSummary } from '../v1/live.mjs';

export const STEPS = [
  { key: 'mapping', label: 'Data mapping' },
  { key: 'integration', label: 'Integration' },
  { key: 'cases', label: 'Test set' },
  { key: 'fixes', label: 'Test and fix' },
  { key: 'launch-report', label: 'Launch report' },
  { key: 'monitoring', label: 'Monitoring' },
];

export const KIND_LABEL = {
  mapping: 'Data mapping', integration: 'Integration', cases: 'Test cases', fixes: 'Fixes', 'launch-report': 'Launch report',
};

const readJson = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// Runs oldest first, each numbered from 1 so people can say "run 3" instead of a timestamp.
export function runHistory(dir) {
  const root = paths(dir).runs;
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort()
    .map(id => readJson(path.join(root, id, 'results.json')))
    .filter(r => r?.summary)
    .map((r, i) => ({ ...r, number: i + 1 }));
}

export function inputFiles(dir) {
  const root = path.join(dir, 'inputs');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isFile())
    .map(e => { const s = fs.statSync(path.join(root, e.name)); return { name: e.name, size: s.size, modified: s.mtime.toISOString() }; })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// state: done | review (a draft waits) | attention (tests failing) | todo
export function stepStates(dir, { drafts, runs, config }) {
  const pending = new Set(drafts.filter(d => d.status === 'pending').map(d => d.kind));
  const tests = readJson(paths(dir).tests)?.tests?.length ?? 0;
  const latest = runs.at(-1);
  const has = file => fs.existsSync(path.join(dir, file));
  const s = (state, detail) => ({ state, detail });

  const by = {
    mapping: pending.has('mapping') ? s('review', 'Draft waiting') : has('mapping.json') ? s('done', 'Approved') : s('todo', 'Not started'),
    integration: pending.has('integration') ? s('review', 'Draft waiting') : config?.target ? s('done', config.target.type === 'http' ? 'HTTP endpoint' : 'Command') : s('todo', 'Not connected'),
    cases: pending.has('cases') ? s('review', 'Draft waiting') : tests ? s('done', `${tests} cases`) : s('todo', 'No cases yet'),
    fixes: pending.has('fixes') ? s('review', 'Draft waiting')
      : !latest ? s('todo', 'Not run yet')
      : latest.summary.verdict === 'accepted' ? s('done', `${latest.summary.pass}/${latest.summary.total} passing`)
      : s('attention', `${latest.summary.pass}/${latest.summary.total} passing`),
    'launch-report': pending.has('launch-report') ? s('review', 'Draft waiting') : has('launch-summary.md') ? s('done', 'Approved') : s('todo', 'Not written'),
    monitoring: has('monitor.json') ? s('done', 'Watching') : s('todo', 'Off'),
  };
  return STEPS.map(step => ({ ...step, ...by[step.key] }));
}

// The step to show as "where this rollout is": one waiting on a person first, then failing tests,
// then the first step not started after the furthest one done (earlier skipped steps do not hold it back).
export function currentStep(steps) {
  const lastDone = steps.findLastIndex(s => s.state === 'done');
  return steps.find(s => s.state === 'review')
    ?? steps.find(s => s.state === 'attention')
    ?? steps.slice(lastDone + 1).find(s => s.state !== 'done')
    ?? steps.find(s => s.state !== 'done')
    ?? steps.at(-1);
}

// The single most useful thing to do next, as { text, action } where action names a control on the page.
export function nextAction(steps, { pending, runs, inputs, scans = 1 }) {
  if (pending) return { text: `${pending} draft${pending > 1 ? 's' : ''} from the agent ${pending > 1 ? 'are' : 'is'} waiting for your decision.`, action: 'review' };
  const step = currentStep(steps);
  if (inputs && !scans) return { text: 'Run the check: Delomu reads your policies, writes the messages most likely to make your AI break them, and checks every answer.', action: 'scan' };
  if (step.key === 'mapping' && !inputs) return { text: 'Add your policies, and a ticket export if you have one, so Delomu can start.', action: 'inputs' };
  if (['mapping', 'integration', 'cases'].includes(step.key) && step.state === 'todo') return { text: `Ask the agent to draft the ${step.label.toLowerCase()}.`, action: 'agent', task: step.key };
  if (step.key === 'fixes' && !runs) return { text: 'Run the saved test set against your AI.', action: 'run' };
  if (step.key === 'fixes') return { text: 'Tests are below the agreed pass rate. Ask the agent to group the failures into fixes, then run again.', action: 'agent', task: 'fixes' };
  if (step.key === 'launch-report') return { text: 'Tests pass. Ask the agent to draft the launch report for sign-off.', action: 'agent', task: 'launch-report' };
  if (step.key === 'monitoring' && step.state === 'todo') return { text: 'Launched. Turn on monitoring (delomu watch) so any change re-runs the tests.', action: null };
  return { text: 'Everything is up to date.', action: null };
}

export function overview(dir, config) {
  const drafts = listDrafts(dir);
  const runs = runHistory(dir);
  const inputs = inputFiles(dir);
  const steps = stepStates(dir, { drafts, runs, config });
  const pending = drafts.filter(d => d.status === 'pending');
  const scans = listScans(dir);
  return {
    drafts, pending, runs, inputs, steps, scans, live: liveSummary(dir),
    latest: runs.at(-1) ?? null,
    current: currentStep(steps),
    next: nextAction(steps, { pending: pending.length, runs: runs.length, inputs: inputs.length, scans: scans.length }),
    // Reads of customer material are kept in the audit log but are noise in a feed.
    activity: readAudit(dir).filter(e => !e.action.startsWith('input.read') && !e.action.startsWith('input.denied')).slice(-8).reverse(),
  };
}
