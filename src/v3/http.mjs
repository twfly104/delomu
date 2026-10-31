// HTTP plumbing shared by the JSON API and the web UI: the one error shape, body reading with a size
// limit, cookies, a tiny path router and cursor pagination. No framework, only node:http primitives.

export const ERROR_STATUS = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  conflict_error: 409,
  idempotency_error: 409,
  rate_limit_error: 429,
  api_error: 500,
};

// Thrown anywhere in a handler; becomes { error: { type, message, code?, param? } } with the matching status.
export class ApiError extends Error {
  constructor(type, message, { status, code, param, headers } = {}) {
    super(message);
    if (!(type in ERROR_STATUS)) throw new Error(`unknown error type ${type}`);
    this.type = type;
    this.status = status ?? ERROR_STATUS[type];
    this.code = code;
    this.param = param;
    this.headers = headers;
  }

  toJSON() {
    const error = { type: this.type, message: this.message };
    if (this.code) error.code = this.code;
    if (this.param) error.param = this.param;
    return { error };
  }
}

export const invalid = (message, param) => new ApiError('invalid_request_error', message, { param });
export const notFound = (what = 'resource') => new ApiError('not_found_error', `No such ${what}.`, { code: 'resource_missing' });
export const forbidden = message => new ApiError('permission_error', message);

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cache-control': 'no-store',
};

export function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

export function sendJson(res, status, value, headers = {}) {
  send(res, status, JSON.stringify(value) + '\n', { 'content-type': 'application/json; charset=utf-8', ...headers });
}

export function sendError(res, err) {
  sendJson(res, err.status, err.toJSON(), err.headers);
}

// Reads the whole body as a string; rejects with 413 past `limit` bytes without buffering the rest.
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) { req.resume(); reject(tooLarge(limit)); return; }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { req.removeAllListeners('data'); req.resume(); reject(tooLarge(limit)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const tooLarge = limit => new ApiError('invalid_request_error', `Request body is larger than ${limit} bytes.`, { status: 413, code: 'body_too_large' });

export async function readJson(req, limit) {
  const text = await readBody(req, limit);
  if (!text.trim()) return { text, body: {} };
  const type = String(req.headers['content-type'] ?? '');
  if (!type.startsWith('application/json')) throw invalid('Send the request body as application/json.');
  let body;
  try { body = JSON.parse(text); } catch { throw invalid('Request body is not valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Request body must be a JSON object.');
  return { text, body };
}

export async function readForm(req, limit) {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.startsWith('application/x-www-form-urlencoded')) throw invalid('Expected a form submission.');
  return Object.fromEntries(new URLSearchParams(await readBody(req, limit)));
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed cookie */ }
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Routes look like "GET /v1/orgs/:org/members". Params are URL-decoded strings; validation is the handler's job.
export function createRouter() {
  const routes = [];
  return {
    add(method, pattern, handler, options = {}) {
      const names = [];
      const source = pattern.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; });
      routes.push({ method, re: new RegExp(`^${source}$`), names, handler, options });
    },
    // Returns { handler, params, options } or { allowed: [...] } when the path exists for other methods, or null.
    match(method, pathname) {
      const allowed = [];
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        if (r.method !== method) { allowed.push(r.method); continue; }
        let params;
        try {
          params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
        } catch {
          throw invalid('Malformed URL encoding in path.');
        }
        return { handler: r.handler, params, options: r.options };
      }
      return allowed.length ? { allowed } : null;
    },
  };
}

export const MAX_PAGE = 100;

export function pageLimit(searchParams, fallback = 20) {
  const raw = searchParams.get('limit');
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE) throw invalid(`limit must be an integer from 1 to ${MAX_PAGE}.`, 'limit');
  return n;
}

export const encodeCursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export function decodeCursor(cursor) {
  try { return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw invalid('Invalid cursor.', 'cursor'); }
}

// Cursor pagination over an already-ordered array, keyed by a unique field (Stripe-style list object).
export function paginate(items, searchParams, key = 'id') {
  const limit = pageLimit(searchParams);
  const cursor = searchParams.get('cursor');
  let start = 0;
  if (cursor) {
    const after = decodeCursor(cursor);
    const i = items.findIndex(x => x[key] === after);
    if (i === -1) throw invalid('Cursor does not match any item in this list.', 'cursor');
    start = i + 1;
  }
  const data = items.slice(start, start + limit);
  const hasMore = start + limit < items.length;
  return listObject(data, hasMore, hasMore ? encodeCursor(data.at(-1)[key]) : null);
}

export const listObject = (data, hasMore, nextCursor) => ({ object: 'list', data, has_more: hasMore, next_cursor: nextCursor });
