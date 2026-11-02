// A deployment is one folder per customer rollout:
//   delomu.json   config: customer, target, acceptance threshold, decision log
//   cases.csv     the customer's past cases (input for step 3)
//   tests.json    the generated test set
//   hours.csv     engineer hours per manual step (gate 1 needs these)
//   runs/<id>/    results.json and report.html for each run

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsvLine } from './csv.mjs';

export const paths = dir => ({
  config: path.join(dir, 'delomu.json'),
  cases: path.join(dir, 'cases.csv'),
  tests: path.join(dir, 'tests.json'),
  hours: path.join(dir, 'hours.csv'),
  runs: path.join(dir, 'runs'),
});

// The six steps of a deployment, from the plan. Hours are logged against these.
export const STEPS = ['1-mapping', '2-integration', '3-test-set', '4-test-and-fix', '5-launch-report', '6-monitoring'];

export function loadConfig(dir) {
  const file = paths(dir).config;
  if (!fs.existsSync(file)) throw new Error(`no delomu.json in ${dir} (run "delomu init ${dir}" first)`);
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!config.target) throw new Error('delomu.json has no "target"');
  return {
    customer: config.customer ?? path.basename(path.resolve(dir)),
    name: config.name ?? 'deployment',
    acceptance: { minPassRate: 0.9, ...config.acceptance },
    decisions: config.decisions ?? [],
    judge: config.judge ?? {},
    concurrency: config.concurrency ?? 4,
    target: config.target,
    agentKind: config.agentKind ?? 'support',
  };
}

export function loadTests(dir) {
  const file = paths(dir).tests;
  if (!fs.existsSync(file)) throw new Error(`no tests.json in ${dir} (run "delomu tests ${dir}" first)`);
  return JSON.parse(fs.readFileSync(file, 'utf8')).tests;
}

export function logHours(dir, step, hours, note = '', date = new Date().toISOString().slice(0, 10)) {
  if (!STEPS.includes(step)) throw new Error(`step must be one of: ${STEPS.join(', ')}`);
  const h = Number(hours);
  if (!(h > 0)) throw new Error('hours must be a positive number');
  const file = paths(dir).hours;
  if (!fs.existsSync(file)) fs.writeFileSync(file, 'date,step,hours,note\n');
  fs.appendFileSync(file, toCsvLine([date, step, h, note]) + '\n');
}

export function hoursByStep(dir) {
  const file = paths(dir).hours;
  const totals = Object.fromEntries(STEPS.map(s => [s, 0]));
  if (fs.existsSync(file)) {
    for (const r of parseCsv(fs.readFileSync(file, 'utf8'))) totals[r.step] = (totals[r.step] ?? 0) + Number(r.hours || 0);
  }
  return totals;
}

const SAMPLE_CONFIG = customer => ({
  customer,
  name: 'support-agent-rollout',
  target: {
    type: 'http',
    url: 'https://example.com/your-ai-endpoint',
    headers: { authorization: 'Bearer ${CUSTOMER_API_KEY}' },
    body: { message: '{{input}}' },
    output: 'reply',
  },
  acceptance: { minPassRate: 0.9 },
  decisions: [
    { date: new Date().toISOString().slice(0, 10), decision: 'Accept at 90% pass rate', reason: 'Agreed with the customer at kickoff.' },
  ],
});

const SAMPLE_CASES = `id,input,expected,must_include,must_not_include,tags
refund-1,"I was charged twice for order 1042, can I get one refunded?","Confirms the duplicate charge will be refunded and gives a time frame.",refund,,billing
`;

export function initDeployment(dir, customer) {
  const p = paths(dir);
  if (fs.existsSync(p.config)) throw new Error(`${p.config} already exists`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p.config, JSON.stringify(SAMPLE_CONFIG(customer ?? path.basename(path.resolve(dir))), null, 2) + '\n');
  if (!fs.existsSync(p.cases)) fs.writeFileSync(p.cases, SAMPLE_CASES);
  return p;
}
