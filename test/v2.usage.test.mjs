import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { usage } from '../src/v2/monitor.mjs';
import { usageCsv, shiftMonth, loadPricing, DEFAULT_PRICING } from '../src/v2/usage.mjs';
import { parseCsv } from '../src/csv.mjs';
import { commands } from '../src/commands/v2.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-v2u-'));

// A deployment folder with completed runs at the given ISO-style run ids (only the folder name matters).
function deployment(root, rel, customer, runIds) {
  const dir = path.join(root, ...rel.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ customer, name: rel, target: { type: 'command', command: 'x' } }));
  for (const id of runIds) {
    fs.mkdirSync(path.join(dir, 'runs', id), { recursive: true });
    fs.writeFileSync(path.join(dir, 'runs', id, 'results.json'), '{}');
  }
}

function fixture() {
  const root = tmp();
  deployment(root, 'acme/support', 'Acme', ['2026-07-03T10-00-00Z', '2026-10-01T09-00-00Z', '2026-10-15T09-00-00Z']);
  deployment(root, 'acme/sales', 'Acme', ['2026-10-20T09-00-00Z']);
  deployment(root, 'beta/helpdesk', 'Beta', ['2026-07-10T00-00-00Z', '2026-10-31T23-59-59Z']);
  deployment(root, 'beta/old', 'Beta', ['2026-07-11T00-00-00Z']); // churned after July
  deployment(root, 'gamma/idle', 'Gamma', []); // never ran: not billed
  // A run folder without results.json (crashed run) and a non-run folder do not count.
  fs.mkdirSync(path.join(root, 'gamma', 'idle', 'runs', '2026-10-02T00-00-00Z'), { recursive: true });
  fs.mkdirSync(path.join(root, 'gamma', 'idle', 'runs', 'notes'), { recursive: true });
  return root;
}

test('usage: active deployments, one platform fee per customer, per-deployment lines and total', () => {
  const u = usage(fixture(), { month: '2026-10' });
  assert.deepEqual(u.active.map(a => [a.dir, a.customer, a.runs]), [
    ['acme/sales', 'Acme', 1], ['acme/support', 'Acme', 2], ['beta/helpdesk', 'Beta', 1],
  ]);
  assert.deepEqual(u.platformCustomers, ['Acme', 'Beta']);
  assert.deepEqual(u.lines.map(l => [l.customer, l.item, l.quantity, l.amountUsd]), [
    ['Acme', 'platform', 1, 3000], ['Acme', 'active_deployment', 2, 1000],
    ['Beta', 'platform', 1, 3000], ['Beta', 'active_deployment', 1, 500],
  ]);
  assert.equal(u.totalUsd, 7500);
  assert.deepEqual(u.pricing, DEFAULT_PRICING);
});

test('usage: retention compares the month with three months earlier', () => {
  const root = fixture();
  assert.deepEqual(usage(root, { month: '2026-10' }).retention, { baseMonth: '2026-07', base: 3, retained: 2, rate: 2 / 3 });
  assert.deepEqual(usage(root, { month: '2026-09' }).retention, { baseMonth: '2026-06', base: 0, retained: 0, rate: null });
  assert.equal(shiftMonth('2026-02', -3), '2025-11');
  assert.equal(shiftMonth('2025-12', 1), '2026-01');
});

test('usage: an empty month bills nothing', () => {
  const u = usage(fixture(), { month: '2026-08' });
  assert.deepEqual([u.active, u.lines, u.totalUsd], [[], [], 0]);
});

test('pricing: pricing.json at root overrides defaults, the option overrides both, and bad values are rejected', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'pricing.json'), JSON.stringify({ perActiveDeploymentUsd: 450.5 }));
  assert.deepEqual(loadPricing(root), { platformUsd: 3000, perActiveDeploymentUsd: 450.5 });
  assert.equal(usage(root, { month: '2026-10' }).totalUsd, 3000 * 2 + 450.5 * 3);
  assert.equal(usage(root, { month: '2026-10', pricing: { platformUsd: 0 } }).totalUsd, 450.5 * 3);

  assert.throws(() => usage(root, { month: '2026-10', pricing: { platformUsd: -1 } }), /non-negative/);
  assert.throws(() => usage(root, { month: '2026-10', pricing: { platfromUsd: 1 } }), /unknown field "platfromUsd"/);
  fs.writeFileSync(path.join(root, 'pricing.json'), '{ nope');
  assert.throws(() => usage(root, { month: '2026-10' }), /pricing.json is not valid JSON/);
});

test('usage: month is validated; unreadable deployment configs are skipped and reported', () => {
  const root = fixture();
  for (const month of ['2026-13', '2026-1', '', undefined, '2026-10-01']) {
    assert.throws(() => usage(root, { month }), /YYYY-MM/);
  }
  fs.mkdirSync(path.join(root, 'bad'));
  fs.writeFileSync(path.join(root, 'bad', 'delomu.json'), '{ not json');
  const u = usage(root, { month: '2026-10' });
  assert.equal(u.skipped.length, 1);
  assert.equal(u.skipped[0].dir, 'bad');
  assert.equal(u.totalUsd, 7500);
});

test('usage CSV: one row per invoice line, formula-looking text neutralised; command writes it', () => {
  const root = tmp();
  deployment(root, 'x', '=HYPERLINK("http://evil")', ['2026-10-01T00-00-00Z']);
  const rows = parseCsv(usageCsv(usage(root, { month: '2026-10' })));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].customer, `'=HYPERLINK("http://evil")`);
  assert.deepEqual([rows[1].item, rows[1].quantity, rows[1].amount_usd, rows[1].deployments], ['active_deployment', '1', '500', 'x']);

  const out = path.join(root, 'usage.csv');
  const cmd = commands.find(c => c.name === 'usage');
  const log = console.log;
  const lines = [];
  console.log = m => lines.push(m);
  try {
    assert.equal(cmd.run([root, '--month', '2026-10', '--csv', out]), 0);
  } finally {
    console.log = log;
  }
  assert.ok(fs.existsSync(out));
  assert.ok(lines.some(l => /Total\s+3500\.00 USD/.test(l)), lines.join('\n'));
  assert.throws(() => cmd.run([root]), /usage: delomu usage/);
});
