// Harvest: turns one consented deployment into de-identified library entries: its test cases (cases.csv and the
// latest policy check's test messages), an integration template and its recurring failure patterns. Re-harvesting a deployment replaces its
// earlier entries, and every harvest (or refusal) is written to the deployment's audit log.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appendAudit } from '../core/audit.mjs';
import { paths } from '../deployment.mjs';
import { scrub, addFound } from './scrub.mjs';
import { replaceSource, checkLibraryDir } from './store.mjs';
import { readRawConfig, checkConsent, privacyOptions, sourceHash, industryOf, sourceSystems, readCaseRows, readScanRows, caseKey } from './deployment.mjs';

const SCHEMA = 1;
const splitList = v => String(v ?? '').split('|').map(x => x.trim()).filter(Boolean);

function entryId(source, kind, body) {
  return crypto.createHash('sha256').update(JSON.stringify([source, kind, body])).digest('hex').slice(0, 16);
}

// Scrubs strings through one shared counter.
function scrubber(privacy, found) {
  return text => {
    const r = scrub(text, privacy);
    addFound(found, r.found);
    return r.text;
  };
}

// A regex that needed scrubbing is dropped rather than kept with placeholders: "[PHONE]" inside a regex
// is a character class, so it would silently test something else. Rows left without any check are
// dropped too, because the shared "cases" applier rejects them.
function caseEntries(rows, clean) {
  const compiles = re => { try { new RegExp(re, 'i'); return true; } catch { return false; } };
  return rows.map(r => {
    const regex = clean(r.regex) === r.regex && compiles(r.regex) ? r.regex : '';
    return {
      input: clean(r.input),
      expected: clean(r.expected),
      must_include: splitList(r.must_include).map(clean).join('|'),
      must_not_include: splitList(r.must_not_include).map(clean).join('|'),
      regex,
      tags: splitList(r.tags).map(t => clean(t).toLowerCase()),
    };
  }).filter(e => e.input.trim() && [e.expected, e.must_include, e.must_not_include, e.regex].some(v => v.trim()));
}

// cases.csv rows first, then the policy check's messages it does not already have.
function withScanRows(rows, scanRows) {
  const seen = new Set(rows.map(r => caseKey(r.input)));
  return [...rows, ...scanRows.filter(r => !seen.has(caseKey(r.input)) && seen.add(caseKey(r.input)))];
}

// The customer's target with every header value and the URL host replaced, so the shape of the
// integration (method, body template, output path, header names) can be reused without the secrets.
function templateValue(value, clean) {
  if (typeof value === 'string') return clean(value);
  if (Array.isArray(value)) return value.map(v => templateValue(v, clean));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, templateValue(v, clean)]));
  return value;
}

function templateUrl(raw, clean) {
  let u;
  try { u = new URL(raw); } catch { return '[URL]'; }
  const query = u.search || u.hash ? '?[QUERY]' : '';
  let pathname = u.pathname;
  try { pathname = decodeURIComponent(pathname); } catch { /* keep the encoded path */ }
  return `${u.protocol}//[HOST]${clean(pathname)}${query}`;
}

function integrationEntry(target, clean) {
  if (!target || typeof target !== 'object') return null;
  const { headers, url, ...rest } = target;
  const template = templateValue(rest, clean);
  if (url !== undefined) template.url = templateUrl(String(url), clean);
  if (headers && typeof headers === 'object') template.headers = Object.fromEntries(Object.keys(headers).map(k => [clean(k), '[VALUE]']));
  const parts = [`${template.type ?? 'unknown'} integration`];
  if (template.type === 'http') parts.push(`method ${String(template.method ?? 'POST').toUpperCase()}`);
  if (template.body && typeof template.body === 'object') parts.push(`body fields ${Object.keys(template.body).join(', ')}`);
  if (template.output) parts.push(`output path ${template.output}`);
  if (template.headers) parts.push(`headers ${Object.keys(template.headers).join(', ')}`);
  return { summary: parts.join('; '), template, tags: [String(template.type ?? 'unknown')] };
}

// Failed checks across every run, normalized (de-identified, numbers collapsed) and grouped.
function failureEntries(dir, clean) {
  const runsDir = paths(dir).runs;
  if (!fs.existsSync(runsDir)) return [];
  const groups = new Map();
  for (const id of fs.readdirSync(runsDir).sort()) {
    const file = path.join(runsDir, id, 'results.json');
    if (!fs.existsSync(file)) continue;
    let results;
    try { results = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    for (const c of results.cases ?? []) {
      for (const check of c.checks ?? []) {
        if (check.status !== 'fail' || !check.reason) continue;
        const pattern = clean(check.reason).replace(/\b\d+\b/g, '#').replace(/\s+/g, ' ').trim();
        const key = `${check.type}\u0000${pattern.toLowerCase()}`;
        const g = groups.get(key) ?? { checkType: check.type, pattern, caseIds: new Set(), occurrences: 0, tags: new Set() };
        g.caseIds.add(c.id);
        g.occurrences++;
        for (const t of c.tags ?? []) g.tags.add(clean(t).toLowerCase());
        groups.set(key, g);
      }
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.caseIds.size - a.caseIds.size || a.pattern.localeCompare(b.pattern))
    .map(g => ({ checkType: g.checkType, pattern: g.pattern, cases: g.caseIds.size, occurrences: g.occurrences, tags: [...g.tags].sort() }));
}

// harvest(dir, { libraryDir, by?, env?, now? }) -> { source, added, removed, byKind, redactions }
export function harvest(dir, { libraryDir, by, env = process.env, now = new Date() } = {}) {
  const libDir = checkLibraryDir(libraryDir);
  const config = readRawConfig(dir);
  const actor = by ? `human:${by}` : 'system';
  let consent;
  try {
    consent = checkConsent(config, now);
  } catch (e) {
    appendAudit(dir, { actor, action: 'library.harvest.refused', target: libDir, detail: { reason: e.message } }, now);
    throw e;
  }
  const source = sourceHash(dir, config, env);
  const privacy = privacyOptions(config);
  const found = {};
  const clean = scrubber(privacy, found);

  const common = { sourceSystems: sourceSystems(dir, privacy), industry: industryOf(config), source, createdAt: now.toISOString() };
  const bodies = [
    ...caseEntries(withScanRows(readCaseRows(dir), readScanRows(dir)), clean).map(b => ['case', b]),
    ...[integrationEntry(config.target, clean)].filter(Boolean).map(b => ['integration', b]),
    ...failureEntries(dir, clean).map(b => ['failure', b]),
  ];
  const byId = new Map();
  for (const [kind, body] of bodies) {
    const id = entryId(source, kind, body);
    if (!byId.has(id)) byId.set(id, { schema: SCHEMA, id, kind, ...common, ...body });
  }
  const entries = [...byId.values()];
  const byKind = entries.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});

  const { added, removed } = replaceSource(libDir, source, entries, { now, detail: { byKind } });
  appendAudit(dir, {
    actor,
    action: 'library.harvest',
    target: source,
    detail: { library: libDir, added, removed, byKind, redactions: found, consentedBy: consent.consentedBy, consentedAt: consent.consentedAt },
  }, now);
  return { source, added, removed, byKind, redactions: found };
}
