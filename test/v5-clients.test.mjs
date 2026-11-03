import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/v3/db.mjs';
import { createBilling } from '../src/v3/billing.mjs';
import { setPlanByOperator } from '../src/v3/billing.mjs';
import { startServer } from './v3-support.test.mjs';
import { clientStatus } from '../src/v3/html.mjs';

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = text => /name="csrf" value="([^"]+)"/.exec(text)?.[1];

async function signUp(body) {
  const page = await fetch(`${srv.base}/signup`, { redirect: 'manual' });
  const res = await fetch(`${srv.base}/signup`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] },
    body: new URLSearchParams({ csrf: csrfOf(await page.text()), ...body }),
  });
  assert.equal(res.status, 201);
  return cookiesOf(res).find(c => c.startsWith('delomu_session='));
}
const get = (url, cookie) => fetch(srv.base + url, { headers: { cookie }, redirect: 'manual' });
const post = (url, cookie, body) => fetch(srv.base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

test('sign-up offers both kinds; a company keeps the agents home', async () => {
  const page = await (await fetch(`${srv.base}/signup`)).text();
  assert.match(page, /We sell an AI agent to companies/);
  assert.match(page, /We use an AI agent with our customers/);
  const cookie = await signUp({ email: 'lead@shop.test', company: 'Shop', kind: 'company' });
  assert.match(await (await get('/', cookie)).text(), /Welcome to Grapim/);
});

test('an AI vendor gets a clients home, adds separate client workspaces, and bills them all on its own plan', async () => {
  const cookie = await signUp({ email: 'fde@vendorco.test', company: 'VendorCo', kind: 'vendor' });
  const home = await get('/', cookie);
  assert.equal(home.status, 303);
  const vendorPath = home.headers.get('location');
  const clients = await (await get(vendorPath, cookie)).text();
  assert.match(clients, /No clients yet/);
  assert.match(clients, />Clients</);

  // Adding a client creates a workspace managed by the vendor.
  const csrf = csrfOf(clients);
  assert.equal((await post(`${vendorPath}/clients`, cookie, { csrf: 'forged', name: 'Acme Bank' })).status, 403);
  const added = await post(`${vendorPath}/clients`, cookie, { csrf, name: 'Acme Bank' });
  assert.equal(added.status, 303);
  const clientPath = added.headers.get('location').split('?')[0];
  assert.match(await (await get(added.headers.get('location'), cookie)).text(), /Client workspace ready/);
  await post(`${vendorPath}/clients`, cookie, { csrf, name: 'Beta Health' });

  const list = await (await get(vendorPath, cookie)).text();
  assert.match(list, /Acme Bank/);
  assert.match(list, /Beta Health/);
  assert.match(list, /2 clients/);
  assert.match(list, /No AI agent yet/);
  assert.match(list, /Need attention/);
  assert.match(list, /Engineer hours/);

  // A client workspace has no billing of its own: it sends you to the vendor's.
  const bill = await get(`${clientPath}/billing`, cookie);
  assert.equal(bill.headers.get('location'), `${vendorPath}/billing`);

  // The client's plan is the vendor's plan.
  const db = openDb(srv.dataDir);
  try {
    const vendorId = decodeURIComponent(vendorPath.split('/').pop());
    const clientId = decodeURIComponent(clientPath.split('/').pop());
    const billing = createBilling({ db, deploymentsRoot: srv.deploymentsRoot });
    assert.equal(billing.planOf(clientId).id, 'free');
    setPlanByOperator(db, vendorId, 'vendor');
    assert.equal(billing.planOf(clientId).id, 'vendor');
    assert.equal(billing.summary(clientId).payer, vendorId);
    assert.equal(billing.summary(vendorId).clients, 2);
  } finally {
    db.close();
  }
});

test('only a vendor org can add clients', async () => {
  const cookie = await signUp({ email: 'cx@plain.test', company: 'Plain', kind: 'company' });
  const page = await (await get('/', cookie)).text();
  const orgPath = /href="(\/orgs\/[^"/]+)\/new-deployment"/.exec(page)[1];
  assert.equal((await post(`${orgPath}/clients`, cookie, { csrf: csrfOf(page), name: 'X' })).status, 404);
});

test('the new agent form stores what the AI does', async () => {
  const cookie = await signUp({ email: 'rev@salesco.test', company: 'SalesCo', kind: 'company' });
  const home = await (await get('/', cookie)).text();
  const orgPath = /href="(\/orgs\/[^"/]+)\/new-deployment"/.exec(home)[1];
  const form = await (await get(`${orgPath}/new-deployment`, cookie)).text();
  assert.match(form, /<option value="sales">Sales<\/option>/);
  const res = await post(`${orgPath}/new-deployment`, cookie, { csrf: csrfOf(form), name: 'deal-bot', agentKind: 'sales', type: 'http', url: 'https://bot.example/chat' });
  assert.equal(res.status, 303);
  const orgId = decodeURIComponent(orgPath.split('/').pop());
  const config = JSON.parse(fs.readFileSync(path.join(srv.deploymentsRoot, orgId, 'deal-bot', 'delomu.json'), 'utf8'));
  assert.equal(config.agentKind, 'sales');
});

test('client status puts the clients that need someone first', () => {
  const ov = ({ pending = 0, broken, flagged = 0 } = {}) => ({ pending: Array(pending).fill({}), scans: broken === undefined ? [] : [{ summary: { broken } }], live: { week: { checked: flagged, flagged } }, inputs: [] });
  assert.equal(clientStatus([]).text, 'No AI agent yet');
  assert.equal(clientStatus([{ ov: ov() }]).text, 'Not checked yet');
  assert.equal(clientStatus([{ ov: ov({ broken: 0 }) }]).text, 'On track');
  assert.equal(clientStatus([{ ov: ov({ broken: 2 }) }, { ov: ov({ broken: 1 }) }]).text, '3 rules broken');
  assert.equal(clientStatus([{ ov: ov({ broken: 0, flagged: 1 }) }]).text, '1 live chat broke a rule');
  assert.equal(clientStatus([{ ov: ov({ pending: 2, broken: 3 }) }]).text, '2 drafts to review');
  const ranks = ['review', 'broken', 'live', 'setup', 'unchecked', 'ok'];
  assert.ok(clientStatus([{ ov: ov({ pending: 1 }) }]).rank < clientStatus([]).rank);
  assert.equal(ranks.length, 6);
});

test('a vendor can open a sample client with the sample assistant in it', async () => {
  const cookie = await signUp({ email: 'fde@samplevendor.test', company: 'SampleVendor', kind: 'vendor' });
  const vendor = (await get('/', cookie)).headers.get('location');
  const page = await (await get(vendor, cookie)).text();
  assert.match(page, /Open a sample client/);
  const res = await post(`${vendor}/clients/sample`, cookie, { csrf: csrfOf(page) });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('location'), /\/deployments\/sample-linden-agent\/rollout$/);
  const list = await (await get(vendor, cookie)).text();
  assert.match(list, /Linden &amp; Co\. \(sample client\)/);
});
