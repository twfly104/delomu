// Sandboxed, audited reader for the customer material in <deployment>/inputs/.
// The agent can only see files that resolve (after following symlinks) inside inputs/, of an allowed
// text type, within a per-file and a total size budget. Every read and every refused read is written
// to the audit log, so a reviewer can see exactly what the agent looked at.

import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';

export const ALLOWED_EXTENSIONS = ['.md', '.txt', '.csv', '.json', '.yaml', '.yml', '.html'];
export const DEFAULT_LIMITS = { maxFileBytes: 256 * 1024, maxTotalBytes: 1024 * 1024 };
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

// Turns HTML into readable text: drops script/style/comments, keeps block breaks, decodes common entities.
export function stripHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#39|[a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const isInside = (root, p) => {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// Cuts truncated CSV after the last complete record: the last line break outside a quoted field,
// so a multi-line ticket message is never left with an open quote (which would make it unparseable).
function cutAtRecord(text) {
  let quoted = false;
  let end = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === '\n' && !quoted) end = i;
  }
  return end === -1 ? text : text.slice(0, end + 1);
}

// Reads the first `limit` bytes of a file without loading the rest into memory.
function readHead(file, limit) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(limit);
    const n = fs.readSync(fd, buf, 0, limit, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

export function createInputReader(dir, { maxFileBytes = DEFAULT_LIMITS.maxFileBytes, maxTotalBytes = DEFAULT_LIMITS.maxTotalBytes, actor = 'agent' } = {}) {
  if (!(maxFileBytes > 0) || !(maxTotalBytes > 0)) throw new Error('reader size limits must be positive numbers');
  const root = path.join(dir, 'inputs');
  const realRoot = fs.existsSync(root) ? fs.realpathSync(root) : null;
  let used = 0;

  const deny = (rel, reason) => {
    appendAudit(dir, { actor, action: 'input.denied', target: String(rel), detail: { reason } });
    return new Error(`cannot read "${rel}": ${reason}`);
  };

  // Resolves a path relative to inputs/ and returns its real location, or throws (and audits) why not.
  function resolve(rel) {
    if (typeof rel !== 'string' || rel.trim() === '' || rel.includes('\0')) throw deny(rel, 'invalid path');
    if (!realRoot) throw deny(rel, 'the deployment has no inputs/ folder');
    if (path.isAbsolute(rel) || path.win32.isAbsolute(rel)) throw deny(rel, 'absolute paths are not allowed');
    const full = path.resolve(realRoot, rel);
    if (!isInside(realRoot, full)) throw deny(rel, 'path leaves inputs/');
    if (!fs.existsSync(full)) throw deny(rel, 'no such file');
    const real = fs.realpathSync(full);
    if (!isInside(realRoot, real)) throw deny(rel, 'symlink points outside inputs/');
    if (!fs.statSync(real).isFile()) throw deny(rel, 'not a regular file');
    if (!ALLOWED_EXTENSIONS.includes(path.extname(real).toLowerCase())) {
      throw deny(rel, `file type not allowed (allowed: ${ALLOWED_EXTENSIONS.join(' ')})`);
    }
    return real;
  }

  // Every readable file under inputs/, as forward-slash paths relative to it, sorted.
  // Symlinked directories are not descended into; symlinked files are listed only if they stay inside.
  function list() {
    if (!realRoot) return [];
    const out = [];
    const walk = sub => {
      for (const e of fs.readdirSync(path.join(realRoot, sub), { withFileTypes: true })) {
        const rel = sub ? `${sub}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(rel); continue; }
        if (!e.isFile() && !e.isSymbolicLink()) continue;
        if (!ALLOWED_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) continue;
        let real;
        try { real = fs.realpathSync(path.join(realRoot, rel)); } catch { continue; } // broken symlink
        if (isInside(realRoot, real) && fs.statSync(real).isFile()) out.push(rel);
      }
    };
    walk('');
    return out.sort();
  }

  // Returns { path, text, bytes, truncated, note }. HTML is reduced to text; CSV is cut at a line end.
  function read(rel) {
    const real = resolve(rel);
    const size = fs.statSync(real).size;
    const remaining = maxTotalBytes - used;
    if (remaining <= 0) throw deny(rel, `total read budget of ${maxTotalBytes} bytes is used up`);

    const ext = path.extname(real).toLowerCase();
    let text = readHead(real, Math.min(size, maxFileBytes)).toString('utf8').replace(/^﻿/, '');
    if (ext === '.html') text = stripHtml(text);
    let truncated = size > maxFileBytes;
    if (Buffer.byteLength(text) > remaining) {
      text = Buffer.from(text).subarray(0, remaining).toString('utf8');
      truncated = true;
    }
    if (truncated && ext === '.csv') text = cutAtRecord(text);
    const bytes = Buffer.byteLength(text);
    used += bytes;

    const note = truncated ? `[delomu: ${rel} was truncated; showing ${bytes} of ${size} bytes]` : '';
    appendAudit(dir, { actor, action: 'input.read', target: rel, detail: { bytes, size, truncated } });
    return { path: rel, text, bytes, truncated, note };
  }

  return { root, list, read, used: () => used };
}
