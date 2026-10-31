// v0 commands: deployment setup, test set, run, hours, plus the shared draft-review and audit commands.

import fs from 'node:fs';
import path from 'node:path';
import { flag, bool, need } from './args.mjs';
import { buildTestSet } from '../testset.mjs';
import { initDeployment, logHours, hoursByStep, paths, STEPS } from '../deployment.mjs';
import { runDeployment } from '../run.mjs';
import { listDrafts, getDraft, reviewDraft } from '../core/drafts.mjs';
import { readAudit, verifyAudit } from '../core/audit.mjs';

export function writeTests(dir, from) {
  const src = from ?? paths(dir).cases;
  const { tests, problems } = buildTestSet(fs.readFileSync(src, 'utf8'));
  fs.writeFileSync(paths(dir).tests, JSON.stringify({ source: path.basename(src), tests }, null, 2) + '\n');
  return { tests, problems };
}

export const commands = [
  {
    name: 'init',
    usage: 'init <dir> [--customer NAME]',
    summary: 'create a deployment folder with a sample config and cases.csv',
    run(args) {
      const customer = flag(args, '--customer');
      const dir = need(args[0], 'init <dir> [--customer NAME]');
      const p = initDeployment(dir, customer);
      console.log(`Created ${p.config} and ${p.cases}.\nNext: point "target" at the customer's AI, fill cases.csv, then run "delomu tests ${dir}".`);
      return 0;
    },
  },
  {
    name: 'tests',
    usage: 'tests <dir> [--from FILE]',
    summary: "build tests.json from the customer's past cases (default cases.csv)",
    run(args) {
      const from = flag(args, '--from');
      const dir = need(args[0], 'tests <dir> [--from FILE]');
      const { tests, problems } = writeTests(dir, from);
      for (const p of problems) console.warn(`warning: ${p}`);
      console.log(`Wrote ${tests.length} tests to ${paths(dir).tests}.`);
      return tests.length ? 0 : 1;
    },
  },
  {
    name: 'run',
    usage: 'run <dir> [--no-judge] [--concurrency N]',
    summary: "run every test against the customer's AI and write runs/<id>/report.html (exit 1 unless accepted)",
    async run(args) {
      const noJudge = bool(args, '--no-judge');
      const conc = flag(args, '--concurrency');
      const dir = need(args[0], 'run <dir> [--no-judge] [--concurrency N]');
      const { results, outDir } = await runDeployment(dir, { judge: !noJudge, concurrency: conc ? Number(conc) : undefined });
      const s = results.summary;
      console.log(`${results.customer} / ${results.deployment}: ${s.pass}/${s.total} passed (${(s.passRate * 100).toFixed(1)}%, need ${(s.minPassRate * 100).toFixed(0)}%)`);
      console.log(`  failed ${s.fail} · needs review ${s.needs_review} · errors ${s.error} · judge ${results.judge}`);
      console.log(`  verdict: ${s.verdict.replace('_', ' ')}`);
      console.log(`  report: ${path.join(outDir, 'report.html')}`);
      return s.verdict === 'accepted' ? 0 : 1;
    },
  },
  {
    name: 'log',
    usage: 'log <dir> <step> <hours> [note]',
    summary: `record engineer hours for a step (${STEPS.join(', ')})`,
    run(args) {
      const [dir, step, hours, ...note] = args;
      need(dir && step && hours, 'log <dir> <step> <hours> [note]');
      logHours(dir, step, hours, note.join(' '));
      console.log(`Logged ${hours} h on ${step}.`);
      return 0;
    },
  },
  {
    name: 'hours',
    usage: 'hours <dir>',
    summary: 'total engineer hours per step',
    run(args) {
      const dir = need(args[0], 'hours <dir>');
      let sum = 0;
      for (const [step, h] of Object.entries(hoursByStep(dir))) { console.log(`${step.padEnd(16)} ${h.toFixed(1)} h`); sum += h; }
      console.log(`${'total'.padEnd(16)} ${sum.toFixed(1)} h`);
      return 0;
    },
  },
  {
    name: 'drafts',
    usage: 'drafts <dir> [--status pending|approved|rejected] [--show ID]',
    summary: 'list agent drafts waiting for review, or show one in full',
    run(args) {
      const status = flag(args, '--status');
      const show = flag(args, '--show');
      const dir = need(args[0], 'drafts <dir> [--status S] [--show ID]');
      if (show) { console.log(JSON.stringify(getDraft(dir, show), null, 2)); return 0; }
      const list = listDrafts(dir, { status });
      if (!list.length) console.log('No drafts.');
      for (const d of list) console.log(`${d.id}  ${d.status.padEnd(8)}  step ${d.step ?? '-'}  ${d.rationale.slice(0, 80)}`);
      return 0;
    },
  },
  {
    name: 'review',
    usage: 'review <dir> <id> approve|reject --by NAME [--note TEXT] [--content FILE]',
    summary: 'approve (optionally with your edited content) or reject an agent draft',
    async run(args) {
      const by = flag(args, '--by');
      const note = flag(args, '--note') ?? '';
      const contentFile = flag(args, '--content');
      const [dir, id, decision] = args;
      need(dir && id && decision && by, 'review <dir> <id> approve|reject --by NAME [--note TEXT] [--content FILE]');
      const content = contentFile ? JSON.parse(fs.readFileSync(contentFile, 'utf8')) : undefined;
      const d = await reviewDraft(dir, id, { decision, by, note, content });
      console.log(`${d.id} ${d.status}${d.edited ? ' (with edits)' : ''}.`);
      return 0;
    },
  },
  {
    name: 'audit',
    usage: 'audit <dir> [--verify]',
    summary: 'show the audit log of agent and human actions, or verify it has not been altered',
    run(args) {
      const verify = bool(args, '--verify');
      const dir = need(args[0], 'audit <dir> [--verify]');
      if (verify) {
        const r = verifyAudit(dir);
        console.log(r.ok ? `Audit log intact: ${r.count} entries.` : `Audit log broken at entry ${r.brokenAt}: ${r.reason}.`);
        return r.ok ? 0 : 1;
      }
      for (const e of readAudit(dir)) console.log(`${e.seq}  ${e.ts}  ${e.actor.padEnd(16)}  ${e.action.padEnd(16)}  ${e.target}`);
      return 0;
    },
  },
];
