// Suggest: picks library test cases relevant to a deployment that it does not have yet, and proposes
// them as a pending "cases" draft (step 3) with the reason for every pick. It never writes cases.csv:
// an engineer approves, edits or rejects the draft through the shared review flow.

import fs from 'node:fs';
import path from 'node:path';
import { createDraft, listDrafts } from '../core/drafts.mjs';
import { scrub } from './scrub.mjs';
import { rank } from './bm25.mjs';
import { readEntries, checkLibraryDir, entryText } from './store.mjs';
import { readRawConfig, privacyOptions, sourceHash, industryOf, sourceSystems, readCaseRows, readMapping, caseKey } from './deployment.mjs';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const INPUT_QUERY_CHARS = 20_000;
const LIBRARY_TAG = 'from-library';

export function checkLimit(limit, fallback = DEFAULT_LIMIT) {
  if (limit === undefined) return fallback;
  const n = Number(limit);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw new Error(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
  return n;
}

// The query describing this deployment: its cases and tags, its mapping, its industry; when it has
// none of those yet, the text of its inputs/ folder.
function deploymentQuery(dir, rows, config) {
  const parts = rows.flatMap(r => [r.input, r.expected, r.tags.replace(/\|/g, ' ')]);
  const mapping = readMapping(dir);
  for (const s of mapping?.systems ?? []) parts.push(s.name, s.purpose);
  for (const e of mapping?.entities ?? []) parts.push(e.name);
  if (config.industry) parts.push(config.industry);
  if (!rows.length) {
    const inputs = path.join(dir, 'inputs');
    let budget = INPUT_QUERY_CHARS;
    if (fs.existsSync(inputs)) {
      for (const f of fs.readdirSync(inputs).filter(f => /\.(md|txt|csv|json)$/i.test(f)).sort()) {
        if (budget <= 0) break;
        const text = fs.readFileSync(path.join(inputs, f), 'utf8').slice(0, budget);
        parts.push(text);
        budget -= text.length;
      }
    }
  }
  return parts.filter(Boolean).join(' ');
}

// What the deployment already has or has turned down: case ids and de-identified inputs in cases.csv and
// in pending or rejected cases drafts (an engineer who rejected a suggestion should not see it again).
function existingCases(dir, rows, privacy) {
  const drafted = listDrafts(dir).filter(d => d.kind === 'cases' && d.status !== 'approved').flatMap(d => d.content?.rows ?? []);
  const all = [...rows, ...drafted];
  return {
    ids: new Set(all.map(r => r.id)),
    keys: new Set(all.map(r => caseKey(scrub(r.input, privacy).text))),
  };
}

// suggest(dir, { libraryDir, limit?, env?, now? }) -> the created draft, or null when nothing new matches.
export function suggest(dir, { libraryDir, limit, env = process.env, now = new Date() } = {}) {
  const libDir = checkLibraryDir(libraryDir);
  const max = checkLimit(limit);
  const config = readRawConfig(dir);
  const privacy = privacyOptions(config);
  const rows = readCaseRows(dir);
  const query = deploymentQuery(dir, rows, config);
  if (!query.trim()) throw new Error(`nothing to match on in ${dir}: add cases.csv, mapping.json, "industry" in delomu.json or files in inputs/`);

  // The deployment's own entries are skipped when its source hash can be computed.
  let ownSource = null;
  try { ownSource = sourceHash(dir, config, env); } catch { /* no salt: rely on the input match below */ }
  const industry = industryOf(config);
  const systems = new Set(sourceSystems(dir, privacy));
  const tags = new Set(rows.flatMap(r => r.tags.split('|').map(t => t.trim().toLowerCase()).filter(Boolean)));
  const have = existingCases(dir, rows, privacy);

  const candidates = readEntries(libDir).filter(e => e.kind === 'case' && e.source !== ownSource);
  const byId = new Map(candidates.map(e => [e.id, e]));
  const scored = rank(candidates.map(e => ({ id: e.id, text: entryText(e) })), query).map(hit => {
    const e = byId.get(hit.id);
    const sharedSystems = (e.sourceSystems ?? []).filter(s => systems.has(s));
    const sharedTags = (e.tags ?? []).filter(t => tags.has(t));
    const sameIndustry = !!industry && e.industry === industry;
    const boost = 1 + (sameIndustry ? 0.5 : 0) + 0.25 * Math.min(sharedSystems.length, 2) + 0.1 * Math.min(sharedTags.length, 3);
    return { e, score: hit.score * boost, terms: hit.terms, sharedSystems, sharedTags, sameIndustry };
  }).sort((a, b) => b.score - a.score || a.e.id.localeCompare(b.e.id));

  const picked = [];
  for (const s of scored) {
    if (picked.length >= max) break;
    const key = caseKey(s.e.input);
    const id = `lib-${s.e.id.slice(0, 8)}`;
    if (have.keys.has(key) || have.ids.has(id)) continue;
    have.keys.add(key);
    picked.push({ ...s, id });
  }
  if (!picked.length) return null;

  const rowsOut = picked.map(({ e, id }) => ({
    id,
    input: e.input,
    expected: e.expected,
    must_include: e.must_include,
    must_not_include: e.must_not_include,
    regex: e.regex,
    tags: [...new Set([...(e.tags ?? []), LIBRARY_TAG])].join('|'),
  }));
  const why = picked.map(p => {
    const reasons = [`matched ${p.terms.slice(0, 6).map(t => `"${t}"`).join(', ')}`];
    if (p.sameIndustry) reasons.push(`same industry (${industry})`);
    if (p.sharedSystems.length) reasons.push(`shared systems: ${p.sharedSystems.join(', ')}`);
    if (p.sharedTags.length) reasons.push(`shared tags: ${p.sharedTags.join(', ')}`);
    return `- ${p.id}: ${reasons.join('; ')} (score ${p.score.toFixed(2)})`;
  });
  const rationale = [
    `${picked.length} test case(s) from the deployment knowledge library (de-identified, from consenting deployments) ` +
      "that this deployment does not have yet, ranked by BM25 against its cases, mapping and industry.",
    ...why,
  ].join('\n');
  return createDraft(dir, { kind: 'cases', step: 3, content: { rows: rowsOut }, rationale }, now);
}
