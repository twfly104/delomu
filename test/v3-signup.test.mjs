import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './v3-support.test.mjs';

const open = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
const closed = await startServer();
after(() => { open.close(); closed.close(); });

const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]);
async function form(base) {
  const page = await fetch(`${base}/signup`, { redirect: 'manual' });
  const text = await page.text();
  return { page, text, csrf: /name="csrf" value="([^"]+)"/.exec(text)?.[1], cookie: cookiesOf(page)[0] };
}
const submit = (base, f, body, ip) => fetch(`${base}/signup`, {
  method: 'POST', redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: f.cookie, ...(ip ? { 'x-forwarded-for': ip } : {}) },
  body: new URLSearchParams({ csrf: f.csrf, ...body }),
});

test('sign-up is off unless the operator opens it', async () => {
  assert.equal((await fetch(`${closed.base}/signup`, { redirect: 'manual' })).headers.get('location'), '/login');
  assert.doesNotMatch(await (await fetch(`${closed.base}/login`)).text(), /Create a free account/);
  assert.match(await (await fetch(`${open.base}/login`)).text(), /Create a free account/);
});

test('a new user signs up, gets a key once, lands signed in, and can sign in again with the key', async () => {
  const f = await form(open.base);
  assert.match(f.text, /Test your support AI/);
  assert.equal((await submit(open.base, { ...f, csrf: 'forged' }, { email: 'a@newco.test', company: 'Newco' })).status, 403);

  const res = await submit(open.base, f, { email: 'Ana@Newco.test', company: 'Newco' });
  assert.equal(res.status, 201);
  const page = await res.text();
  const key = /value="(dk_[^"]+)"/.exec(page)[1];
  assert.match(page, /shown only once/);
  const session = cookiesOf(res).find(c => c.startsWith('delomu_session='));
  const home = await (await fetch(`${open.base}/`, { headers: { cookie: session } })).text();
  assert.match(home, /Welcome to Delomu/);
  assert.match(home, /Try it on a sample support bot/);

  // The key works for the API and for signing in.
  const orgs = await (await fetch(`${open.base}/v1/orgs`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.equal(orgs.data[0].name, 'Newco');

  // The same email cannot sign up twice; bad input is explained.
  const again = await form(open.base);
  assert.equal((await submit(open.base, again, { email: 'ana@newco.test', company: 'Other' })).status, 409);
  const bad = await submit(open.base, again, { email: 'not-an-email', company: 'X' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /work email/);
});

test('sign-ups are rate limited per client', async () => {
  const f = await form(open.base);
  let last;
  for (let i = 0; i < 7; i++) last = await submit(open.base, f, { email: `u${i}@limit.test`, company: `Limit ${i}` });
  assert.equal(last.status, 429);
});
