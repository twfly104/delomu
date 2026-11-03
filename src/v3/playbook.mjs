// The playbook: an AI vendor's own knowledge library (src/v4), filled from the rollouts whose client agreed and
// used to start the next client's rollout. One library per paying org (a vendor and its client workspaces),
// kept beside its deployments, so nothing ever moves between vendors. Entries are de-identified by v4's scrub:
// no names, contact details, keys, hosts or order data. A client agrees on its sign-off page, or the vendor
// records an agreement made elsewhere; withdrawing removes that rollout's entries.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendAudit } from '../core/audit.mjs';
import { paths } from '../deployment.mjs';
import { harvest, suggest, search, forget, stats } from '../v4/library.mjs';
import { readRawConfig, sourceHash } from '../v4/deployment.mjs';

export const libraryDir = (root, ownerId) => path.join(root, ownerId, '.library');

// Each owner's salt comes from the server pepper, so source hashes differ between vendors and need no setting.
export const libraryEnv = (pepper, ownerId) => ({
  DELOMU_LIBRARY_SALT: crypto.createHmac('sha256', String(pepper)).update(`delomu-library\u0000${ownerId}`).digest('hex'),
});

// { by, at } when this rollout's client agreed to reuse, else null.
export function consentOf(dir) {
  try {
    const lib = readRawConfig(dir).library;
    return lib?.consent === true && lib.consentedBy && lib.consentedAt ? { by: lib.consentedBy, at: lib.consentedAt } : null;
  } catch { return null; }
}

// "Linden & Co." is also written "Linden", so a company name is removed with and without its legal suffix.
const SUFFIX = /[\s,]*(?:&\s*co\.?|and\s+co\.?|inc\.?|ltd\.?|llc|gmbh|plc|corp\.?|co\.)$/i;
const nameForms = n => [n, n.replace(SUFFIX, '').trim()].filter(x => x.length > 2);

// Removed on every harvest besides v4's built-in detectors: order and ticket ids such as L-1006 or ORD-20391,
// and the client's domains, which would name the client.
export const PLAYBOOK_PATTERNS = {
  ORDER: '\\b[A-Z]{1,5}-\\d{3,}\\b|#\\d{4,}\\b',
  DOMAIN: '\\b[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.(?:com|net|org|io|ai|co|us|uk|de|app|dev|shop|store|example)\\b',
};

// Records or withdraws the client's agreement in delomu.json, with the client's names to remove on harvest.
export function setConsent(dir, { consent, by, names = [], actor }, now = new Date()) {
  const raw = readRawConfig(dir);
  const lib = raw.library ?? {};
  const known = [...new Set([...(Array.isArray(lib.names) ? lib.names : []), ...names.flatMap(n => nameForms(String(n).trim()))])];
  lib.patterns = { ...PLAYBOOK_PATTERNS, ...(lib.patterns ?? {}) };
  // The org and deployment folder names identify this rollout in the library (salted), even when two clients
  // share a customer name.
  const sourceId = `${path.basename(path.dirname(path.resolve(dir)))}/${path.basename(path.resolve(dir))}`;
  raw.library = consent
    ? { ...lib, sourceId, consent: true, consentedBy: String(by).trim().slice(0, 160), consentedAt: now.toISOString().slice(0, 10), names: known }
    : { ...lib, sourceId, consent: false, names: known };
  fs.writeFileSync(paths(dir).config, JSON.stringify(raw, null, 2) + '\n');
  appendAudit(dir, { actor, action: consent ? 'library.consent' : 'library.consent.withdrawn', target: 'playbook', detail: consent ? { by: raw.library.consentedBy } : {} }, now);
  return consent ? consentOf(dir) : null;
}

// Adds (or refreshes) this rollout's de-identified entries. Refused without consent.
export function addToPlaybook({ root, pepper, ownerId, dir, by, now = new Date() }) {
  return harvest(dir, { libraryDir: libraryDir(root, ownerId), by, env: libraryEnv(pepper, ownerId), now });
}

// Removes every entry this rollout added. Returns { removed }.
export function removeFromPlaybook({ root, pepper, ownerId, dir, now = new Date() }) {
  const lib = libraryDir(root, ownerId);
  if (!fs.existsSync(lib)) return { removed: 0 };
  return forget(lib, sourceHash(dir, readRawConfig(dir), libraryEnv(pepper, ownerId)), { now });
}

// { entries, sources, byKind, lastHarvestAt } or null when the owner has no library yet.
export function playbookStats(root, ownerId) {
  const lib = libraryDir(root, ownerId);
  if (!fs.existsSync(path.join(lib, 'entries.jsonl'))) return null;
  const s = stats(lib);
  return s.entries ? s : null;
}

// Whether this rollout's own entries are in the library (it contributed), without reading its client data.
export function contributed(root, pepper, ownerId, dir) {
  const s = playbookStats(root, ownerId);
  if (!s) return false;
  try {
    const source = sourceHash(dir, readRawConfig(dir), libraryEnv(pepper, ownerId));
    return fs.readFileSync(path.join(libraryDir(root, ownerId), 'entries.jsonl'), 'utf8').includes(`"source":"${source}"`);
  } catch { return false; }
}

// Test messages from the owner's other rollouts that this one lacks, as a pending "cases" draft, or null.
export function suggestFromPlaybook({ root, pepper, ownerId, dir, limit = 15, now = new Date() }) {
  if (!playbookStats(root, ownerId)) return null;
  return suggest(dir, { libraryDir: libraryDir(root, ownerId), limit, env: libraryEnv(pepper, ownerId), now });
}

// Up to two integration shapes from the owner's other rollouts that best match this client's material.
export function integrationExamples({ root, pepper, ownerId, dir }) {
  if (!playbookStats(root, ownerId)) return [];
  let own = null;
  try { own = sourceHash(dir, readRawConfig(dir), libraryEnv(pepper, ownerId)); } catch { /* not configured yet */ }
  const inputs = path.join(dir, 'inputs');
  const text = fs.existsSync(inputs)
    ? fs.readdirSync(inputs).filter(f => !f.toLowerCase().endsWith('.csv')).map(f => { try { return fs.readFileSync(path.join(inputs, f), 'utf8'); } catch { return ''; } }).join(' ').slice(0, 20_000)
    : '';
  const query = `${text} http integration body output`.trim();
  return search(libraryDir(root, ownerId), query, { kind: 'integration', limit: 3 }).filter(e => e.source !== own).slice(0, 2).map(e => e.template);
}
