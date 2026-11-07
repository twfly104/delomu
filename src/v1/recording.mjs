// A recorded browser session (HAR, from Chrome or Firefox DevTools: Network > Save all as HAR) as material for the
// client-system connector (src/v1/connector.mjs). An engineer does the task once in the client's system (look up
// an order, cancel it) and uploads the recording; Grapim keeps only the shape of the API calls: method, path with
// ids replaced by placeholders, query parameter names, body and response field names with their JSON types, the
// status codes, and which kind of auth was used. Every value is dropped: headers, cookies, tokens, query values,
// bodies. The raw file is never stored; the summary is written to recording/api-calls.md in the deployment.

import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';

export const RECORDING_DIR = 'recording';
export const RECORDING_FILE = 'api-calls.md';
const MAX_ENDPOINTS = 60;
const MAX_FIELDS = 40;
const STATIC = /\.(js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp4|webm|mp3|wav)$/i;
const NOISE = /(google-analytics|googletagmanager|doubleclick|segment\.io|sentry\.io|hotjar|intercomcdn|fullstory|mixpanel|amplitude|datadoghq|newrelic|clarity\.ms|facebook\.net)/i;
const AUTH_HEADER = /^(x-)?(api[-_]?key|auth[-_]?token|access[-_]?token|token|x-csrf-token|x-xsrf-token)$/i;

// A path or key segment that is a value rather than a name: numbers, UUIDs, long ids, emails, dates.
const isValue = s => /^\d+$/.test(s)
  || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  || /^[0-9a-f]{12,}$/i.test(s)
  || (s.length >= 12 && /\d/.test(s) && /^[A-Za-z0-9_-]+$/.test(s))
  || /@/.test(s)
  || /^\d{4}-\d{2}-\d{2}/.test(s);

export function templatePath(pathname) {
  return pathname.split('/').map(seg => {
    let s = seg;
    try { s = decodeURIComponent(seg); } catch { /* keep as is */ }
    return seg && isValue(s) ? '{id}' : seg;
  }).join('/') || '/';
}

const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? 'number' : typeof v);

// "items[].sku (string)" style field list; keys that look like values become {key}. Never returns values.
export function fieldShape(value, prefix = '', out = new Map(), depth = 0) {
  if (out.size >= MAX_FIELDS || depth > 3) return out;
  if (Array.isArray(value)) {
    const first = value.find(v => v !== null && v !== undefined);
    if (first !== undefined && typeof first === 'object') fieldShape(first, `${prefix}[]`, out, depth + 1);
    else if (prefix) out.set(`${prefix}[]`, typeOf(first ?? null));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (out.size >= MAX_FIELDS) break;
      const key = isValue(k) ? '{key}' : k.replace(/[^\w.$-]/g, '_').slice(0, 60);
      const name = prefix ? `${prefix}.${key}` : key;
      if (v && typeof v === 'object') {
        if (!out.has(name)) out.set(name, typeOf(v));
        fieldShape(v, name, out, depth + 1);
      } else if (!out.has(name)) out.set(name, typeOf(v));
    }
  }
  return out;
}

const parseJson = text => { try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; } };

function bodyText(content) {
  if (!content?.text) return '';
  if (content.encoding === 'base64') { try { return Buffer.from(content.text, 'base64').toString('utf8'); } catch { return ''; } }
  return content.text;
}

function authKind(headers = []) {
  const kinds = new Set();
  for (const h of headers) {
    const name = String(h.name ?? '').toLowerCase();
    if (name === 'authorization') kinds.add(/^\s*bearer\b/i.test(h.value ?? '') ? 'Bearer token in the Authorization header' : /^\s*basic\b/i.test(h.value ?? '') ? 'Basic auth in the Authorization header' : 'a custom Authorization header');
    else if (name === 'cookie') kinds.add('a browser session cookie');
    else if (AUTH_HEADER.test(name)) kinds.add(`the ${h.name} header`);
  }
  return kinds;
}

// Turns HAR JSON text into { ok, md, endpoints, calls } or { ok: false, reason }.
export function summarizeHar(text, { now = new Date() } = {}) {
  const parsed = parseJson(text);
  const entries = parsed.ok ? parsed.value?.log?.entries : null;
  if (!Array.isArray(entries)) return { ok: false, reason: 'this is not a HAR file. In Chrome: DevTools > Network > right-click > Save all as HAR' };
  const endpoints = new Map();
  const auth = new Set();
  let calls = 0;
  for (const e of entries) {
    const req = e?.request;
    let url;
    try { url = new URL(req?.url); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || STATIC.test(url.pathname) || NOISE.test(url.hostname)) continue;
    const method = String(req.method ?? 'GET').toUpperCase();
    const mime = String(e.response?.content?.mimeType ?? '');
    const kind = String(e._resourceType ?? '');
    const isApi = /json/i.test(mime) || ['xhr', 'fetch'].includes(kind) || (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS');
    if (!isApi || method === 'OPTIONS') continue;
    calls++;
    for (const k of authKind(req.headers)) auth.add(k);
    const key = `${method} ${url.origin}${templatePath(url.pathname)}`;
    let ep = endpoints.get(key);
    if (!ep) {
      if (endpoints.size >= MAX_ENDPOINTS) continue;
      ep = { method, origin: url.origin, path: templatePath(url.pathname), count: 0, statuses: new Set(), query: new Set(), body: new Map(), bodyKind: '', response: new Map() };
      endpoints.set(key, ep);
    }
    ep.count++;
    if (e.response?.status) ep.statuses.add(e.response.status);
    for (const name of url.searchParams.keys()) if (!isValue(name)) ep.query.add(name);
    const post = req.postData;
    if (post) {
      const ptext = post.text ?? '';
      const pj = parseJson(ptext);
      if (pj.ok) { ep.bodyKind = 'JSON'; fieldShape(pj.value, '', ep.body); }
      else if (/urlencoded/i.test(post.mimeType ?? '') || Array.isArray(post.params)) {
        ep.bodyKind = 'form';
        const names = Array.isArray(post.params) && post.params.length ? post.params.map(p => p.name) : [...new URLSearchParams(ptext).keys()];
        for (const n of names) if (n && !isValue(n)) ep.body.set(n, 'string');
      } else if (ptext) ep.bodyKind ||= 'not JSON (left out)';
    }
    const rj = parseJson(bodyText(e.response?.content));
    if (rj.ok) fieldShape(rj.value, '', ep.response);
  }
  if (!endpoints.size) return { ok: false, reason: 'the recording has no API calls. Record while doing the task (look up an order, cancel it), with the Network tab open from the start' };
  const list = [...endpoints.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
  const fields = m => [...m].map(([k, t]) => `${k} (${t})`).join(', ');
  const md = [
    '# API calls recorded in the client’s system',
    '',
    `Recorded ${now.toISOString().slice(0, 10)} from a browser session (HAR): ${calls} call${calls === 1 ? '' : 's'} to ${list.length} endpoint${list.length === 1 ? '' : 's'}. Grapim kept only methods, paths and field names; every value, header, cookie and token was dropped. Ids in paths are shown as {id}.`,
    '',
    `Auth seen: ${auth.size ? [...auth].join('; ') : 'none'}.`,
    '',
    ...list.flatMap(ep => [
      `## ${ep.method} ${ep.path}`,
      `Base URL: ${ep.origin} · seen ${ep.count} time${ep.count === 1 ? '' : 's'} · status ${[...ep.statuses].sort().join(', ') || 'unknown'}`,
      ep.query.size ? `Query parameters: ${[...ep.query].join(', ')}` : '',
      ep.bodyKind ? `Request body (${ep.bodyKind}): ${fields(ep.body) || '(no fields)'}` : '',
      ep.response.size ? `Response fields: ${fields(ep.response)}` : '',
      '',
    ].filter((l, i, a) => l || a[i - 1] !== '')),
  ].join('\n');
  return { ok: true, md, endpoints: list.length, calls };
}

export function saveRecording(dir, summary, { actor = 'human', now = new Date() } = {}) {
  const folder = path.join(dir, RECORDING_DIR);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, RECORDING_FILE), summary.md);
  appendAudit(dir, { actor, action: 'recording.add', target: RECORDING_FILE, detail: { endpoints: summary.endpoints, calls: summary.calls } }, now);
}

// { path, text, endpoints, at } for the saved summary, or null.
export function readRecording(dir) {
  const file = path.join(dir, RECORDING_DIR, RECORDING_FILE);
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  return { path: `${RECORDING_DIR}/${RECORDING_FILE}`, text, endpoints: (text.match(/^## /gm) ?? []).length, at: fs.statSync(file).mtime.toISOString() };
}

export function removeRecording(dir, { actor = 'human', now = new Date() } = {}) {
  fs.rmSync(path.join(dir, RECORDING_DIR), { recursive: true, force: true });
  appendAudit(dir, { actor, action: 'recording.remove', target: RECORDING_FILE }, now);
}
