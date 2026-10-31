// v2 commands: "watch" re-runs deployments when they change or fall due and alerts on regressions;
// "usage" meters active deployments for a month and prices them into invoice lines.

import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { flag, bool, need } from './args.mjs';
import { checkDeployment, findDeployments, usage } from '../v2/monitor.mjs';
import { usageCsv } from '../v2/usage.mjs';

const DEFAULT_WATCH_MINUTES = 15;
// Timers hold at most 2^31-1 ms; a longer wait would fire after 1 ms and re-check in a tight loop.
const MAX_WATCH_MINUTES = Math.floor((2 ** 31 - 1) / 60_000);
const pct = x => `${(x * 100).toFixed(1)}%`;

function positiveNumber(value, name) {
  const n = Number(value);
  if (!(n > 0) || !Number.isFinite(n)) throw new Error(`${name} must be a positive number`);
  return n;
}

// One pass over every deployment under root. A failing deployment is reported and does not stop the others.
// Returns the number of deployments whose check failed.
export async function sweep(root, { force, judge, now } = {}) {
  let failed = 0;
  const dirs = findDeployments(root);
  if (!dirs.length) console.log(`No deployments (folders with delomu.json) under ${root}.`);
  for (const dir of dirs) {
    const name = path.relative(root, dir) || '.';
    try {
      const r = await checkDeployment(dir, { force, judge, now: now?.() });
      const alert = r.alert ? `, ${r.alert.type} ${r.alert.sent ? 'sent' : `not sent (${r.alert.reason})`}` : '';
      if (!r.ran) { console.log(`${name}: skipped, ${r.reason}${alert}`); continue; }
      const s = r.results.summary;
      console.log(`${name}: ran (${r.reason}), pass ${pct(s.passRate)}, ${r.diff.regressions.length} regressed, ${r.diff.fixed.length} fixed${alert}`);
    } catch (e) {
      failed++;
      console.error(`${name}: check failed: ${e.message}`);
    }
  }
  return failed;
}

export const commands = [
  {
    name: 'watch',
    usage: 'watch <root> [--once] [--interval-minutes N] [--force] [--no-judge]',
    summary: 're-run deployments under root when their tests, target or model version change or fall due; alert on regressions',
    async run(args) {
      const once = bool(args, '--once');
      const force = bool(args, '--force');
      const noJudge = bool(args, '--no-judge');
      const minutes = flag(args, '--interval-minutes');
      const root = need(args[0], 'watch <root> [--once] [--interval-minutes N] [--force] [--no-judge]');
      const waitMinutes = positiveNumber(minutes ?? DEFAULT_WATCH_MINUTES, '--interval-minutes');
      if (waitMinutes > MAX_WATCH_MINUTES) throw new Error(`--interval-minutes must be at most ${MAX_WATCH_MINUTES}`);
      const waitMs = waitMinutes * 60_000;
      const judge = noJudge ? false : undefined;

      if (once) return (await sweep(root, { force, judge })) ? 1 : 0;
      console.log(`Watching ${root}; checking every ${waitMs / 60_000} min. Press Ctrl+C to stop.`);
      // --force applies to the first pass only; later passes run what is due.
      for (let pass = 0; ; pass++) {
        await sweep(root, { force: force && pass === 0, judge });
        await sleep(waitMs);
      }
    },
  },
  {
    name: 'usage',
    usage: 'usage <root> --month YYYY-MM [--csv FILE]',
    summary: 'active deployments, invoice lines and 90-day retention for a month (pricing.json at root overrides prices)',
    run(args) {
      const month = flag(args, '--month');
      const csv = flag(args, '--csv');
      const root = need(args[0], 'usage <root> --month YYYY-MM [--csv FILE]');
      need(month, 'usage <root> --month YYYY-MM [--csv FILE]');
      const u = usage(root, { month });
      for (const s of u.skipped) console.warn(`warning: skipped ${s.dir}: ${s.error}`);
      console.log(`Usage for ${u.month}: ${u.active.length} active deployment(s), ${u.platformCustomers.length} customer(s)`);
      for (const l of u.lines) console.log(`  ${l.customer.padEnd(24)} ${l.description.padEnd(20)} ${String(l.quantity).padStart(3)} x ${l.unitUsd.toFixed(2).padStart(9)} = ${l.amountUsd.toFixed(2).padStart(10)} USD`);
      console.log(`  ${'Total'.padEnd(24)} ${''.padEnd(37)} ${u.totalUsd.toFixed(2).padStart(10)} USD`);
      const r = u.retention;
      console.log(`Retention: ${r.retained} of ${r.base} deployment(s) active in ${r.baseMonth} are active in ${u.month}${r.rate === null ? '' : ` (${pct(r.rate)})`}.`);
      if (csv) {
        fs.writeFileSync(csv, usageCsv(u));
        console.log(`Wrote ${csv}.`);
      }
      return 0;
    },
  },
];
