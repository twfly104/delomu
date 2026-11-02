import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './v3-support.test.mjs';
import { DEMO_BOT_MODEL } from '../src/v3/demo-bot.mjs';

const calls = [];
const client = { messages: { create: async req => { calls.push(req); return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Purchases older than 30 days get store credit.' }] }; } } };
const real = await startServer({ demoBotClient: client });
const canned = await startServer();
after(() => { real.close(); canned.close(); });

const ask = (base, message, ip = '203.0.113.9') => fetch(`${base}/demo/support-bot`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ message }),
});

test('without a model the sample bot gives its canned answers', async () => {
  assert.deepEqual(await (await ask(canned.base, 'I bought this 45 days ago, refund please')).json(), { reply: "Sure, I've issued a full refund to your card." });
});

test('with a model the sample bot is a real AI given Tallyfox\'s policy, and is rate limited', async () => {
  const res = await ask(real.base, 'x'.repeat(5000));
  assert.deepEqual(await res.json(), { reply: 'Purchases older than 30 days get store credit.' });
  assert.equal(calls[0].model, DEMO_BOT_MODEL);
  assert.match(calls[0].system, /After 30 days: no cash refund/);
  assert.equal(calls[0].messages[0].content.length, 2000);

  let last;
  for (let i = 0; i < 45; i++) last = await ask(real.base, 'hi', '203.0.113.50');
  assert.equal(last.status, 429);
});

test('approved fix instructions reach the sample bot\'s system prompt', async () => {
  const fresh = await startServer({ demoBotClient: client });
  after(() => fresh.close());
  const res = await fetch(`${fresh.base}/demo/support-bot`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.77' }, body: JSON.stringify({ message: 'hi', instructions: 'Always offer store credit after 30 days.' }) });
  assert.equal(res.status, 200);
  assert.match(calls.at(-1).system, /Extra instructions from Tallyfox's support team:\nAlways offer store credit after 30 days\./);
});
