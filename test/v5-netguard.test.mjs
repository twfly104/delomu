import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, blockPrivateTargets, isPrivateAddress, privateTargetsBlocked } from '../src/core/netguard.mjs';
import { callTarget } from '../src/adapters.mjs';
import { fakeTarget } from './v3-support.test.mjs';

after(() => blockPrivateTargets(false));

test('private, local and metadata addresses are recognized; public ones are not', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.100.1.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '104.16.1.1', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
});

test('with the guard on, a target that is or resolves to a private address is refused before any request', async () => {
  const bot = await fakeTarget();
  try {
    blockPrivateTargets(true);
    assert.equal(privateTargetsBlocked(), true);
    await assert.rejects(callTarget({ type: 'http', url: bot.url, body: { message: '{{input}}' }, output: 'reply' }, 'hi'), /private or local address/);
    await assert.rejects(assertPublicUrl('http://metadata.example/', { lookup: async () => [{ address: '169.254.169.254' }] }), /169\.254\.169\.254/);
    await assertPublicUrl('https://bot.example/', { lookup: async () => [{ address: '93.184.216.34' }] });
    blockPrivateTargets(false);
    assert.equal(await callTarget({ type: 'http', url: bot.url, body: { message: '{{input}}' }, output: 'reply' }, 'hi'), 'Your refund was issued.');
  } finally {
    blockPrivateTargets(false);
    await bot.close();
  }
});
