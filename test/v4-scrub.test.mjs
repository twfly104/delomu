import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, luhn, ibanValid, compilePatterns } from '../src/v4/scrub.mjs';

const s = (text, opts) => scrub(text, opts);

test('scrub: emails', () => {
  const r = s('Write to jane.doe+billing@acme-corp.co.uk or OPS@example.io.');
  assert.equal(r.text, 'Write to [EMAIL] or [EMAIL].');
  assert.deepEqual(r.found, { email: 2 });
});

test('scrub: international phone numbers', () => {
  for (const phone of ['+1 (415) 555-2671', '+44 20 7946 0958', '020 7946 0958', '415-555-2671', '(415) 555-2671',
    '+886 2 2345 6789', '+49 30 901820', '0049 30 9018 2000', '415.555.2671', '+33 1 42 68 53 00']) {
    const r = s(`Call ${phone} today.`);
    assert.equal(r.text, 'Call [PHONE] today.', phone);
    assert.equal(r.found.phone, 1, phone);
  }
});

test('scrub: payment cards are Luhn-checked', () => {
  assert.equal(s('card 4111 1111 1111 1111.').text, 'card [CARD].');
  assert.equal(s('card 5500-0000-0000-0004').text, 'card [CARD]');
  assert.equal(s('amex 378282246310005').text, 'amex [CARD]');
  assert.equal(s('charged card 4111 1111 1111 1111 40 days ago').text, 'charged card [CARD] 40 days ago', 'a number right after a card');
  assert.equal(luhn('4111111111111111'), true);
  assert.equal(luhn('4111111111111112'), false);
  assert.equal(s('ref 4111111111111112').found.card, undefined);
});

test('scrub: IBANs are mod-97 checked, with or without spaces', () => {
  assert.equal(s('Pay to DE89 3704 0044 0532 0130 00 please').text, 'Pay to [IBAN] please');
  assert.equal(s('IBAN GB82WEST12345698765432.').text, 'IBAN [IBAN].');
  assert.equal(s('IBAN DE89 3704 0044 0532 0130 00 THEN').text, 'IBAN [IBAN] THEN');
  assert.equal(ibanValid('GB82WEST12345698765433'), false);
  assert.equal(s('code GB82WEST12345698765433').found.iban, undefined);
});

test('scrub: IPv4 and IPv6, but not version numbers', () => {
  assert.equal(s('from 192.168.1.20, 10.0.0.1 and 8.8.8.8').text, 'from [IP], [IP] and [IP]');
  assert.equal(s('hosts ::1 and 2001:db8::8a2e:370:7334 and 2001:0db8:85a3:0000:0000:8a2e:0370:7334').text, 'hosts [IP] and [IP] and [IP]');
  assert.equal(s('upgrade to version 1.2.3.4 or v10.0.0.1, build 2.0.0.15').text, 'upgrade to version 1.2.3.4 or v10.0.0.1, build 2.0.0.15');
  assert.equal(s('999.1.1.1 is not an address').text, '999.1.1.1 is not an address');
});

test('scrub: URL query strings, fragments and credentials, keeping host and path', () => {
  const r = s('See https://user:hunter2@api.example.com/v1/orders?id=5&token=abc#frag. Also https://example.com/docs.');
  assert.equal(r.text, 'See https://[CREDENTIALS]@api.example.com/v1/orders?[QUERY]. Also https://example.com/docs.');
  assert.deepEqual(r.found, { url_credentials: 1, url_query: 1 });
});

test('scrub: API keys, bearer tokens and long secrets', () => {
  const cases = [
    'Authorization: Bearer abcdEFGH12345678xyz',
    'key sk-proj-abcdefghijklmnop1234',
    'key sk-ant-api03-ABCdef123456ghijkl',
    'key rk_live_abcdefghij123456',
    'key dk_abcdefabcdef1234',
    'token ghp_ABCDEFGHIJKLMNOPQRSTuvwxyz123456',
    'aws AKIAIOSFODNN7EXAMPLE',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'sha 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    'b64 aGVsbG8gd29ybGQgdGhpcyBpcyBzZWNyZXQ9PQ==',
  ];
  for (const c of cases) {
    const r = s(c);
    assert.ok(r.text.includes('[SECRET]'), c);
    assert.ok(r.found.secret >= 1, c);
  }
  assert.equal(s('Bearer abcdEFGH12345678xyz').text, 'Bearer [SECRET]');
});

test('scrub: US social security numbers', () => {
  assert.equal(s('SSN 123-45-6789.').text, 'SSN [SSN].');
  assert.equal(s('SSN 000-12-3456').found.ssn, undefined);
  assert.equal(s('SSN 666-12-3456').found.ssn, undefined);
});

test('scrub: configurable patterns and customer names', () => {
  const r = s('Order ORD-104233 for Jane Doe at Acme Corp; acct AC-77812; ask jane.', {
    names: ['Jane Doe', 'Acme Corp', 'Jane'],
    patterns: { order: 'ORD-\\d{6}', ACCOUNT: '\\bAC-\\d{5}\\b' },
  });
  assert.equal(r.text, 'Order [ORDER] for [NAME] at [NAME]; acct [ACCOUNT]; ask [NAME].');
  assert.deepEqual(r.found, { order: 1, account: 1, name: 3 });
  // Names match whole words only, and never rewrite a placeholder.
  assert.equal(s('Janet and [EMAIL]', { names: ['Jane', 'EMAIL'] }).text, 'Janet and [EMAIL]');
});

test('scrub: invalid pattern config is rejected with a clear message', () => {
  assert.throws(() => compilePatterns({ '1bad': 'x' }), /not a valid name/);
  assert.throws(() => compilePatterns({ ORDER: '(' }), /not a valid regex/);
  assert.throws(() => compilePatterns({ ORDER: 'x*' }), /matches empty text/);
  assert.throws(() => compilePatterns(['x']), /must be an object/);
  assert.throws(() => scrub('x', { names: 'Jane' }), /array/);
});

test('scrub: false positives survive (prices, dates, times, versions, ids, env refs)', () => {
  const safe = [
    'The plan costs $1,299.99 per year or 1234567.89 EUR in total.',
    'Charged on 2026-10-31, again on 31/10/2026 and 10.31.2026 at 10:30:45.',
    'Upgrade from v2.3.1 to 3.0.0-beta.2; node 20.11.1.',
    'Refunds take 5-10 business days; order 1042; quantity 3; 20% off.',
    'Unix time 1700000000 and year range 2020-2026.',
    'Header uses Bearer ${CUSTOMER_API_KEY} from the environment.',
    'internationalizationandlocalizationframework and a-very-long-kebab-case-identifier-name-here',
    'Call the {{input}} template with id case-12.',
  ];
  for (const text of safe) {
    const r = s(text);
    assert.equal(r.text, text, text);
    assert.deepEqual(r.found, {}, text);
  }
});

test('scrub: deterministic and safe on empty input', () => {
  const text = 'mail a@b.co, call +1 415 555 2671, card 4111111111111111';
  assert.deepEqual(s(text), s(text));
  assert.deepEqual(s(undefined), { text: '', found: {} });
  assert.deepEqual(s(''), { text: '', found: {} });
});

test('scrub: Bearer/Basic/Token followed by a plain word is prose, not a credential', () => {
  for (const text of ['Basic information about your plan.', 'Token authentication failed.', 'Bearer authentication is required.']) {
    assert.deepEqual(s(text), { text, found: {} }, text);
  }
  assert.equal(s('Basic dXNlcjpwYXNzd29yZA==').text, 'Basic [SECRET]');
  assert.equal(s('Token abcdefGHIJKLmnop').text, 'Token [SECRET]');
});

test('scrub: a date followed by a time is not a phone number', () => {
  for (const text of ['Charged on 2026-10-31 12:00 UTC.', 'Between 2026-10-01 and 2026-10-31 14:30', 'Due 31/10/2026 9:15']) {
    assert.deepEqual(s(text), { text, found: {} }, text);
  }
  assert.equal(s('Call 415-555-2671 on 2026-10-31.').text, 'Call [PHONE] on 2026-10-31.');
});
