import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLlm } from '../src/core/llm.mjs';
import { listDrafts } from '../src/core/drafts.mjs';
import { readAudit } from '../src/core/audit.mjs';
import { cleanInputName } from '../src/v3/web.mjs';
import { startServer, seedOrg, fakeTarget } from './v3-support.test.mjs';

const MAPPING = {
  systems: [{ name: 'Support bot', purpose: 'answers customers' }],
  entities: [{ name: 'Ticket', system: 'Support bot', fields: [{ name: 'id', meaning: 'ticket id', example: 'T-1' }] }],
  openQuestions: ['Who approves refunds over 500 USD?'],
  rationale: 'From policy.md.',
};

let srv;
let target;
let o;
const answers = [];
const llm = createLlm({ client: { beta: { messages: { create: async () => {
  const a = answers.shift();
  if (a instanceof Error) throw a;
  return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(a) }] };
} } } } });

before(async () => {
  srv = await startServer({ llm });
  target = await fakeTarget();
  o = seedOrg(srv.dataDir, { name: 'Acme', members: [{ email: 'eng@acme.test', role: 'engineer' }, { email: 'view@acme.test', role: 'viewer' }] });
});

after(async () => {
  await srv.close();
  await target.close();
});

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);

async function signIn(email) {
  const page = await fetch(`${srv.base}/login`);
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())[1];
  const res = await fetch(`${srv.base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] },
    body: new URLSearchParams({ csrf, api_key: o.keys[email] }),
  });
  const cookie = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await fetch(`${srv.base}/`, { headers: { cookie } });
  return { cookie, csrf: /name="csrf" value="([^"]+)"/.exec(await home.text())[1] };
}

const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, form) => fetch(srv.base + url, {
  method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form),
});

test('input file names are cleaned and limited to readable types', () => {
  assert.equal(cleanInputName('refund policy.md'), 'refund-policy.md');
  assert.equal(cleanInputName('../../etc/tickets.csv'), 'tickets.csv');
  assert.equal(cleanInputName('C:\\Users\\x\\api.json'), 'api.json');
  assert.equal(cleanInputName('.env'), null);
  assert.equal(cleanInputName('run.exe'), null);
  assert.equal(cleanInputName(''), null);
});

test('an engineer creates a deployment, adds material, asks the agent, approves, and runs tests from the web', async () => {
  const eng = await signIn('eng@acme.test');
  const org = `/orgs/${o.org.id}`;

  // Create, with validation errors shown on the form.
  const bad = await post(`${org}/new-deployment`, eng.cookie, { csrf: eng.csrf, name: 'Bad Name', type: 'http', url: target.url, pass: '90' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /Bad Name/);
  const noUrl = await post(`${org}/new-deployment`, eng.cookie, { csrf: eng.csrf, name: 'bot', type: 'http', url: 'ftp://x', pass: '90' });
  assert.equal(noUrl.status, 400);
  const created = await post(`${org}/new-deployment`, eng.cookie, { csrf: eng.csrf, name: 'bot', customer: 'Acme Inc.', type: 'http', url: target.url, output: 'reply', pass: '50' });
  assert.equal(created.status, 303);
  assert.equal(created.headers.get('location'), `${org}/deployments/bot?notice=created`);
  const dir = path.join(srv.deploymentsRoot, o.org.id, 'bot');
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'delomu.json'), 'utf8'));
  assert.deepEqual(config.target, { type: 'http', url: target.url, body: { message: '{{input}}' }, output: 'reply' });
  assert.equal(config.acceptance.minPassRate, 0.5);
  assert.match(await (await get(created.headers.get('location'), eng.cookie)).text(), /Deployment created/);

  // Upload customer material (multipart); unsupported types are refused.
  const upload = (files, csrf = eng.csrf) => {
    const fd = new FormData();
    fd.set('csrf', csrf);
    for (const [name, text] of files) fd.append('files', new Blob([text]), name);
    return fetch(`${srv.base}${org}/deployments/bot/inputs`, { method: 'POST', redirect: 'manual', headers: { cookie: eng.cookie }, body: fd });
  };
  assert.equal((await upload([['policy.md', '# Refunds']], 'forged')).status, 403);
  assert.equal((await upload([['evil.sh', 'rm -rf /']])).status, 400);
  const up = await upload([['refund policy.md', '# Refunds within 30 days'], ['tickets.csv', 'id,customer_message\nT-1,Refund please\n']]);
  assert.equal(up.status, 303);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'inputs')).sort(), ['refund-policy.md', 'tickets.csv']);
  assert.ok(readAudit(dir).some(e => e.action === 'input.upload' && e.target === 'refund-policy.md'));

  // Ask the agent: missing credentials and refusals are explained, a good answer becomes a pending draft.
  answers.push(Object.assign(new Error('Could not resolve authentication method'), {}));
  const noKey = await post(`${org}/deployments/bot/agent`, eng.cookie, { csrf: eng.csrf, task: 'mapping' });
  assert.equal(noKey.status, 400);
  assert.match(await noKey.text(), /no model credentials/);
  assert.equal((await post(`${org}/deployments/bot/agent`, eng.cookie, { csrf: eng.csrf, task: 'deploy-to-prod' })).status, 400);
  answers.push(MAPPING);
  const drafted = await post(`${org}/deployments/bot/agent`, eng.cookie, { csrf: eng.csrf, task: 'mapping' });
  assert.equal(drafted.status, 303);
  const [draft] = listDrafts(dir, { status: 'pending' });
  assert.equal(draft.kind, 'mapping');

  // The review page shows the proposal as readable content, not just JSON, and approving applies it.
  const reviewPage = await (await get(`${org}/deployments/bot/drafts`, eng.cookie)).text();
  assert.match(reviewPage, /Who approves refunds over 500 USD\?/);
  assert.match(reviewPage, /Why the agent proposes this/);
  const approved = await post(`${org}/deployments/bot/drafts/${draft.id}/review`, eng.cookie, { csrf: eng.csrf, decision: 'approve' });
  assert.equal(approved.status, 303);
  assert.ok(fs.existsSync(path.join(dir, 'mapping.json')));

  // Run tests from the web; the overview shows the result and the six-step track.
  fs.writeFileSync(path.join(dir, 'cases.csv'), 'id,input,must_include\nr1,Refund please,refund\nr2,Where is my order?,tracking\n');
  const { writeTests } = await import('../src/commands/v0.mjs');
  writeTests(dir);
  const ran = await post(`${org}/deployments/bot/run`, eng.cookie, { csrf: eng.csrf });
  assert.equal(ran.status, 303);
  const overview = await (await get(`${org}/deployments/bot`, eng.cookie)).text();
  assert.match(overview, /Latest result/);
  assert.match(overview, /Data mapping/);
  assert.match(overview, /Test set/);
  assert.match((await (await get(`${org}/deployments/bot/runs`, eng.cookie)).text()), /Run 1/);
  for (const tab of ['inputs', 'settings']) assert.equal((await get(`${org}/deployments/bot/${tab}`, eng.cookie)).status, 200, tab);

  // Home lists the deployment.
  assert.match(await (await get('/', eng.cookie)).text(), /href="\/orgs\/[^"]+\/deployments\/bot"/);
});

test('viewers see the workspace but cannot create, upload, ask the agent or run', async () => {
  const v = await signIn('view@acme.test');
  const org = `/orgs/${o.org.id}`;
  assert.equal((await get(`${org}/new-deployment`, v.cookie)).status, 403);
  assert.equal((await post(`${org}/new-deployment`, v.cookie, { csrf: v.csrf, name: 'x', type: 'http', url: target.url })).status, 403);
  const page = await (await get(`${org}/deployments/bot`, v.cookie)).text();
  assert.ok(!page.includes('/agent"'), 'no agent form for viewers');
  assert.ok(!page.includes('/run"'), 'no run form for viewers');
  assert.equal((await post(`${org}/deployments/bot/agent`, v.cookie, { csrf: v.csrf, task: 'mapping' })).status, 403);
  assert.equal((await post(`${org}/deployments/bot/run`, v.cookie, { csrf: v.csrf })).status, 403);
});
