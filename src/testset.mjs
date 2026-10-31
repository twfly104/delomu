// Step 3: turn the customer's own past cases into a test set.
//
// cases.csv columns (header names are case-insensitive):
//   id                 optional; defaults to the row number
//   input              required: what the end user sent
//   expected           optional: what a correct answer must do, in plain words (graded by the judge)
//   must_include       optional: phrases the answer must contain, separated by |
//   must_not_include   optional: phrases the answer must never contain, separated by |
//   regex              optional: a pattern the answer must match
//   tags               optional: labels for grouping in the report, separated by |

import { parseCsv } from './csv.mjs';

const list = v => (v ? v.split('|').map(x => x.trim()).filter(Boolean) : []);

export function buildTestSet(csvText) {
  const rows = parseCsv(csvText);
  const tests = [];
  const problems = [];
  const seen = new Set();

  rows.forEach((r, i) => {
    const line = i + 2;
    const id = r.id || `case-${i + 1}`;
    if (!r.input) { problems.push(`line ${line}: empty input, skipped`); return; }
    if (seen.has(id)) { problems.push(`line ${line}: duplicate id "${id}", skipped`); return; }

    const checks = [
      ...list(r.must_include).map(value => ({ type: 'contains', value })),
      ...list(r.must_not_include).map(value => ({ type: 'not_contains', value })),
    ];
    if (r.regex) {
      try { new RegExp(r.regex, 'i'); checks.push({ type: 'regex', value: r.regex }); }
      catch { problems.push(`line ${line}: invalid regex, ignored`); }
    }
    if (r.expected) checks.push({ type: 'judge', value: r.expected });
    if (!checks.length) { problems.push(`line ${line}: no expected, must_include, must_not_include or regex, skipped`); return; }

    seen.add(id);
    tests.push({ id, input: r.input, checks, tags: list(r.tags) });
  });

  return { tests, problems };
}
