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
