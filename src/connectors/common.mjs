// Shared pieces of the help-desk connectors: a JSON request with a timeout, a poll loop with a
// deadline, and HTML-to-text for replies that come back as markup.

const REQUEST_TIMEOUT_MS = 30_000;

export class ConnectorError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function requestJson(url, { label, method = 'GET', headers = {}, body, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const res = await fetch(url, {
    method,
    headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, REQUEST_TIMEOUT_MS))),
  });
  const text = await res.text();
  if (!res.ok) throw new ConnectorError(`${label} ${method} ${new URL(url).pathname} returned HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ConnectorError(`${label} returned a response that is not JSON: ${text.slice(0, 200)}`, res.status);
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Calls check() every pollMs until it returns a value other than null, or throws after timeoutMs.
export async function pollUntil(check, { pollMs, timeoutMs, what }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check(deadline - Date.now());
    if (value != null) return value;
    if (Date.now() + pollMs > deadline) throw new ConnectorError(`${what} did not reply within ${Math.round(timeoutMs / 1000)} s`);
    await sleep(pollMs);
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function stripHtml(html) {
  return String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .split('\n').map(line => line.replace(/[ \t ]+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
