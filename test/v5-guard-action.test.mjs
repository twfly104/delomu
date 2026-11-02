import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAudit } from '../src/core/audit.mjs';
import { guardAction } from '../src/v1/guard.mjs';
import { api, seedOrg, startServer } from './v3-support.test.mjs';

const RULE = { id: 'cancel-window', clause: 'returns-and-support-policy.md §5', quote: 'Orders can be changed or cancelled within 1 hour of being placed.', rule: 'Only cancel orders placed less than 1 hour ago.', harm: 'Shipped orders cancelled.', severity: 'medium' };
const NOW = new Date('2026-11-03T12:00:00Z');
const scanned = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-guard-action-'));
  fs.mkdirSync(path.join(dir, 'scans'));
  fs.writeFileSync(path.join(dir, 'scans', 's.json'), JSON.stringify({ id: 's', rules: [{ ...RULE, probes: [] }] }));
  return dir;
};
// Blocks a cancel when the record was placed more than an hour before "now" in the prompt.
const fakeLlm = (mode = 'judge') => ({
  calls: [],
  async json(req) {
    this.calls.push(req);
    if (mode === 'throw') throw new Error('overloaded');
    const placed = /"placedAt":"([^"]+)"/.exec(req.prompt)?.[1];
    const late = placed && NOW - new Date(placed) > 3_600_000 && /cancel_order/.test(req.prompt);
    return { ok: true, data: { violations: late ? [{ rule_id: 'cancel-window', what_happened: 'L-1006 was placed 3 hours ago.' }, { rule_id: 'made-up', what_happened: 'x' }] : [], tell_customer: late ? 'It is past the 1-hour window, so it can be returned after delivery instead.' : '' } };
  },
});

test('action guard: a cancel past the window is blocked with what to tell the customer; one inside it is allowed', async () => {
  const dir = scanned();
  const llm = fakeLlm();
  const late = await guardAction(dir, { action: { tool: 'cancel_order', input: { order_id: 'L-1006' } }, context: { id: 'L-1006', placedAt: '2026-11-03T09:00:00Z', status: 'processing' }, message: 'cancel both' }, { llm, now: NOW });
  assert.equal(late.decision, 'block');
  assert.deepEqual(late.violations.map(v => v.rule), ['cancel-window']);
  assert.match(late.tellCustomer, /1-hour window/);
  assert.match(llm.calls[0].prompt, /<record>[\s\S]*L-1006[\s\S]*<action>[\s\S]*cancel_order/);
  assert.match(llm.calls[0].prompt, /The time now is 2026-11-03T12:00:00.000Z/);
  const ok = await guardAction(dir, { action: { tool: 'cancel_order', input: { order_id: 'L-1005' } }, context: { id: 'L-1005', placedAt: '2026-11-03T11:40:00Z' } }, { llm, now: NOW });
  assert.equal(ok.decision, 'allow');
  assert.ok(readAudit(dir).some(e => e.action === 'guard.action' && e.detail.decision === 'block' && e.detail.tool === 'cancel_order'));
});

test('action guard fails open and says so: no scan, no action, or no verdict', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'delomu-guard-action-'));
  assert.equal((await guardAction(empty, { action: { tool: 'issue_refund', input: {} } }, { llm: fakeLlm(), now: NOW })).unjudged, true);
  const dir = scanned();
  const failed = await guardAction(dir, { action: { tool: 'issue_refund', input: { amount: 120 } } }, { llm: fakeLlm('throw'), now: NOW });
  assert.equal(failed.decision, 'allow');
  assert.equal(failed.unjudged, true);
  assert.match(failed.reason, /allowed/);
});

const srv = await startServer({ llm: fakeLlm() });
after(() => srv.close());

test('the guard endpoint checks an action when the body has one, under the same scope', async () => {
  const o = seedOrg(srv.dataDir, { name: 'Guard Co', members: [{ email: 'eng@ga.test', role: 'engineer' }, { email: 'view@ga.test', role: 'viewer' }] });
  const key = o.keys['eng@ga.test'];
  assert.equal((await api(srv.base, 'POST', `/v1/orgs/${o.org.id}/deployments`, { key, body: { name: 'lia', config: { name: 'lia', target: { type: 'http', url: 'https://agent.example/chat' } } } })).status, 201);
  const dir = path.join(srv.deploymentsRoot, o.org.id, 'lia');
  fs.mkdirSync(path.join(dir, 'scans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scans', 's.json'), JSON.stringify({ id: 's', rules: [{ ...RULE, probes: [] }] }));
  const url = `/v1/orgs/${o.org.id}/deployments/lia/guard`;
  const body = { action: { tool: 'cancel_order', input: { order_id: 'L-1006' } }, context: { placedAt: '2000-01-01T00:00:00Z' } };
  const res = await api(srv.base, 'POST', url, { key, body });
  assert.equal(res.status, 200);
  assert.equal(res.json.object, 'guard_action');
  assert.equal(res.json.decision, 'block');
  assert.equal((await api(srv.base, 'POST', url, { key, body: { action: 'refund' } })).status, 400);
  assert.equal((await api(srv.base, 'POST', url, { key: o.keys['view@ga.test'], body })).status, 403);
});
