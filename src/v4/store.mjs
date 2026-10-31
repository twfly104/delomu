// Storage for the deployment knowledge library: <libraryDir>/entries.jsonl, one de-identified entry per
// line, plus the library's own hash-chained audit.jsonl (harvests and deletions, by source hash only).
// Writes take a lock file and replace entries.jsonl atomically, so a crash never leaves half a library.
//
// Entry: { schema, id, kind: case|integration|failure, ...text fields, tags, sourceSystems, industry,
//          source, createdAt }

import fs from 'node:fs';
import path from 'node:path';
import { appendAudit } from '../core/audit.mjs';

export const KINDS = ['case', 'integration', 'failure'];
export const SOURCE_RE = /^[a-f0-9]{32}$/;
const STALE_LOCK_MS = 10 * 60 * 1000;

const entriesFile = libraryDir => path.join(libraryDir, 'entries.jsonl');

export function checkLibraryDir(libraryDir) {
  if (typeof libraryDir !== 'string' || !libraryDir.trim()) throw new Error('libraryDir is required (--library DIR)');
  return path.resolve(libraryDir);
}

// The searchable text of an entry, by kind.
export function entryText(e) {
  const parts = {
    case: [e.input, e.expected, e.must_include, e.must_not_include],
    integration: [e.summary],
    failure: [e.checkType, e.pattern],
  }[e.kind] ?? [];
  return [...parts, ...(e.tags ?? []), ...(e.sourceSystems ?? []), e.industry].filter(Boolean).join(' ');
}

export function readEntries(libraryDir) {
  const file = entriesFile(checkLibraryDir(libraryDir));
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch { throw new Error(`${file} line ${i + 1} is not valid JSON`); }
  });
}

function withLock(libraryDir, fn) {
  fs.mkdirSync(libraryDir, { recursive: true });
  const lock = path.join(libraryDir, '.lock');
  try {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (Date.now() - fs.statSync(lock).mtimeMs < STALE_LOCK_MS) throw new Error(`library ${libraryDir} is locked by another process; try again shortly`);
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  }
  try { return fn(); } finally { fs.rmSync(lock, { force: true }); }
}

function writeEntries(libraryDir, entries) {
  const file = entriesFile(libraryDir);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

// Replaces every entry from `source` with `entries`. Returns { added, removed }.
export function replaceSource(libraryDir, source, entries, { now = new Date(), detail = {} } = {}) {
  const dir = checkLibraryDir(libraryDir);
  if (!SOURCE_RE.test(source)) throw new Error('invalid source hash');
  return withLock(dir, () => {
    const all = readEntries(dir);
    const kept = all.filter(e => e.source !== source);
    const removed = all.length - kept.length;
    writeEntries(dir, [...kept, ...entries]);
    appendAudit(dir, { actor: 'system', action: 'library.harvest', target: source, detail: { added: entries.length, removed, ...detail } }, now);
    return { added: entries.length, removed };
  });
}

// Deletes every entry from one deployment (a customer's deletion request). Returns { removed }.
export function forget(libraryDir, sourceHash, { now = new Date() } = {}) {
  const dir = checkLibraryDir(libraryDir);
  if (!SOURCE_RE.test(String(sourceHash ?? ''))) throw new Error('source hash must be 32 lowercase hex characters (printed by "library harvest")');
  if (!fs.existsSync(entriesFile(dir))) return { removed: 0 };
  return withLock(dir, () => {
    const all = readEntries(dir);
    const kept = all.filter(e => e.source !== sourceHash);
    const removed = all.length - kept.length;
    writeEntries(dir, kept);
    appendAudit(dir, { actor: 'system', action: 'library.forget', target: sourceHash, detail: { removed } }, now);
    return { removed };
  });
}

export function stats(libraryDir) {
  const entries = readEntries(libraryDir);
  const count = key => entries.reduce((acc, e) => {
    const v = e[key] ?? '(none)';
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
  return {
    entries: entries.length,
    sources: new Set(entries.map(e => e.source)).size,
    byKind: Object.fromEntries(KINDS.map(k => [k, entries.filter(e => e.kind === k).length])),
    byIndustry: count('industry'),
    lastHarvestAt: entries.map(e => e.createdAt).sort().at(-1) ?? null,
  };
}
