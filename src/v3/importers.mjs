// Read-only import of a client's material straight from its systems, so nobody has to export and upload
// files: solved tickets (for the test set) and help-center articles or store policies (for the policy check).
// Every request is a read (Intercom's search is a POST that reads), goes through the netguard, and never
// carries the token into an error. Ticket text is de-identified before it is written: emails, phone numbers
// and card numbers become placeholders, and requester names and emails are never kept.
//
//   importFrom(source, { subdomain, email, shop, token }, { limit, fetchJson })
//     -> { files: [{ name, text }], summary: { tickets, articles, policies } }

import { requestJson, stripHtml } from '../connectors/common.mjs';
import { ZENDESK_SUBDOMAIN } from '../connectors/zendesk.mjs';
import { toCsvLine } from '../csv.mjs';
import { scrub } from '../v4/scrub.mjs';

export const SOURCES = {
  zendesk: { label: 'Zendesk Support', fields: ['subdomain', 'email'], secret: 'token' },
  intercom: { label: 'Intercom', fields: [], secret: 'token' },
  shopify: { label: 'Shopify', fields: ['shop'], secret: 'token' },
};

const MAX_FILE_BYTES = 1024 * 1024;
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const INTERCOM = 'https://api.intercom.io';
const CSV_HEADER = ['ticket_id', 'created', 'channel', 'customer_message', 'agent_resolution', 'tags'];

const clean = text => scrub(String(text ?? '').replace(/\s+/g, ' ').trim()).text;

// Turns a 401/403 on the first request into a message about the credentials; other errors pass through.
async function first(fetchJson, url, options, refused) {
  try {
    return await fetchJson(url, options);
  } catch (e) {
    if (e.status === 401 || e.status === 403) throw Object.assign(new Error(`${refused} (HTTP ${e.status}).`), { status: e.status });
    throw e;
  }
}

// Articles are optional: a plan without a help center answers 403 or 404, which means none.
async function optional(fetchJson, url, options) {
  try {
    return await fetchJson(url, options);
  } catch (e) {
    if (e.status === 403 || e.status === 404) return null;
    throw e;
  }
}

function ticketsCsv(rows) {
  return [toCsvLine(CSV_HEADER), ...rows.map(r => toCsvLine(CSV_HEADER.map(k => r[k] ?? '')))].join('\n') + '\n';
}

// Markdown with one section per document, stopping before the file would pass 1 MB.
function markdown(title, docs) {
  let out = `# ${title}\n`;
  let count = 0;
  for (const d of docs) {
    const section = `\n## ${String(d.title ?? '').trim() || 'Untitled'}\n\n${stripHtml(d.body)}\n`;
    if (Buffer.byteLength(out + section) > MAX_FILE_BYTES) break;
    out += section;
    count++;
  }
  return { text: out, count };
}

function capCsv(rows) {
  const kept = [];
  for (const r of rows) {
    if (Buffer.byteLength(ticketsCsv([...kept, r])) > MAX_FILE_BYTES) break;
    kept.push(r);
  }
  return kept;
}

async function fromZendesk({ subdomain, email, token }, { limit, fetchJson }) {
  if (!ZENDESK_SUBDOMAIN.test(String(subdomain ?? ''))) throw new Error('Enter the Zendesk subdomain, the part before .zendesk.com.');
  if (!String(email ?? '').includes('@')) throw new Error('Enter the email of the Zendesk user the API token belongs to.');
  const base = `https://${subdomain}.zendesk.com`;
  const options = { label: 'Zendesk', headers: { authorization: `Basic ${Buffer.from(`${email}/token:${token}`).toString('base64')}` } };
  const query = encodeURIComponent('type:ticket status:solved');
  const found = await first(fetchJson, `${base}/api/v2/search.json?query=${query}&sort_by=updated_at&sort_order=desc&per_page=${limit}`, options, 'Zendesk refused the credentials. Check the email and API token');
  const rows = [];
  for (const t of (found.results ?? []).slice(0, limit)) {
    const { comments = [] } = await fetchJson(`${base}/api/v2/tickets/${encodeURIComponent(t.id)}/comments.json`, options);
    const text = c => c.plain_body ?? stripHtml(c.html_body ?? c.body);
    const reply = comments.filter(c => c.public !== false && c.author_id !== t.requester_id).at(-1);
    if (!reply || !text(reply).trim()) continue;
    rows.push({
      ticket_id: String(t.id), created: String(t.created_at ?? '').slice(0, 10), channel: t.via?.channel ?? '',
      customer_message: clean(t.description ?? (comments[0] ? text(comments[0]) : '')), agent_resolution: clean(text(reply)),
      tags: (t.tags ?? []).join('|'),
    });
  }
  const files = [];
  const kept = capCsv(rows.filter(r => r.customer_message));
  if (kept.length) files.push({ name: 'zendesk-tickets.csv', text: ticketsCsv(kept) });
  const help = await optional(fetchJson, `${base}/api/v2/help_center/articles.json?per_page=100`, options);
  const articles = (help?.articles ?? []).filter(a => !a.draft);
  const md = markdown('Zendesk Help Center', articles);
  if (md.count) files.push({ name: 'zendesk-help-center.md', text: md.text });
  return { files, summary: { tickets: kept.length, articles: md.count, policies: 0 } };
}

async function fromIntercom({ token }, { limit, fetchJson }) {
  const options = { label: 'Intercom', headers: { authorization: `Bearer ${token}`, 'Intercom-Version': '2.11' } };
  const found = await first(fetchJson, `${INTERCOM}/conversations/search`, {
    ...options, method: 'POST', body: { query: { field: 'state', operator: '=', value: 'closed' }, pagination: { per_page: Math.min(limit, 50) } },
  }, 'Intercom refused the access token. Check that it can read conversations');
  const rows = [];
  for (const c of (found.conversations ?? []).slice(0, limit)) {
    const full = await fetchJson(`${INTERCOM}/conversations/${encodeURIComponent(c.id)}`, options);
    const parts = full.conversation_parts?.conversation_parts ?? [];
    const reply = parts.filter(p => ['comment', 'close'].includes(p.part_type) && ['admin', 'bot'].includes(p.author?.type) && stripHtml(p.body)).at(-1);
    const message = clean(stripHtml(full.source?.body ?? c.source?.body));
    if (!reply || !message) continue;
    rows.push({
      ticket_id: String(c.id), created: c.created_at ? new Date(c.created_at * 1000).toISOString().slice(0, 10) : '',
      channel: full.source?.delivered_as ?? full.source?.type ?? '', customer_message: message, agent_resolution: clean(stripHtml(reply.body)),
      tags: (full.tags?.tags ?? []).map(t => t.name).join('|'),
    });
  }
  const files = [];
  const kept = capCsv(rows);
  if (kept.length) files.push({ name: 'intercom-tickets.csv', text: ticketsCsv(kept) });
  const help = await optional(fetchJson, `${INTERCOM}/articles`, options);
  const articles = (help?.data ?? []).filter(a => a.state === 'published');
  const md = markdown('Intercom Help Center', articles);
  if (md.count) files.push({ name: 'intercom-help-center.md', text: md.text });
  return { files, summary: { tickets: kept.length, articles: md.count, policies: 0 } };
}

async function fromShopify({ shop, token }, { fetchJson }) {
  const domain = String(shop ?? '').trim().toLowerCase();
  if (!SHOP.test(domain)) throw new Error('Enter the shop domain, such as your-store.myshopify.com.');
  const options = { label: 'Shopify', headers: { 'X-Shopify-Access-Token': token } };
  const res = await first(fetchJson, `https://${domain}/admin/api/2024-10/policies.json`, options, 'Shopify refused the access token. Check that it can read the store’s legal policies');
  const policies = (res.policies ?? []).filter(p => stripHtml(p.body).trim());
  const md = markdown('Shopify store policies', policies);
  return { files: md.count ? [{ name: 'shopify-policies.md', text: md.text }] : [], summary: { tickets: 0, articles: 0, policies: md.count } };
}

const IMPORTERS = { zendesk: fromZendesk, intercom: fromIntercom, shopify: fromShopify };

export async function importFrom(source, creds = {}, { limit = 50, fetchJson = requestJson } = {}) {
  const run = IMPORTERS[source];
  if (!run) throw new Error(`Choose one of: ${Object.keys(SOURCES).join(', ')}.`);
  const token = String(creds.token ?? '').trim();
  if (!token) throw new Error(`Paste the ${SOURCES[source].label} API token.`);
  const n = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  return run({ ...creds, token }, { limit: n, fetchJson });
}
