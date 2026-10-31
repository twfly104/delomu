// What the knowledge library needs to know about one deployment folder: its raw delomu.json (the
// "library" and "industry" settings that v0's loadConfig does not keep), the customer's consent,
// the de-identification options, the salted source hash, its systems and its existing cases.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from '../deployment.mjs';
import { parseCsv } from '../csv.mjs';
import { buildTestSet } from '../testset.mjs';
import { compilePatterns, scrub } from './scrub.mjs';

const MIN_SALT_LENGTH = 16;
const CASE_FIELDS = ['input', 'expected', 'must_include', 'must_not_include', 'regex', 'tags'];

export function readRawConfig(dir) {
  const file = paths(dir).config;
  if (!fs.existsSync(file)) throw new Error(`no delomu.json in ${dir}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
}

// Throws a message that says exactly what is missing unless the customer agreed to library use.
export function checkConsent(config, now = new Date()) {
  const lib = config.library ?? {};
  const problems = [];
  if (lib.consent !== true) problems.push('"library.consent" is not true');
  if (typeof lib.consentedBy !== 'string' || !lib.consentedBy.trim()) problems.push('"library.consentedBy" is missing');
  const at = lib.consentedAt;
  const date = typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at) ? new Date(`${at}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== at) problems.push('"library.consentedAt" is not a YYYY-MM-DD date');
  // The date is written in the signer's local calendar; the earliest time zone (UTC+14) can be a day ahead of UTC.
  else if (at > new Date(now.getTime() + 14 * 3600_000).toISOString().slice(0, 10)) problems.push('"library.consentedAt" is in the future');
  if (problems.length) {
    throw new Error(`harvest refused: no recorded customer consent for the knowledge library (${problems.join('; ')}). ` +
      'Once the customer has agreed in writing, add to delomu.json: "library": { "consent": true, "consentedBy": "<who agreed>", "consentedAt": "YYYY-MM-DD" }');
  }
  return { consentedBy: lib.consentedBy.trim(), consentedAt: at };
}

// De-identification options for this deployment: library.names plus the customer name, and library.patterns.
export function privacyOptions(config) {
  const names = config.library?.names ?? [];
  if (!Array.isArray(names) || names.some(n => typeof n !== 'string')) throw new Error('"library.names" must be an array of strings');
  return {
    names: [...names, ...(typeof config.customer === 'string' ? [config.customer] : [])],
    patterns: compilePatterns(config.library?.patterns ?? {}),
  };
}

// A salted HMAC of the deployment identity, so the library can group and delete a deployment's
// entries without ever holding the customer's name.
export function sourceHash(dir, config, env = process.env) {
  const salt = env.DELOMU_LIBRARY_SALT;
  if (!salt) throw new Error('DELOMU_LIBRARY_SALT is not set; set it to a long random secret shared by everyone who writes to this library');
  if (salt.length < MIN_SALT_LENGTH) throw new Error(`DELOMU_LIBRARY_SALT must be at least ${MIN_SALT_LENGTH} characters`);
  const identity = `${config.customer ?? path.basename(path.resolve(dir))}\u0000${config.name ?? 'deployment'}`;
  return crypto.createHmac('sha256', salt).update(identity).digest('hex').slice(0, 32);
}

export const industryOf = config => (typeof config.industry === 'string' && config.industry.trim() ? config.industry.trim().toLowerCase() : null);

// System names from mapping.json (v1), de-identified and lower-cased.
export function sourceSystems(dir, privacy) {
  const file = path.join(dir, 'mapping.json');
  if (!fs.existsSync(file)) return [];
  let mapping;
  try { mapping = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
  const names = (mapping.systems ?? []).map(s => scrub(s?.name ?? '', privacy).text.trim().toLowerCase()).filter(Boolean);
  return [...new Set(names)];
}

export function readMapping(dir) {
  const file = path.join(dir, 'mapping.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// The valid rows of cases.csv (the same rows "delomu tests" turns into tests), as raw column values.
export function readCaseRows(dir) {
  const file = paths(dir).cases;
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const valid = new Set(buildTestSet(text).tests.map(t => t.id));
  const seen = new Set();
  return parseCsv(text).map((r, i) => ({ ...r, id: r.id || `case-${i + 1}` }))
    .filter(r => valid.has(r.id) && !seen.has(r.id) && seen.add(r.id))
    .map(r => Object.fromEntries([['id', r.id], ...CASE_FIELDS.map(f => [f, r[f] ?? ''])]));
}

// Normalized form used to recognise the same case across deployments.
export const caseKey = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}[\]]+/gu, ' ').trim();
