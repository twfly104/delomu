// Runs a deployment's test set against the customer's AI and writes results.json + report.html.

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { callTarget } from './adapters.mjs';
import { gradeAnswer } from './grade.mjs';
import { createJudge, DEFAULT_JUDGE_MODEL } from './judge.mjs';
import { loadConfig, loadTests, paths } from './deployment.mjs';
import { renderHtml } from './report.mjs';

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}

// Wraps the judge so one bad call becomes "needs_review" instead of failing the run,
// and missing credentials turn the judge off for the rest of the run.
function safeJudge(judge) {
  let off = null;
  return async args => {
    if (off) return { status: 'needs_review', reason: off };
    try {
      return await judge(args);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError || /api key|credentials|auth/i.test(e.message)) {
        off = 'Judge has no Anthropic credentials; a person must review this case.';
        return { status: 'needs_review', reason: off };
      }
      return { status: 'needs_review', reason: `Judge call failed (${e.message}); a person must review this case.` };
    }
  };
}

export function summarize(cases, minPassRate) {
  const count = s => cases.filter(c => c.status === s).length;
  const total = cases.length;
  const passed = count('pass');
  const passRate = total ? passed / total : 0;
  const counts = { total, pass: passed, fail: count('fail'), needs_review: count('needs_review'), error: count('error') };

  let verdict = 'not_accepted';
  if (passRate >= minPassRate && counts.error === 0) verdict = 'accepted';
  else if ((passed + counts.needs_review) / (total || 1) >= minPassRate && counts.error === 0) verdict = 'pending_review';

  const byTag = {};
  for (const c of cases) {
    for (const tag of c.tags.length ? c.tags : ['(untagged)']) {
      byTag[tag] ??= { total: 0, pass: 0 };
      byTag[tag].total++;
      if (c.status === 'pass') byTag[tag].pass++;
    }
  }
  return { ...counts, passRate, minPassRate, verdict, byTag };
}

export async function runDeployment(dir, { judge, concurrency, now = new Date() } = {}) {
  const config = loadConfig(dir);
  const tests = loadTests(dir);
  if (!tests.length) throw new Error('tests.json has no tests');

  const judgeModel = config.judge.model ?? DEFAULT_JUDGE_MODEL;
  let judgeFn = null;
  if (judge === undefined || judge === true) judgeFn = safeJudge(createJudge({ model: judgeModel }));
  else if (typeof judge === 'function') judgeFn = safeJudge(judge);

  const cases = await pool(tests, concurrency ?? config.concurrency, async test => {
    const started = Date.now();
    let output;
    try {
      output = await callTarget(config.target, test.input, { cwd: dir });
    } catch (e) {
      return { id: test.id, input: test.input, tags: test.tags, status: 'error', error: e.message, ms: Date.now() - started, checks: [] };
    }
    const ms = Date.now() - started;
    const graded = await gradeAnswer(test, output, judgeFn);
    return { id: test.id, input: test.input, tags: test.tags, output, ms, ...graded };
  });

  // Millisecond resolution so two runs in the same second do not overwrite each other.
  const runId = now.toISOString().replace(/\.(\d{3})Z$/, '-$1Z').replace(/:/g, '-');
  const results = {
    runId,
    generatedAt: now.toISOString(),
    customer: config.customer,
    deployment: config.name,
    target: config.target.type,
    judge: judgeFn ? judgeModel : 'off',
    decisions: config.decisions,
    summary: summarize(cases, config.acceptance.minPassRate),
    cases,
  };

  const outDir = path.join(paths(dir).runs, runId);
  fs.mkdirSync(outDir, { recursive: true });
  // results.json is written last and atomically: a run only counts once it exists,
  // so a crash mid-write never leaves a half-written latest run behind.
  fs.writeFileSync(path.join(outDir, 'report.html'), renderHtml(results));
  const tmp = path.join(outDir, 'results.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(results, null, 2) + '\n');
  fs.renameSync(tmp, path.join(outDir, 'results.json'));
  return { results, outDir };
}

export function latestRun(dir) {
  const runs = paths(dir).runs;
  if (!fs.existsSync(runs)) return null;
  const ids = fs.readdirSync(runs).filter(d => fs.existsSync(path.join(runs, d, 'results.json'))).sort();
  return ids.length ? path.join(runs, ids.at(-1)) : null;
}
