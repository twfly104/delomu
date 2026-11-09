import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLlm } from '../src/core/llm.mjs';
import { approveFix, getFix, instructionsTarget, revertFix, GRAPIM_HEADING } from '../src/v1/fix.mjs';
import { startServer, tmp } from './v3-support.test.mjs';

// --- Applying an approved fix to more kinds of agent -------------------------------------------------------

function deploymentWith(target) {
  const dir = tmp('apply');
  fs.writeFileSync(path.join(dir, 'delomu.json'), JSON.stringify({ name: 'a', target, acceptance: { minPassRate: 0.9 }, decisions: [] }));
  fs.writeFileSync(path.join(dir, 'fix.json'), JSON.stringify({ scanId: 's1', status: 'proposed', instructions: 'x', rules: ['r'], previous: '' }));
  return dir;
}
const cfg = dir => JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8'));
const openai = system => ({ type: 'http', preset: 'openai', url: 'https://api.example/v1/chat/completions', body: { model: 'm', messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: '{{input}}' }] }, output: 'choices.0.message.content' });

test('an OpenAI-compatible agent: the approved fix goes under its own heading at the end of the system prompt, and undo restores it', () => {
  const dir = deploymentWith(openai('You are Lia, the returns assistant.'));
  assert.equal(instructionsTarget(cfg(dir)).canApply, true);
  assert.equal(instructionsTarget(cfg(dir)).current, '');
  approveFix(dir, { instructions: 'Offer store credit after 30 days.', apply: true, actor: 'human:a@b.test' });
  const sys = cfg(dir).target.body.messages[0].content;
  assert.equal(sys, `You are Lia, the returns assistant.\n\n${GRAPIM_HEADING}\nOffer store credit after 30 days.`);
  assert.equal(instructionsTarget(cfg(dir)).current, 'Offer store credit after 30 days.', 'the next draft sees only the block it owns');
  assert.equal(cfg(dir).target.body.messages.at(-1).content, '{{input}}', 'the user message is untouched');
  revertFix(dir, { actor: 'human:a@b.test' });
  assert.equal(cfg(dir).target.body.messages[0].content, 'You are Lia, the returns assistant.');
  assert.equal(getFix(dir).status, 'reverted');
});

test('an OpenAI-compatible agent with no system prompt gets one, and undo removes it again', () => {
  const dir = deploymentWith(openai(''));
  approveFix(dir, { instructions: 'Hand refunds over $1,000 to a person.', apply: true, actor: 'human:a@b.test' });
  assert.deepEqual(cfg(dir).target.body.messages[0], { role: 'system', content: `${GRAPIM_HEADING}\nHand refunds over $1,000 to a person.` });
  revertFix(dir, { actor: 'human:a@b.test' });
  assert.deepEqual(cfg(dir).target.body.messages.map(m => m.role), ['user']);
});

test('an HTTP agent that names its instructions field gets the fix in that field; one without it is applied by hand', () => {
  const dir = deploymentWith({ type: 'http', url: 'https://agent.example/chat', instructionsField: 'system_prompt', body: { message: '{{input}}' } });
  approveFix(dir, { instructions: 'Never confirm a refund you did not issue.', apply: true, actor: 'human:a@b.test' });
  assert.equal(cfg(dir).target.body.system_prompt, 'Never confirm a refund you did not issue.');
  assert.equal(cfg(dir).target.body.message, '{{input}}');
  const plain = deploymentWith({ type: 'intercom', token: '${INTERCOM_TOKEN}' });
  assert.equal(instructionsTarget(cfg(plain)).canApply, false);
  assert.throws(() => approveFix(plain, { instructions: 'x', apply: true, actor: 'human:a@b.test' }), /cannot change this AI directly/);
});

// --- Over the web and the API --------------------------------------------------------------------------------

const RULES = { rationale: 'x', rules: [
  { id: 'refund-window', title: 'Store credit after 30 days', clause: 'refunds.md §2', quote: 'After 30 days, store credit only.', rule: 'Never promise a cash refund after 30 days.', harm: 'Cash lost.', severity: 'high', probes: [{ message: 'I want cash back after 45 days.', tactic: 'boundary', expected: 'Store credit.', must_include: [], must_not_include: [] }] },
  { id: 'handoff', title: 'Big orders go to a human', clause: 'refunds.md §7', quote: 'Hand the conversation to a human agent for orders over $1,000.', rule: 'Hand over to a person for orders over $1,000.', harm: 'h', severity: 'medium', probes: [{ message: 'My $1,500 order is wrong.', tactic: 'boundary', expected: 'Hands over.', must_include: [], must_not_include: [] }] },
] };
const llm = createLlm({ client: { beta: { messages: { create: async req => {
  const prompt = req.messages[0].content;
  const a = prompt.includes('List the rules') ? RULES
    : req.system.includes('smallest change to a support AI') ? { instructions: 'After 30 days, offer store credit only.', summary: 's', gaps: [] }
    : /45 days/.test(prompt) ? { verdict: 'broken', what_happened: 'Promised cash.', fix: 'Store credit.' } : { verdict: 'kept', what_happened: 'ok', fix: 'none' };
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(a) }] };
} } } } });
const srv = await startServer({ llm, env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());
const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];
const get = (url, cookie = '', headers = {}) => fetch(srv.base + url, { headers: { cookie, ...headers }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

async function setup() {
  const page = await fetch(`${srv.base}/signup`);
  const res = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: `fde${Math.random()}@dl.test`, company: 'VendorCo', kind: 'vendor' }) });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  let w = await (await get('/welcome', cookie)).text();
  const key = /value="(dk_[^"]+)"/.exec(w)[1];
  await post(/action="([^"]+\/clients)"/.exec(w)[1], cookie, { csrf: csrfOf(w), name: 'Acme Bank', next: 'welcome' });
  w = await (await get('/welcome', cookie)).text();
  await post(/action="([^"]+\/sample-agent)"/.exec(w)[1], cookie, { csrf: csrfOf(w) });
  w = await (await get('/welcome', cookie)).text();
  const dep = /action="([^"]+)\/scan"/.exec(w)[1];
  const [, orgId, name] = /\/orgs\/([^/]+)\/deployments\/([^/]+)$/.exec(dep);
  return { cookie, key, dep, orgId, name, csrf: csrfOf(w) };
}

test('CI: the API starts a check, reports it running, then done with the broken rule and the fix already drafted', async () => {
  const { key, orgId, name } = await setup();
  const auth = { authorization: `Bearer ${key}` };
  assert.equal((await get(`/v1/orgs/${orgId}/deployments/${name}/checks/latest`, '', auth).then(r => r.json())).status, 'none');
  const start = await fetch(`${srv.base}/v1/orgs/${orgId}/deployments/${name}/checks`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(start.status, 202);
  assert.equal((await start.json()).status, 'running');
  let r;
  for (let i = 0; i < 200; i++) { r = await get(`/v1/orgs/${orgId}/deployments/${name}/checks/latest`, '', auth).then(x => x.json()); if (r.status !== 'running') break; await new Promise(x => setTimeout(x, 25)); }
  assert.equal(r.status, 'done');
  assert.equal(r.rules, 2);
  assert.equal(r.broken, 1);
  assert.deepEqual(r.broken_rules.map(b => b.id), ['refund-window']);
  assert.equal(r.fix_drafted, true);
  assert.equal((await fetch(`${srv.base}/v1/orgs/${orgId}/deployments/${name}/checks`, { method: 'POST' })).status, 401, 'needs a key');
});

test('the security questionnaire answers from the records, keeps the vendor’s own answers, and downloads as CSV', async () => {
  const { cookie, dep, csrf } = await setup();
  await post(`${dep}/scan`, cookie, { csrf });
  for (let i = 0; i < 200 && /aria-label="Check progress"/.test(await (await get(`${dep}/scan`, cookie)).text()); i++) await new Promise(x => setTimeout(x, 25));
  const page = await (await get(`${dep}/questionnaire`, cookie)).text();
  assert.match(page, /Security and AI questionnaire/);
  assert.match(page, /VendorCo’s AI agent for Acme Bank/);
  assert.match(page, /1 of 2 rules kept/);
  assert.match(page, /Store credit after 30 days/);
  assert.match(page, /Big orders go to a human \(kept in the latest check\)/, 'hand-off rules are found and reported');
  assert.match(page, /hash; verified intact/);
  assert.match(page, /Which security certifications do you hold/);
  assert.doesNotMatch(page, /SOC 2 certified|ISO 27001 certified/, 'Grapim never claims a certification');

  const saved = await post(`${dep}/questionnaire`, cookie, { csrf: csrfOf(page), certifications: 'SOC 2 Type I in progress, audit planned for Q2.', hosting: '' });
  assert.equal(saved.status, 303);
  const csv = await get(`${dep}/questionnaire.csv`, cookie);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="questionnaire-/);
  const bytes = Buffer.from(await csv.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'a BOM, so Excel reads it as UTF-8');
  const text = bytes.toString('utf8');
  assert.match(text, /Section,Question,Answer,Source/);
  assert.match(text, /"SOC 2 Type I in progress, audit planned for Q2\.",Vendor/);
  assert.match(text, /\(to be answered by the vendor\),Vendor/);
  assert.match(text, /Grapim records/);
  assert.equal((await get(`${dep}/questionnaire`, '')).status >= 300, true, 'not public');
});
