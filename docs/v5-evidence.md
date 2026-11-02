# Evidence pack

A printable record, for one AI agent (a deployment) over a date range, of how it was tested against the
company's written policies, what was fixed, what live monitoring saw, and whether the audit log is intact.
It is meant for legal, risk and compliance teams: every number is counted from records Delomu already stores,
nothing is estimated, and each section names the records it came from.

- Page: `GET /orgs/:org/deployments/:name/evidence.html?from=YYYY-MM-DD&to=YYYY-MM-DD`
  (linked as "Evidence pack" on the agent's check results page).
- Permission: `runs:read`, the same as the customer report. Served with the report CSP (no scripts).
- Range: both days inclusive, in UTC. Without `from`/`to` it covers the last 90 days up to today; a missing
  `from` is 89 days before `to`. A date that is not a real `YYYY-MM-DD` day, or `from` after `to`, is a 400.
- Code: `src/v3/evidence.mjs` — `evidenceRange(query, now)`, `buildEvidence(dir, { from, to, now })` (plain
  data) and `renderEvidence(data, { name, customer, org })` (HTML, every value escaped). To save a PDF, print it.

A record is "in the period" when its own timestamp falls between `from` 00:00 and the end of `to`.

## Sections and how each number is computed

### Checks run
Every scan in `scans/` whose `createdAt` is in the period, oldest first: date, rules, rules broken, and
whether it is a re-check (`recheckOf` set). A rule is **broken** when at least one of its test messages has the
verdict `broken`. This is the same rule as the check results page.

### Breaks found and fixed
For each re-check in the period, the check it repeated (`recheckOf`, looked up among all scans, even ones
before the period) is compared rule by rule. Rules are matched by id and wording, which a re-check copies.

- Before / after: rules broken in the earlier check and in the re-check, on the same test messages.
- Fixed: broken before, kept after (every message judged and none broken).
- Still broken: broken before and after.
- Newly broken: not broken before, broken after.

A rule that ends up "needs review" (a message could not be judged) is not counted as fixed. If the earlier
check is missing from `scans/`, the before count shows as unknown.

### Approved fixes
Audit log entries in the period with action `fix.apply` (approved and applied by Delomu),
`fix.applied_manually` (approved; the team applied it in their own tool) or `fix.revert` (earlier
instructions put back), with who did it and the check it was for. When `fix.json` (which keeps only the latest
fix) belongs to that check, its summary and rule count are added. If `fix.json` records an approval or revert
in the period that has no matching audit entry, it is still listed and marked "fix.json only, no audit entry",
because that gap is itself worth a reviewer's attention.

### Mean time to fix
Over the checks in the period, oldest first. For each rule: the first check that finds it broken opens an
episode; the first **later re-check** that keeps it closes the episode, and the time between the two
`createdAt` values is one sample. A fresh full check that keeps the rule does not close it, because it used
different messages. The mean is the average of all samples. With no samples the section says "Not enough
data". Rules still broken at the end of the period are listed. Checks before the period are ignored, so an
episode that started earlier is not counted.

### Live monitoring
Every `live/<YYYY-MM>.jsonl` file is read, and each stored conversation is counted when its `at` (when the
conversation happened) is in the period, grouped by that month. Every month in the period gets a row, including
months with none. Columns: conversations checked, those that broke a rule (status `flagged`), and those that
could not be judged (`unjudged`). Most-broken rules: each rule's count of violations across the period, top 5;
a conversation that broke two rules counts once for each. Unreadable lines are skipped, as on the Live page.

### Audit chain
`verifyAudit` is run on `audit.jsonl` when the pack is generated: either **intact**, or **broken at entry N**
with the reason (sequence gap, previous hash does not match, entry was modified). A line that is not JSON
breaks the chain at that line, unless an earlier entry is already broken. Also shown: the total number of
lines, how many entries fall in the period, and the latest entry's sequence number, time and SHA-256 hash.

### How to read this, and the footer
A short plain-language guide to the terms above, then a footer with the agent, the period and the generation
time (UTC).

Every empty section says "No records in this period".
