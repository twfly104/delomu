// Appliers for the five shared draft kinds. Each runs only after an engineer approves a draft, re-validates
// the (possibly edited) content, then writes the deployment files. A thrown error leaves the draft pending.

import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, toCsvLine } from '../csv.mjs';
import { paths } from '../deployment.mjs';
import { esc } from '../report.mjs';
import { writeTests } from '../commands/v0.mjs';
import { applyConnector } from './connector.mjs';
import { validateMapping, validateIntegration, validateCases, validateFixes, validateLaunchReport } from './validate.mjs';

export const CASE_COLUMNS = ['id', 'input', 'expected', 'must_include', 'must_not_include', 'regex', 'tags'];

function check(kind, problems) {
  if (problems.length) throw new Error(`${kind} draft is not valid: ${problems.join('; ')}`);
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');

// Markdown renderers show inline HTML, so customer- and model-written text is HTML-escaped and kept on one line.
const md = v => esc(v).replace(/\s*\r?\n\s*/g, ' ');

// Rows of cases.csv (empty if missing). Ids default to case-<n> like buildTestSet.
export function readCases(dir) {
  const file = paths(dir).cases;
  return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
}

// Column names of a CSV text (lower-cased, as parseCsv keys them); [] for an empty file.
function csvHeader(text) {
  const first = text.replace(/^﻿/, '').split(/\r?\n/).find(l => l.trim());
  if (!first) return [];
  const [row] = parseCsv(`${first}\nx\n`);
  return Object.keys(row);
}

export const caseIds = rows => new Set(rows.map((r, i) => r.id || `case-${i + 1}`));

export function applyMapping(dir, content) {
  check('mapping', validateMapping(content));
  writeJson(path.join(dir, 'mapping.json'), content);
  return `wrote mapping.json (${content.systems.length} systems, ${content.entities.length} entities, ${content.openQuestions.length} open questions)`;
}

export function applyIntegration(dir, content) {
  check('integration', validateIntegration(content));
  const file = paths(dir).config;
  const config = fs.existsSync(file) ? readJson(file) : { customer: path.basename(path.resolve(dir)), name: 'deployment' };
  config.target = content.target;
  writeJson(file, config);
  return `set ${content.target.type} target in delomu.json`;
}

// Appends rows to cases.csv in its existing column order. If the file lacks a column the new rows use,
// it is rewritten with the full header so no value is dropped.
export function applyCases(dir, content) {
  const existing = readCases(dir);
  check('cases', validateCases(content, caseIds(existing)));
  const file = paths(dir).cases;
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const header = csvHeader(text);
  const needed = CASE_COLUMNS.filter(c => content.rows.some(r => r[c]));
  const line = (cols, r) => toCsvLine(cols.map(c => r[c] ?? ''));

  if (header.length && needed.every(c => header.includes(c))) {
    const sep = text.endsWith('\n') ? '' : '\n';
    fs.appendFileSync(file, sep + content.rows.map(r => line(header, r)).join('\n') + '\n');
  } else {
    const cols = [...header, ...CASE_COLUMNS.filter(c => !header.includes(c))];
    const all = [...existing, ...content.rows];
    fs.writeFileSync(file, [cols.join(','), ...all.map(r => line(cols, r))].join('\n') + '\n');
  }
  const { tests, problems } = writeTests(dir);
  return `appended ${content.rows.length} cases; tests.json has ${tests.length} tests${problems.length ? ` (${problems.length} rows skipped)` : ''}`;
}

export function applyFixes(dir, content) {
  check('fixes', validateFixes(content));
  const lines = ['# Proposed fixes', '', 'Approved from an agent draft. Each group is one root cause with the failed cases it explains.', ''];
  content.groups.forEach((g, i) => {
    lines.push(`## ${i + 1}. ${md(g.cause)}`, '', `- Owner: ${md(g.owner)}`, `- Cases: ${g.caseIds.map(md).join(', ')}`, `- Fix: ${md(g.fix)}`, '');
  });
  fs.writeFileSync(path.join(dir, 'fixes.md'), lines.join('\n'));
  return `wrote fixes.md (${content.groups.length} groups)`;
}

export function applyLaunchReport(dir, content) {
  check('launch-report', validateLaunchReport(content));
  const file = paths(dir).config;
  if (!fs.existsSync(file)) throw new Error(`no delomu.json in ${dir}; cannot record launch decisions`);
  const config = readJson(file);
  const decisions = Array.isArray(config.decisions) ? config.decisions : [];
  const key = d => `${d.date}\n${d.decision}`;
  const seen = new Set(decisions.map(key));
  const added = content.decisions.filter(d => !seen.has(key(d)));
  config.decisions = [...decisions, ...added.map(({ date, decision, reason }) => ({ date, decision, reason }))];
  writeJson(file, config);

  const lines = ['# Launch summary', '', md(content.summary), '', '## Risks', ''];
  lines.push(...(content.risks.length ? content.risks.map(r => `- ${md(r)}`) : ['- None recorded.']), '', '## Decisions', '');
  lines.push('| Date | Decision | Reason |', '| --- | --- | --- |');
  lines.push(...content.decisions.map(d => `| ${md(d.date)} | ${md(d.decision).replace(/\|/g, '\\|')} | ${md(d.reason).replace(/\|/g, '\\|')} |`), '');
  fs.writeFileSync(path.join(dir, 'launch-summary.md'), lines.join('\n'));
  return `wrote launch-summary.md; added ${added.length} decisions to delomu.json`;
}

export const APPLIERS = {
  mapping: applyMapping,
  integration: applyIntegration,
  cases: applyCases,
  fixes: applyFixes,
  'launch-report': applyLaunchReport,
  connector: applyConnector,
};
