// Usage metering for "active deployment" billing, modelled on usage-based invoicing: usage is derived
// from records that already exist (run folders), then priced into invoice lines per customer.
// A deployment is active in a month when it had at least one run that month. Each customer with an
// active deployment pays one platform fee plus a fee per active deployment.

import fs from 'node:fs';
import path from 'node:path';
import { findDeployments } from './discover.mjs';
import { readRawConfig } from './config.mjs';
import { paths } from '../deployment.mjs';
import { toCsvLine } from '../csv.mjs';

export const DEFAULT_PRICING = Object.freeze({ platformUsd: 3000, perActiveDeploymentUsd: 500 });
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const RUN_ID = /^(\d{4}-\d{2})-\d{2}T/;
const cents = x => Math.round(x * 100) / 100;

export function validateMonth(month) {
  if (typeof month !== 'string' || !MONTH.test(month)) throw new Error(`month must look like YYYY-MM (got "${month}")`);
  return month;
}

export function shiftMonth(month, delta) {
  const [y, m] = validateMonth(month).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function checkPricing(p, source) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error(`${source} must be an object`);
  for (const [k, v] of Object.entries(p)) {
    if (!(k in DEFAULT_PRICING)) throw new Error(`${source} has unknown field "${k}" (allowed: ${Object.keys(DEFAULT_PRICING).join(', ')})`);
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`${source}.${k} must be a non-negative number`);
  }
  return p;
}

// Defaults, then <root>/pricing.json, then the pricing passed in.
export function loadPricing(root, override) {
  const file = path.join(root, 'pricing.json');
  let fromFile = {};
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`${file} is not valid JSON: ${e.message}`);
    }
    checkPricing(fromFile, 'pricing.json');
  }
  return { ...DEFAULT_PRICING, ...fromFile, ...(override ? checkPricing(override, 'pricing') : {}) };
}

// month -> number of completed runs, from run folder names (run ids start with the run's UTC timestamp).
function runsByMonth(dir) {
  const runs = paths(dir).runs;
  const counts = new Map();
  if (!fs.existsSync(runs)) return counts;
  for (const id of fs.readdirSync(runs)) {
    const m = RUN_ID.exec(id);
    if (m && fs.existsSync(path.join(runs, id, 'results.json'))) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  return counts;
}

function describe(root, dir) {
  const raw = readRawConfig(dir);
  return {
    dir: path.relative(root, dir).split(path.sep).join('/') || '.',
    customer: String(raw.customer ?? path.basename(path.resolve(dir))),
    name: String(raw.name ?? 'deployment'),
    runs: runsByMonth(dir),
  };
}

export function usage(root, { month, pricing } = {}) {
  validateMonth(month);
  const prices = loadPricing(root, pricing);
  const skipped = [];
  const deployments = [];
  for (const dir of findDeployments(root)) {
    try {
      deployments.push(describe(root, dir));
    } catch (e) {
      skipped.push({ dir: path.relative(root, dir) || '.', error: e.message });
    }
  }

  const activeIn = m => deployments.filter(d => d.runs.get(m) > 0);
  const active = activeIn(month).map(d => ({ dir: d.dir, customer: d.customer, name: d.name, runs: d.runs.get(month) }));

  const byCustomer = new Map();
  for (const a of active) byCustomer.set(a.customer, [...(byCustomer.get(a.customer) ?? []), a.dir]);
  const platformCustomers = [...byCustomer.keys()].sort();
  const lines = platformCustomers.flatMap(customer => {
    const dirs = byCustomer.get(customer);
    return [
      { customer, item: 'platform', description: 'Platform fee', quantity: 1, unitUsd: prices.platformUsd, amountUsd: cents(prices.platformUsd), deployments: [] },
      { customer, item: 'active_deployment', description: 'Active deployments', quantity: dirs.length, unitUsd: prices.perActiveDeploymentUsd, amountUsd: cents(dirs.length * prices.perActiveDeploymentUsd), deployments: dirs },
    ];
  });

  // 90-day retention: of the deployments active three months ago, how many are still active now.
  const baseMonth = shiftMonth(month, -3);
  const base = activeIn(baseMonth).map(d => d.dir);
  const now = new Set(active.map(a => a.dir));
  const retained = base.filter(d => now.has(d)).length;

  return {
    month,
    pricing: prices,
    active,
    platformCustomers,
    lines,
    totalUsd: cents(lines.reduce((s, l) => s + l.amountUsd, 0)),
    retention: { baseMonth, base: base.length, retained, rate: base.length ? retained / base.length : null },
    skipped,
  };
}

// Spreadsheet apps run cells that start with = + - @ as formulas; customer names come from config files.
const cell = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function usageCsv(report) {
  const rows = [['month', 'customer', 'item', 'description', 'quantity', 'unit_usd', 'amount_usd', 'deployments']];
  for (const l of report.lines) rows.push([report.month, l.customer, l.item, l.description, l.quantity, l.unitUsd, l.amountUsd, l.deployments.join('|')].map(cell));
  return rows.map(toCsvLine).join('\n') + '\n';
}
