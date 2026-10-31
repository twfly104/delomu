#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildTestSet } from '../src/testset.mjs';
import { initDeployment, logHours, hoursByStep, paths, STEPS } from '../src/deployment.mjs';
import { runDeployment } from '../src/run.mjs';

const HELP = `delomu v0: test-set and acceptance for AI deployments

  delomu init <dir> [--customer NAME]      create a deployment folder with a sample config and cases.csv
  delomu tests <dir> [--from FILE]         build tests.json from the customer's past cases (default cases.csv)
  delomu run <dir> [--no-judge] [--concurrency N]
                                           run every test against the customer's AI, write runs/<id>/report.html
  delomu log <dir> <step> <hours> [note]   record engineer hours for a step (${STEPS.join(', ')})
  delomu hours <dir>                       total hours per step

The judge grades "expected" checks with Claude and needs ANTHROPIC_API_KEY (or an "ant auth login" profile).
Without it, those checks are marked "needs review". Exit code 1 when a run is not accepted.`;

function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

function bool(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

async function main(argv) {
  const args = [...argv];
  const cmd = args.shift();
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { console.log(HELP); return 0; }

  if (cmd === 'init') {
    const customer = flag(args, '--customer');
    const dir = args[0];
    if (!dir) throw new Error('usage: delomu init <dir> [--customer NAME]');
    const p = initDeployment(dir, customer);
    console.log(`Created ${p.config} and ${p.cases}.\nNext: point "target" at the customer's AI, fill cases.csv, then run "delomu tests ${dir}".`);
    return 0;
  }

  if (cmd === 'tests') {
    const from = flag(args, '--from');
    const dir = args[0];
    if (!dir) throw new Error('usage: delomu tests <dir> [--from FILE]');
    const src = from ?? paths(dir).cases;
    const { tests, problems } = buildTestSet(fs.readFileSync(src, 'utf8'));
    for (const p of problems) console.warn(`warning: ${p}`);
    fs.writeFileSync(paths(dir).tests, JSON.stringify({ source: path.basename(src), tests }, null, 2) + '\n');
    console.log(`Wrote ${tests.length} tests to ${paths(dir).tests}.`);
    return tests.length ? 0 : 1;
  }

  if (cmd === 'run') {
    const noJudge = bool(args, '--no-judge');
    const conc = flag(args, '--concurrency');
    const dir = args[0];
    if (!dir) throw new Error('usage: delomu run <dir> [--no-judge] [--concurrency N]');
    const { results, outDir } = await runDeployment(dir, { judge: !noJudge, concurrency: conc ? Number(conc) : undefined });
    const s = results.summary;
    console.log(`${results.customer} / ${results.deployment}: ${s.pass}/${s.total} passed (${(s.passRate * 100).toFixed(1)}%, need ${(s.minPassRate * 100).toFixed(0)}%)`);
    console.log(`  failed ${s.fail} · needs review ${s.needs_review} · errors ${s.error} · judge ${results.judge}`);
    console.log(`  verdict: ${s.verdict.replace('_', ' ')}`);
    console.log(`  report: ${path.join(outDir, 'report.html')}`);
    return s.verdict === 'accepted' ? 0 : 1;
  }

  if (cmd === 'log') {
    const [dir, step, hours, ...note] = args;
    if (!dir || !step || !hours) throw new Error('usage: delomu log <dir> <step> <hours> [note]');
    logHours(dir, step, hours, note.join(' '));
    console.log(`Logged ${hours} h on ${step}.`);
    return 0;
  }

  if (cmd === 'hours') {
    const dir = args[0];
    if (!dir) throw new Error('usage: delomu hours <dir>');
    const totals = hoursByStep(dir);
    let sum = 0;
    for (const [step, h] of Object.entries(totals)) { console.log(`${step.padEnd(16)} ${h.toFixed(1)} h`); sum += h; }
    console.log(`${'total'.padEnd(16)} ${sum.toFixed(1)} h`);
    return 0;
  }

  throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => {
  console.error(`error: ${e.message}`);
  process.exitCode = 2;
});
