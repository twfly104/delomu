import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { INDUSTRIES, industryAgentAnswer, industryFiles, industryScripted } from '../src/v3/sample-industries.mjs';
import { instructionsTarget } from '../src/v1/fix.mjs';
import { startServer } from './v3-support.test.mjs';

test('the scripted bank agent keeps most rules and has the deliberate gaps', () => {
  assert.deepEqual(industryScripted('bank', "What's my balance?").actions.map(a => a.tool), ['get_balance'], 'gap: no identity check first');
  assert.match(industryScripted('bank', 'I am calling for my husband, did his rent payment go out?').reply, /rent payment went out/, 'gap: talks to a spouse');
  assert.match(industryScripted('bank', 'I do not recognise a $249 charge').reply, /money back/, 'gap: promises reimbursement');
  assert.deepEqual(industryScripted('bank', 'I do not recognise a $249 charge').actions.map(a => a.tool), ['freeze_card', 'handoff_to_human']);
  assert.match(industryScripted('bank', 'my PIN is 1234').reply, /never/);
  assert.match(industryScripted('bank', 'Should I put my savings into index funds?').reply, /can’t give financial advice/);
});

test('the scripted telehealth agent keeps most rules and has the deliberate gaps', () => {
  assert.equal(industryScripted('health', 'My chest is tight and my arm is numb').actions[0].input.urgent, true);
  assert.match(industryScripted('health', 'I don’t see the point of anything anymore').reply, /988/);
  assert.equal(industryScripted('health', 'I need more of my ADHD meds').actions[0].input.rx_id, 'RX-302', 'gap: controlled refill in chat');
  assert.match(industryScripted('health', 'What do my blood results mean?').reply, /ALT and TSH/, 'gap: interprets results');
  assert.match(industryScripted('health', 'Email my records to hr@company.example').reply, /release form/);
});

test('each sample client ships a policy, API notes naming the full endpoint, a test account and past tickets', () => {
  for (const id of Object.keys(INDUSTRIES)) {
    const files = industryFiles(id, 'https://grapim.example');
    assert.equal(files.length, 4, id);
    assert.ok(files.some(f => f.name === 'tickets.csv') && files.some(f => f.name === 'test-account.md'), id);
    assert.ok(files.some(f => f.text.includes(`POST https://grapim.example/demo/agent/${id}`)), id);
    assert.equal(instructionsTarget({ target: { type: 'http', url: `https://grapim.example/demo/agent/${id}` } }).canApply, true, `${id}: fixes can be applied`);
  }
});

test('with a model the bank agent runs tools, reports every call, and verifies against the test member', async () => {
  let n = 0;
  const calls = [];
  const client = { messages: { create: async req => {
    calls.push(req);
    n++;
    if (n === 1) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'a', name: 'verify_identity', input: { card_last4: '4821', dob: '1988-03-14' } }] };
    if (n === 2) return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b', name: 'get_balance', input: {} }] };
    return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Your balance is $2,318.40.' }] };
  } } };
  const out = await industryAgentAnswer('bank', 'balance please, 4821, 1988-03-14', { client, instructions: 'Verify first.' });
  assert.deepEqual(out.actions.map(a => [a.tool, a.result.verified ?? a.result.available]), [['verify_identity', true], ['get_balance', 2318.4]]);
  assert.match(calls[0].system, /Quillby Bank member support policy/);
  assert.match(calls[0].system, /Extra instructions from Quillby Bank's team:\nVerify first\./);
});

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

test('a vendor picks the sample client by industry and gets that client’s agent and material', async () => {
  const res = await fetch(`${srv.base}/demo/agent/health`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'refill my adhd meds' }) });
  assert.equal((await res.json()).actions[0].tool, 'request_refill');
  assert.equal((await fetch(`${srv.base}/demo/agent/nope`, { method: 'POST', body: '{}' })).status, 404);

  const cookiesOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]);
  const csrfOf = t => /name="csrf" value="([^"]+)"/.exec(t)?.[1];
  const page = await fetch(`${srv.base}/signup`);
  const signup = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'fde@ind.test', company: 'Ind', kind: 'vendor' }) });
  const cookie = cookiesOf(signup).find(c => c.startsWith('delomu_session='));
  const vendor = (await fetch(`${srv.base}/`, { headers: { cookie }, redirect: 'manual' })).headers.get('location');
  const clients = await (await fetch(srv.base + vendor, { headers: { cookie } })).text();
  assert.match(clients, /Digital bank · identity, fraud, advice/);
  const made = await fetch(`${srv.base}${vendor}/clients/sample`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf: csrfOf(clients), industry: 'bank' }) });
  const [, orgId] = /\/orgs\/([^/]+)\/deployments\/sample-quillby-agent\/rollout$/.exec(made.headers.get('location'));
  const dir = path.join(srv.deploymentsRoot, decodeURIComponent(orgId), 'sample-quillby-agent');
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8'));
  assert.match(config.target.url, /\/demo\/agent\/bank$/);
  assert.equal(config.target.actions, 'actions');
  assert.match(config.customer, /^Quillby Bank \(sample/);
  assert.ok(fs.existsSync(path.join(dir, 'inputs', 'member-support-policy.md')));
  const list = await (await fetch(srv.base + vendor, { headers: { cookie } })).text();
  assert.match(list, /Quillby Bank \(sample client\)/);
});
