import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './v3-support.test.mjs';

// Sign-in by email link: on only when an email provider is set; one link, used once.
const sent = [];
const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' }, emailLogin: { apiKey: 'test', from: 'Grapim <hi@grapim.test>' }, sendEmail: async m => { sent.push(m); } });
const off = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => { srv.close(); off.close(); });

const cookiesOf = r => r.headers.getSetCookie().map(c => c.split(';')[0]);
const csrfOf = t => /name="csrf" value="([^"]+)"/.exec(t)?.[1];

test('a user signs in with a one-time email link; without a provider the form is not offered', async () => {
  assert.doesNotMatch(await (await fetch(`${off.base}/login`)).text(), /Email me a sign-in link/);

  const page = await fetch(`${srv.base}/signup`);
  const up = await fetch(`${srv.base}/signup`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(page)[0] }, body: new URLSearchParams({ csrf: csrfOf(await page.text()), email: 'ana@mailco.test', company: 'Mailco' }) });
  assert.equal(up.status, 303);
  // With email sign-in on, no key is shown at all.
  const home = await (await fetch(`${srv.base}/`, { headers: { cookie: cookiesOf(up).find(c => c.startsWith('delomu_session=')) } })).text();
  assert.doesNotMatch(home, /dk_/);

  const ask = async email => {
    const lp = await fetch(`${srv.base}/login`);
    const text = await lp.text();
    assert.match(text, /Email me a sign-in link/);
    return fetch(`${srv.base}/login/email`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookiesOf(lp)[0] }, body: new URLSearchParams({ csrf: csrfOf(text), email }) });
  };
  // The same answer for an unknown email, and nothing is sent.
  assert.match(await (await ask('nobody@mailco.test')).text(), /Check your email/);
  assert.equal(sent.length, 0);

  assert.match(await (await ask('Ana@Mailco.test')).text(), /Check your email/);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['ana@mailco.test']);
  const link = /(\/login\/email\/[A-Za-z0-9_-]+)/.exec(sent[0].text)[1];
  const inn = await fetch(srv.base + link, { redirect: 'manual' });
  assert.equal(inn.status, 303);
  const session = cookiesOf(inn).find(c => c.startsWith('delomu_session='));
  assert.ok(session);
  assert.match(await (await fetch(`${srv.base}/`, { headers: { cookie: session } })).text(), /Mailco/);
  // Used once.
  const again = await fetch(srv.base + link, { redirect: 'manual' });
  assert.equal(again.status, 400);
  assert.match(await again.text(), /expired or was already used/);
});
