// Reads a deployment folder and works out what a person needs to see: where the rollout is in the six
// steps, the run history, the latest failures and the one next action. Pure reads; no writes.

import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../deployment.mjs';
import { listDrafts } from '../core/drafts.mjs';
import { readAudit } from '../core/audit.mjs';
import { listScans } from '../v1/risk.mjs';
import { liveSummary } from '../v1/live.mjs';
import { policiesChanged } from '../v1/policies.mjs';

export const STEPS = [
  { key: 'mapping', label: 'Data mapping' },
  { key: 'integration', label: 'Integration' },
  { key: 'cases', label: 'Test set' },
  { key: 'fixes', label: 'Test and fix' },
  { key: 'launch-report', label: 'Launch report' },
  { key: 'monitoring', label: 'Monitoring' },
];

export const KIND_LABEL = {
  mapping: 'Data mapping', integration: 'Integration', cases: 'Test cases', fixes: 'Fixes', 'launch-report': 'Launch report', connector: 'Client-system connector',
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

// What a running check is reading: each policy file with its section headings (Markdown "#" lines or numbered
// lines), so the first, longest step shows the material itself instead of a bare bar. Ticket exports are skipped.
export function policyOutline(dir, { maxFiles = 6, maxSections = 10 } = {}) {
  return inputFiles(dir).filter(f => !/\.csv$/i.test(f.name)).slice(0, maxFiles).map(f => {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, 'inputs', f.name), 'utf8').slice(0, 200_000); } catch { /* unreadable: name only */ }
    const heads = text.split(/\r?\n/).map(l => /^#{1,3}\s+(.+?)\s*#*$/.exec(l)?.[1] ?? /^(\d{1,2}\.\s+[A-Z].{2,70})$/.exec(l.trim())?.[1]).filter(Boolean);
    return { name: f.name, sections: heads.length, headings: heads.slice(0, maxSections).map(h => h.replace(/[*_`]/g, '').slice(0, 80)) };
  });
}

// state: done | review (a draft waits) | attention (tests failing) | todo
export function stepStates(dir, { drafts, runs, config, scans = listScans(dir) }) {
  const pending = new Set(drafts.filter(d => d.status === 'pending').map(d => d.kind));
  const tests = readJson(paths(dir).tests)?.tests?.length ?? 0;
  const latest = runs.at(-1);
  // Test and fix counts whichever ran last: a policy check (scans/) or a run of the saved test set (runs/).
  const scan = scans[0];
  const scanFirst = scan && (!latest || String(scan.createdAt ?? '') >= String(latest.generatedAt ?? ''));
  const has = file => fs.existsSync(path.join(dir, file));
  const s = (state, detail) => ({ state, detail });

  const by = {
    mapping: pending.has('mapping') ? s('review', 'Draft waiting') : has('mapping.json') ? s('done', 'Approved') : s('todo', 'Not started'),
    integration: pending.has('integration') ? s('review', 'Draft waiting') : config?.target ? s('done', config.target.type === 'http' ? 'HTTP endpoint' : 'Command') : s('todo', 'Not connected'),
    cases: pending.has('cases') ? s('review', 'Draft waiting') : tests ? s('done', `${tests} cases`) : s('todo', 'No cases yet'),
    fixes: pending.has('fixes') ? s('review', 'Draft waiting')
      : scanFirst ? (scan.summary.broken ? s('attention', `${scan.summary.broken} of ${scan.summary.rules} rules broken`) : s('done', `All ${scan.summary.rules} rules kept`))
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
  if (inputs && !scans) return { text: 'Run the check.', action: 'scan' };
  if (step.key === 'mapping' && !inputs) return { text: 'Add your policies, and a ticket export if you have one, so Grapim can start.', action: 'inputs' };
  if (['mapping', 'integration', 'cases'].includes(step.key) && step.state === 'todo') return { text: `Ask the agent to draft the ${step.label.toLowerCase()}.`, action: 'agent', task: step.key };
  if (step.key === 'fixes' && /rules broken$/.test(step.detail ?? '')) return { text: `The last check found ${step.detail}. Approve the drafted fix on Check results; the same messages run again.`, action: null };
  if (step.key === 'fixes' && !runs) return { text: 'Run the saved test set against your AI.', action: 'run' };
  if (step.key === 'fixes') return { text: 'Tests are below the agreed pass rate. Ask the agent to group the failures into fixes, then run again.', action: 'agent', task: 'fixes' };
  if (step.key === 'launch-report') return { text: 'Tests pass. Ask the agent to draft the launch report for sign-off.', action: 'agent', task: 'launch-report' };
  if (step.key === 'monitoring' && step.state === 'todo') return { text: 'Launched. Turn on Monitoring on the Rollout page so any change re-runs the tests.', action: null };
  return { text: 'Everything is up to date.', action: null };
}

export function overview(dir, config) {
  const drafts = listDrafts(dir);
  const runs = runHistory(dir);
  const inputs = inputFiles(dir);
  const scans = listScans(dir);
  const steps = stepStates(dir, { drafts, runs, config, scans });
  const pending = drafts.filter(d => d.status === 'pending');
  return {
    drafts, pending, runs, inputs, steps, scans, live: liveSummary(dir), policiesChanged: policiesChanged(dir, scans[0]),
    latest: runs.at(-1) ?? null,
    current: currentStep(steps),
    next: nextAction(steps, { pending: pending.length, runs: runs.length, inputs: inputs.length, scans: scans.length }),
    // Reads of customer material are kept in the audit log but are noise in a feed.
    activity: readAudit(dir).filter(e => !e.action.startsWith('input.read') && !e.action.startsWith('input.denied')).slice(-8).reverse(),
  };
}
