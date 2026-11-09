import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, seedOrg } from './v3-support.test.mjs';
import { openDb } from '../src/v3/db.mjs';

const sent = [];
const hooks = [];
const srv = await startServer({
  env: { DELOMU_SIGNUP: 'open', GRAPIM_LEADS_WEBHOOK: 'https://hooks.example/leads', GRAPIM_LEADS_TO: 'founder@grapim.example', GRAPIM_OPERATOR_EMAILS: 'op@grapim.example' },
  emailLogin: { apiKey: 'k', from: 'Grapim <hi@grapim.example>' },
  sendEmail: async m => { sent.push(m); },
  fetch: async (url, init) => { hooks.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; },
});
after(() => srv.close());

const page = async () => {
  const res = await fetch(`${srv.base}/design-partners`);
  const csrf = /name="csrf" value="([^"]+)"/.exec(await res.clone().text())[1];
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  return { res, csrf, cookie };
};
const apply = async (fields, { csrf, cookie }) => fetch(`${srv.base}/design-partners`, {
  method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, ...fields }),
});

test('the design partner page is public, says what a partner gets and gives, and every Apply leads to it', async () => {
  const { res } = await page();
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Become a design partner\./);
  assert.match(html, /First cohort · 5 spots/);
  assert.match(html, /You get/);
  assert.match(html, /We ask/);
  for (const path of ['/', '/pricing']) {
    const other = await (await fetch(`${srv.base}${path}`)).text();
    assert.match(other, /href="\/design-partners"/, path);
    assert.doesNotMatch(other, /linkedin\.com\/in\//, `${path} sends nobody to a personal LinkedIn`);
  }
});

test('an application is stored, the operator is told, and the applicant is thanked', async () => {
  const s = await page();
  const res = await apply({ name: 'Dana Lee', email: 'Dana@Vendor.example', company: 'Vendor AI', website: 'vendor.example', timing: 'soon', review: 'weeks', note: 'A bank goes live in December.' }, s);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Thanks, Dana\./);
  const db = openDb(srv.dataDir);
  const rows = db.prepare('SELECT * FROM partner_applications').all();
  db.close();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'dana@vendor.example');
  assert.equal(rows[0].website, 'https://vendor.example');
  assert.match(rows[0].note, /^Last client's legal\/security review held up go-live: Yes, by weeks\./, 'the demand question is stored with every application');
  assert.equal(hooks.length, 1);
  assert.match(hooks[0].body.text, /Dana Lee \(dana@vendor\.example\), Vendor AI/);
  assert.match(hooks[0].body.text, /held up the last go-live: Yes, by weeks/);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['founder@grapim.example']);
  assert.equal(sent[0].reply_to, 'dana@vendor.example');
});

test('a bad application is refused with the reason and nothing is stored', async () => {
  const s = await page();
  const res = await apply({ name: 'X', email: 'not-an-email', company: 'Y', timing: 'now' }, s);
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Enter a work email address\./);
  const noCsrf = await fetch(`${srv.base}/design-partners`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=a' });
  assert.ok(noCsrf.status >= 400, 'a post without the form token is refused');
});

test('only an operator email can read the applications', async () => {
  assert.equal((await fetch(`${srv.base}/operator/applications`)).status, 404);
  const { keys } = seedOrg(srv.dataDir, { name: 'Ops', members: [{ email: 'op@grapim.example', role: 'owner' }, { email: 'someone@else.example', role: 'owner' }] });
  const login = async key => {
    const lp = await fetch(`${srv.base}/login`);
    const csrf = /name="csrf" value="([^"]+)"/.exec(await lp.clone().text())[1];
    const cookie = lp.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    const res = await fetch(`${srv.base}/login`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, api_key: key }) });
    return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  };
  const other = await login(keys['someone@else.example']);
  assert.equal((await fetch(`${srv.base}/operator/applications`, { headers: { cookie: other } })).status, 404);
  const op = await login(keys['op@grapim.example']);
  const res = await fetch(`${srv.base}/operator/applications`, { headers: { cookie: op } });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Vendor AI/);
});
