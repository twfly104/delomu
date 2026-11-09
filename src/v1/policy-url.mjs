// A client's policy straight from its public web page: a refund policy, terms of service, a help-center article.
// The first check then runs on the client's real wording instead of a sample, which is the moment a vendor sees
// what Grapim is for. One GET, https only, through the netguard (no private addresses, no redirects to them),
// with a time and size limit. The page becomes a Markdown file in inputs/: headings kept, scripts and markup
// dropped, the source URL and fetch time written at the top so the evidence says where the rules came from.

import { stripHtml } from '../connectors/common.mjs';
import { assertPublicUrl, redirectMode } from '../core/netguard.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 400_000;
const TIMEOUT_MS = 15_000;
const MIN_TEXT = 1200; // a real policy page runs to paragraphs; less is usually a shell the browser fills in with JavaScript

export class PolicyUrlError extends Error {}

// Policy wording: obligations, windows, money, people. A real policy page uses several; a notice page almost none.
const POLICY_WORDS = /\b(?:return|refund|exchange|cancel|warrant|polic|terms?|privacy|personal data|shipping|delivery|charge|fee|days?|eligible|must|may not|cannot|customer|account|order|claim|liab)/gi;
// Counted in real sentences (six words or more), so a shop banner or a menu full of "Returns" links does not pass.
export const looksLikePolicy = text => String(text).split(/(?<=[.!?:;])\s+|\n+/)
  .filter(s => s.trim().split(/\s+/).length >= 6 && new RegExp(POLICY_WORDS.source, 'i').test(s)).length >= 5;

// The page's address as a file name: host and path, lowercase, e.g. linden-example-com-returns.md.
export function policyFileName(url) {
  const u = new URL(url);
  const slug = `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  return `${slug || 'policy'}.md`;
}

// HTML to Markdown-ish text: the main content when the page marks it, headings as "#" lines, the rest as text.
export function htmlToPolicyText(html) {
  let body = String(html ?? '');
  const title = stripHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? '').slice(0, 200);
  const main = /<main[\s\S]*?<\/main>/i.exec(body)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(body)?.[0];
  if (main && stripHtml(main).length >= MIN_TEXT) body = main;
  body = body
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (m, level, inner) => `\n${'#'.repeat(Number(level))} ${stripHtml(inner).replace(/\s+/g, ' ')}\n`);
  // Empty list items and lone bullets (menus, carousels rendered by JavaScript) say nothing: drop them.
  const text = stripHtml(body).split('\n').filter(l => !l.trim() || (!/^[-•*·|#]+$/.test(l.trim()) && !/\b(?:class|v-[a-z]+|data-[a-z-]+)=|^\d+'/.test(l))).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text: text.slice(0, MAX_TEXT) };
}

// Returns { name, text, title, url } or throws PolicyUrlError with a message a person can act on.
export async function fetchPolicyPage(raw, { fetchImpl = fetch, now = new Date() } = {}) {
  let url;
  try { url = new URL(String(raw ?? '').trim()); } catch { throw new PolicyUrlError('Paste the full address of the policy page, starting with https://.'); }
  if (url.protocol !== 'https:') throw new PolicyUrlError('Use an https:// address.');
  if (url.username || url.password) throw new PolicyUrlError('Use an address without a user name or password in it.');
  try { await assertPublicUrl(url.href); } catch (e) { throw new PolicyUrlError(e.message); }
  let res;
  try {
    res = await fetchImpl(url.href, { redirect: redirectMode(), signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'text/html,text/plain;q=0.9', 'user-agent': 'Grapim policy import (+https://grapim.com)' } });
  } catch (e) {
    throw new PolicyUrlError(e?.name === 'TimeoutError' ? 'The page took too long to answer.' : 'The page could not be reached.');
  }
  if (!res.ok) throw new PolicyUrlError(`The page answered ${res.status}. Check the address, or save the policy as a file and upload it.`);
  const type = String(res.headers.get('content-type') ?? '');
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new PolicyUrlError('That address is not a web page. For a PDF or Word file, save the text and upload it.');
  const reader = res.body?.getReader?.();
  const chunks = []; let size = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new PolicyUrlError('That page is larger than 2 MB.'); }
      chunks.push(value);
    }
  }
  const raw2 = reader ? Buffer.concat(chunks).toString('utf8') : await res.text();
  const { title, text } = /text\/plain/i.test(type) ? { title: '', text: raw2.slice(0, MAX_TEXT) } : htmlToPolicyText(raw2);
  if (text.replace(/\s+/g, ' ').length < MIN_TEXT) throw new PolicyUrlError('That page has almost no text; it may load its content with JavaScript. Save the policy as a file and upload it instead.');
  // A page can answer 200 with a maintenance notice, a country picker or a bot check instead of the policy.
  if (!looksLikePolicy(text)) throw new PolicyUrlError('That page does not read like a policy (the site may have shown a maintenance, country or bot-check page to our server). Open it in your browser, save the policy text as a file and upload it.');
  const head = `# ${title || url.hostname}\n\nSource: ${url.href}\nFetched: ${now.toISOString()}\n\n`;
  return { name: policyFileName(url.href), text: head + text + '\n', title, url: url.href };
}
