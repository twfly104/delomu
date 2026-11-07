import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './v3-support.test.mjs';

const srv = await startServer({ env: { DELOMU_SIGNUP: 'open' } });
after(() => srv.close());

test('the public security page states facts and never claims a certification', async () => {
  const res = await fetch(`${srv.base}/security`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /<title>Security/);
  assert.match(text, /In preparation/);
  assert.match(text, /Not certified yet/);
  assert.match(text, /Not done yet/);
  assert.match(text, /security\/advisories|\/security">our repository/);
  assert.doesNotMatch(text, /SOC 2 (compliant|certified)|SOC 2 Type (I|II) report available/i);
  // Linked from the public footer.
  assert.match(await (await fetch(`${srv.base}/pricing`)).text(), /href="\/security"/);
});

test('privacy and terms pages are public, list only necessary cookies, and are linked from footer and sign-up', async () => {
  const privacy = await (await fetch(`${srv.base}/privacy`)).text();
  assert.match(privacy, /<title>Privacy Policy/);
  for (const c of ['delomu_session', 'delomu_login_csrf', 'delomu_oidc_state']) assert.match(privacy, new RegExp(c));
  assert.match(privacy, /No analytics, advertising or tracking cookies/);
  assert.match(privacy, /never use your material to train AI models/);
  const terms = await (await fetch(`${srv.base}/terms`)).text();
  assert.match(terms, /<title>Terms of Service/);
  assert.match(terms, /Drafts, not guarantees/);
  const foot = await (await fetch(`${srv.base}/pricing`)).text();
  assert.match(foot, /href="\/privacy"/);
  assert.match(foot, /href="\/terms"/);
  assert.match(await (await fetch(`${srv.base}/signup`)).text(), /you agree to the <a href="\/terms">Terms<\/a>/);
});
