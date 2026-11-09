// Round 3 (unicorn thinking, applied): the first check runs on the client's real public policy page, the client's
// sign-off ends with what they keep and a way to ask their other AI vendors, and Home leads with days to sign-off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPolicyPage, htmlToPolicyText, policyFileName, PolicyUrlError } from '../src/v1/policy-url.mjs';
import { blockPrivateTargets } from '../src/core/netguard.mjs';
import { rolloutStatus } from '../src/v3/html.mjs';
import { signoffPage } from '../src/v3/signoff.mjs';

const POLICY = `<html><head><title>Returns &amp; refunds | Linden</title><script>track()</script></head><body>
<nav>Shop Sale About</nav><main><h1>Returns and refunds</h1><p>${'Most items can be returned within 30 days of delivery for a full refund. '.repeat(25)}</p>
<h2>Final sale</h2><p>Final-sale items cannot be returned or refunded.</p><form>newsletter</form></main><footer>© Linden</footer></body></html>`;
const page = (body, { status = 200, type = 'text/html; charset=utf-8' } = {}) => async () => new Response(body, { status, headers: { 'content-type': type } });

test('a public policy page becomes a policy file with its headings, source and date', async () => {
  const got = await fetchPolicyPage('https://www.linden.example/help/returns', { fetchImpl: page(POLICY), now: new Date('2026-11-09T12:00:00Z') });
  assert.equal(got.name, 'linden-example-help-returns.md');
  assert.match(got.text, /^# Returns & refunds \| Linden\n\nSource: https:\/\/www\.linden\.example\/help\/returns\nFetched: 2026-11-09T12:00:00\.000Z/);
  assert.match(got.text, /\n# Returns and refunds\n/);
  assert.match(got.text, /\n## Final sale\n/);
  assert.doesNotMatch(got.text, /track\(\)|newsletter|Shop Sale|© Linden/);
  assert.equal(htmlToPolicyText('<p>x</p>').text, 'x');
  assert.equal(policyFileName('https://example.com/'), 'example-com.md');
});

test('the policy fetch refuses what it should, with a reason a person can act on', async () => {
  const no = async (url, opts) => assert.rejects(fetchPolicyPage(url, opts), PolicyUrlError);
  await no('not a url');
  await no('http://example.com/policy', { fetchImpl: page(POLICY) });
  await no('https://user:pw@example.com/policy', { fetchImpl: page(POLICY) });
  await no('https://example.com/policy', { fetchImpl: page(POLICY, { status: 404 }) });
  await no('https://example.com/policy.pdf', { fetchImpl: page('%PDF', { type: 'application/pdf' }) });
  await no('https://example.com/app', { fetchImpl: page('<div id="root"></div><script src="app.js"></script>') });
  await no('https://example.com/big', { fetchImpl: page('x'.repeat(2 * 1024 * 1024 + 10)) });
  blockPrivateTargets(true);
  try {
    await assert.rejects(fetchPolicyPage('https://127.0.0.1/policy', { fetchImpl: page(POLICY) }), /private or local address/);
  } finally { blockPrivateTargets(false); }
});

test('after accepting, the client sees what they keep and can ask other vendors for the same record', () => {
  const scan = { id: 's', createdAt: '2026-11-02T10:00:00.000Z', summary: { rules: 1, broken: 0, probes: 1 }, rules: [{ id: 'r', title: 'Refunds', rule: 'r', probes: [] }] };
  const done = { decision: 'accepted', name: 'Dana', at: '2026-11-03T00:00:00.000Z', note: '' };
  const html = signoffPage({ csrf: 'c', token: 'tok', preparedBy: 'VendorCo', client: 'Acme Bank', name: 'bot', scan, done });
  assert.match(html, /What you keep/);
  assert.match(html, /Other AI vendors working for Acme Bank\?/);
  assert.match(html, /href="mailto:\?subject=The%20policy%20record/);
  assert.doesNotMatch(signoffPage({ csrf: 'c', token: 'tok', preparedBy: 'VendorCo', client: 'Acme Bank', name: 'bot', scan, done: { ...done, decision: 'declined' } }), /What you keep/);
});

test('a signed-off rollout says how many days it took from adding the client', () => {
  const st = rolloutStatus({ ov: { scans: [{ createdAt: '2026-11-02T00:00:00.000Z', summary: { rules: 8, broken: 0 } }] }, signoff: { decision: 'accepted', name: 'Dana', at: '2026-11-05T00:00:00.000Z' }, signoffOpen: 0, daysToSignoff: 3 });
  assert.equal(st.word, 'Signed off');
  assert.equal(st.days, 3);
  assert.match(st.why, /3 days after the client was added/);
});

test('the judge spot-check picks kept answers at random, stays fixed per check, and counts what people found', async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { spotSample, recordSpot, spotRecord, spotsFor } = await import('../src/v3/spotcheck.mjs');
  const probes = n => Array.from({ length: n }, (_, i) => ({ message: `m${i}`, answer: 'a', status: i === 0 ? 'broken' : 'kept' }));
  const scan = { id: 'c1', rules: [{ id: 'r1', probes: probes(4) }, { id: 'r2', probes: probes(4) }] };
  const sample = spotSample(scan);
  assert.equal(sample.length, 5);
  assert.ok(sample.every(x => x.probe.status === 'kept'), 'only kept answers');
  assert.deepEqual(spotSample(scan).map(x => x.key), sample.map(x => x.key), 'the same sample on every reload');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grapim-spot-'));
  recordSpot(dir, { scanId: 'c1', key: sample[0].key, agree: true, actor: 'human:a' });
  recordSpot(dir, { scanId: 'c1', key: sample[1].key, agree: false, actor: 'human:a' });
  assert.deepEqual(spotRecord(dir, ['c1']), { reviewed: 2, wrong: 1 });
  assert.equal(spotsFor(dir, 'c1')[sample[1].key].agree, false);
});
