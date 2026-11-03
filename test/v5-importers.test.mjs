import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFrom, SOURCES } from '../src/v3/importers.mjs';
import { parseCsv } from '../src/csv.mjs';

// A fake fetchJson: routes by URL substring, records every call, throws { status } like requestJson does.
function fake(routes) {
  const calls = [];
  const fetchJson = async (url, options) => {
    calls.push({ url, ...options });
    for (const [match, reply] of routes) {
      if (url.includes(match)) {
        if (typeof reply === 'number') throw Object.assign(new Error(`${options.label} returned HTTP ${reply}`), { status: reply });
        return typeof reply === 'function' ? reply(url, options) : reply;
      }
    }
    throw Object.assign(new Error(`no route for ${url}`), { status: 500 });
  };
  return { fetchJson, calls };
}

const ZD = { subdomain: 'acme', email: 'ops@acme.example', token: 'zd-secret-123' };

test('Zendesk: solved tickets with the agent’s last public reply, de-identified, plus help-center articles', async () => {
  const { fetchJson, calls } = fake([
    ['/search.json', { results: [
      { id: 1, requester_id: 10, created_at: '2026-10-01T09:00:00Z', description: 'Refund order please, email me at jo@mail.example or +1 415 555 0101', tags: ['refund', 'vip'], via: { channel: 'email' } },
      { id: 2, requester_id: 11, created_at: '2026-10-02T09:00:00Z', description: 'Where is my parcel?', tags: [] },
    ] }],
    ['/tickets/1/comments.json', { comments: [
      { author_id: 10, public: true, plain_body: 'Refund order please' },
      { author_id: 99, public: false, plain_body: 'internal note: card 4111 1111 1111 1111' },
      { author_id: 99, public: true, plain_body: 'First reply' },
      { author_id: 99, public: true, html_body: '<p>Refunded within 30 days, card 4111 1111 1111 1111.</p>' },
    ] }],
    ['/tickets/2/comments.json', { comments: [{ author_id: 11, public: true, plain_body: 'Where is my parcel?' }] }],
    ['/help_center/articles.json', { articles: [{ title: 'Returns', body: '<p>30 days.</p>' }, { title: 'Draft', body: 'x', draft: true }] }],
  ]);
  const out = await importFrom('zendesk', ZD, { fetchJson, limit: 5 });
  assert.deepEqual(out.summary, { tickets: 1, articles: 1, policies: 0 });
  assert.deepEqual(out.files.map(f => f.name), ['zendesk-tickets.csv', 'zendesk-help-center.md']);
  const [row] = parseCsv(out.files[0].text);
  assert.equal(row.ticket_id, '1');
  assert.equal(row.created, '2026-10-01');
  assert.equal(row.channel, 'email');
  assert.equal(row.tags, 'refund|vip');
  assert.match(row.customer_message, /\[EMAIL\]/);
  assert.match(row.customer_message, /\[PHONE\]/);
  assert.equal(row.agent_resolution, 'Refunded within 30 days, card [CARD].');
  assert.ok(!out.files[0].text.includes('jo@mail.example'));
  assert.match(out.files[1].text, /## Returns\n\n30 days\./);
  assert.ok(!out.files[1].text.includes('Draft'));
  assert.match(calls[0].url, /query=type%3Aticket%20status%3Asolved&sort_by=updated_at&sort_order=desc&per_page=5/);
  assert.equal(calls[0].headers.authorization, `Basic ${Buffer.from('ops@acme.example/token:zd-secret-123').toString('base64')}`);
  assert.ok(calls.every(c => (c.method ?? 'GET') === 'GET'), 'Zendesk import only reads');
});

test('Zendesk: limit is applied, a missing help center is fine, bad credentials say so without the token', async () => {
  const many = { results: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, requester_id: 1, description: `q${i}` })) };
  const { fetchJson, calls } = fake([
    ['/search.json', many],
    ['/comments.json', { comments: [{ author_id: 2, public: true, plain_body: 'answer' }] }],
    ['/help_center/', 404],
  ]);
  const out = await importFrom('zendesk', ZD, { fetchJson, limit: 3 });
  assert.equal(out.summary.tickets, 3);
  assert.equal(out.summary.articles, 0);
  assert.equal(calls.filter(c => c.url.includes('/comments.json')).length, 3);

  const denied = fake([['/search.json', 401]]);
  await assert.rejects(importFrom('zendesk', ZD, { fetchJson: denied.fetchJson }), e => {
    assert.match(e.message, /Zendesk refused the credentials\. Check the email and API token \(HTTP 401\)/);
    assert.ok(!e.message.includes('zd-secret-123'));
    return true;
  });
  const broken = fake([['/search.json', many], ['/comments.json', { comments: [] }], ['/help_center/', 500]]);
  await assert.rejects(importFrom('zendesk', ZD, { fetchJson: broken.fetchJson }), /HTTP 500/);
});

test('Intercom: closed conversations with the last admin or bot reply, and published articles', async () => {
  const { fetchJson, calls } = fake([
    ['/conversations/search', { conversations: [{ id: 'c1', created_at: 1790000000 }, { id: 'c2', created_at: 1790000000 }] }],
    ['/conversations/c1', {
      source: { body: '<p>Can I cancel order L-1006? Call me on +44 20 7946 0958</p>', delivered_as: 'customer_initiated' },
      tags: { tags: [{ name: 'cancel' }] },
      conversation_parts: { conversation_parts: [
        { part_type: 'comment', author: { type: 'user' }, body: 'hello?' },
        { part_type: 'comment', author: { type: 'bot' }, body: '<p>Only within 1 hour.</p>' },
        { part_type: 'assignment', author: { type: 'admin' }, body: '' },
      ] },
    }],
    ['/conversations/c2', { source: { body: 'hi' }, conversation_parts: { conversation_parts: [{ part_type: 'comment', author: { type: 'user' }, body: 'bye' }] } }],
    ['/articles', { data: [{ title: 'Cancellations', body: '<p>1 hour.</p>', state: 'published' }, { title: 'Old', body: 'x', state: 'draft' }] }],
  ]);
  const out = await importFrom('intercom', { token: 'ic-secret' }, { fetchJson, limit: 80 });
  assert.deepEqual(out.summary, { tickets: 1, articles: 1, policies: 0 });
  assert.deepEqual(out.files.map(f => f.name), ['intercom-tickets.csv', 'intercom-help-center.md']);
  const [row] = parseCsv(out.files[0].text);
  assert.equal(row.agent_resolution, 'Only within 1 hour.');
  assert.match(row.customer_message, /\[PHONE\]/);
  assert.equal(row.tags, 'cancel');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].body.pagination.per_page, 50, 'Intercom pages hold at most 50');
  assert.equal(calls[0].headers['Intercom-Version'], '2.11');
  assert.ok(!out.files[1].text.includes('Old'));
});

test('Shopify: the store’s policies as one Markdown file; validation errors are plain', async () => {
  const { fetchJson, calls } = fake([['/admin/api/2024-10/policies.json', { policies: [{ title: 'Refund policy', body: '<p>30 days.</p>' }, { title: 'Empty', body: '' }] }]]);
  const out = await importFrom('shopify', { shop: 'Linden.myshopify.com', token: 'shpat_x' }, { fetchJson });
  assert.deepEqual(out.summary, { tickets: 0, articles: 0, policies: 1 });
  assert.equal(out.files[0].name, 'shopify-policies.md');
  assert.match(out.files[0].text, /## Refund policy\n\n30 days\./);
  assert.equal(calls[0].url, 'https://linden.myshopify.com/admin/api/2024-10/policies.json');
  assert.equal(calls[0].headers['X-Shopify-Access-Token'], 'shpat_x');

  await assert.rejects(importFrom('shopify', { shop: 'evil.example.com', token: 't' }, { fetchJson }), /myshopify\.com/);
  await assert.rejects(importFrom('zendesk', { ...ZD, subdomain: 'bad_sub!' }, { fetchJson }), /subdomain/);
  await assert.rejects(importFrom('zendesk', { ...ZD, email: 'nope' }, { fetchJson }), /email/);
  await assert.rejects(importFrom('intercom', { token: ' ' }, { fetchJson }), /Paste the Intercom API token/);
  await assert.rejects(importFrom('salesforce', { token: 't' }, { fetchJson }), /Choose one of/);
  const denied = fake([['/policies.json', 403]]);
  await assert.rejects(importFrom('shopify', { shop: 'a.myshopify.com', token: 'shpat_secret' }, { fetchJson: denied.fetchJson }), e => !e.message.includes('shpat_secret') && /HTTP 403/.test(e.message));
  assert.deepEqual(Object.keys(SOURCES), ['zendesk', 'intercom', 'shopify']);
});
