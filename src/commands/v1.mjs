// v1 commands: the agent drafts deployment steps 1-5 for an engineer to review, and compare-hours
// measures gate 1 (deployment 5 needs under half the hours of deployment 1).
// The appliers for the shared draft kinds are registered here, at import time, so "delomu review" can apply them.

import path from 'node:path';
import { flag, need } from './args.mjs';
import { registerApplier } from '../core/drafts.mjs';
import { createLlm, isAuthError } from '../core/llm.mjs';
import { APPLIERS } from '../v1/appliers.mjs';
import { TASKS, draftAll } from '../v1/agent.mjs';
import { compareHours } from '../v1/hours.mjs';
import { riskScan } from '../v1/risk.mjs';

for (const [kind, apply] of Object.entries(APPLIERS)) registerApplier(kind, apply);

class MissingCredentials extends Error {}

// Only an error thrown by the model call itself can mean "no credentials"; matching every error's text
// would also catch e.g. "no deployment folder at ./credentials".
const guardCredentials = llm => ({
  ...llm,
  async json(request) {
    try { return await llm.json(request); } catch (e) { throw isAuthError(e) ? new MissingCredentials(e.message) : e; }
  },
});

const AGENT_USAGE =`agent <dir> <${[...Object.keys(TASKS), 'all'].join('|')}> [--limit N]`;

function printResult(dir, task, r) {
  if (!r.ok) { console.log(`${task}: nothing drafted: ${r.reason}`); return; }
  for (const d of r.drafts) {
    const size = d.kind === 'cases' ? ` (${d.content.rows.length} cases)` : '';
    console.log(`${task}: drafted ${d.id}${size}`);
  }
  if (r.skipped?.length) console.log(`  skipped: ${r.skipped.length} (see the draft rationale)`);
}

export const commands = [
  {
    name: 'scan',
    usage: 'scan <dir>',
    summary: "risk scan: the agent reads the customer's policies, writes the messages most likely to break them, runs them against the AI and judges every answer",
    async run(args, { llm } = {}) {
      const dir = need(args[0], 'scan <dir>');
      let r;
      try {
        r = await riskScan(dir, { llm: guardCredentials(llm ?? createLlm()) });
      } catch (e) {
        if (!(e instanceof MissingCredentials)) throw e;
        console.error('error: no model credentials; set ANTHROPIC_API_KEY (Claude) or MODEL_API_KEY (Meta) to run a risk scan.');
        return 2;
      }
      if (!r.ok) { console.log(`scan: nothing done: ${r.reason}`); return 1; }
      const s = r.scan.summary;
      console.log(`${s.broken} of ${s.rules} policy rules broken · ${s.failed} of ${s.probes} probes failed · ${r.scan.model} · ${r.scan.seconds}s`);
      for (const rule of r.scan.rules) {
        const bad = rule.probes.filter(p => p.status === 'broken').length;
        console.log(`  ${bad ? 'BROKEN' : 'kept  '}  [${rule.severity}] ${rule.clause}: ${rule.rule}`);
      }
      console.log(`Probes drafted for the test set: ${r.draft.id}. Review with: delomu review ${dir} ${r.draft.id} approve|reject --by NAME`);
      // A CI gate on must-pass rules: a broken high-risk rule fails the step (exit 3), so a pipeline stops here.
      if (s.highRiskBroken) { console.log(`GATE: ${s.highRiskBroken} high-risk rule${s.highRiskBroken === 1 ? '' : 's'} broken; exit 3.`); return 3; }
      return 0;
    },
  },
  {
    name: 'agent',
    usage: AGENT_USAGE,
    summary: 'let the agent draft steps 1-5 from inputs/ (all = mapping, integration, cases); every draft waits for review',
    async run(args, { llm } = {}) {
      const limitText = flag(args, '--limit');
      const [dir, task] = args;
      need(dir && task, AGENT_USAGE);
      if (task !== 'all' && !TASKS[task]) throw new Error(`unknown agent task "${task}"\nusage: delomu ${AGENT_USAGE}`);
      const limit = limitText === undefined ? undefined : Number(limitText);
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new Error('--limit must be a positive whole number');

      const model = guardCredentials(llm ?? createLlm());
      let results;
      try {
        results = task === 'all' ? await draftAll(dir, { llm: model, limit }) : [{ task, ...(await TASKS[task](dir, { llm: model, limit })) }];
      } catch (e) {
        if (!(e instanceof MissingCredentials)) throw e;
        console.error('error: no model credentials; set ANTHROPIC_API_KEY (Claude) or MODEL_API_KEY (Meta) to let the agent draft.');
        return 2;
      }
      for (const r of results) printResult(dir, r.task, r);
      if (results.some(r => r.ok)) console.log(`Review with: delomu drafts ${dir}, then delomu review ${dir} <id> approve|reject --by NAME`);
      return results.every(r => r.ok) ? 0 : 1;
    },
  },
  {
    name: 'compare-hours',
    usage: 'compare-hours <root>',
    summary: 'total engineer hours per deployment in start order, and whether deployment 5 took under half of deployment 1 (gate 1)',
    run(args) {
      const root = need(args[0], 'compare-hours <root>');
      const { deployments, gate } = compareHours(root);
      if (!deployments.length) { console.log(`No deployments (folders with delomu.json) under ${root}.`); return 0; }
      const names = deployments.map(d => path.relative(root, d.dir) || '.');
      const width = Math.max(10, ...names.map(n => n.length));
      console.log(`${'#'.padStart(2)}  ${'deployment'.padEnd(width)}  started     hours`);
      deployments.forEach((d, i) => {
        console.log(`${String(i + 1).padStart(2)}  ${names[i].padEnd(width)}  ${d.startedAt.toISOString().slice(0, 10)}  ${d.total.toFixed(1).padStart(5)}`);
      });
      const label = { met: 'MET', not_met: 'NOT MET', not_enough_data: 'NOT ENOUGH DATA' }[gate.status];
      console.log(`Gate 1 (deployment 5 < half of deployment 1): ${label}: ${gate.message}`);
      return 0;
    },
  },
];
