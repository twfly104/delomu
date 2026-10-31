# Build contract (v1–v4)

Read this before changing anything. Several agents build in this repository at the same time, so file
ownership below is strict. The plan these versions come from is the business plan doc
("AI 前線部署工程師（AI FDE）創業計畫"); the six deployment steps are:

1. Read the customer's docs, past tickets and system settings; produce a data mapping.
2. Draft integration code that connects to the customer's systems.
3. Build a test set from the customer's own past cases.
4. Run the customer's AI against it, find gaps, propose fixes.
5. Produce a launch report that records the reason for every decision.
6. After launch, keep monitoring; re-run tests automatically when the customer's system or model version changes.

## Versions

| Version | Adds | Gate it must make possible to measure |
| --- | --- | --- |
| v0 (done) | Steps 3–5 by hand with tools: `src/*.mjs`, `src/commands/v0.mjs` | hours per step are logged |
| v1 | An agent drafts steps 1–5; an engineer approves, edits or rejects every draft | hours for customer 5 < half of customer 1 |
| v2 | Step 6: monitoring, regression re-runs on change, alerts, usage metering for "active deployment" billing | active deployments keep growing, 90-day retention |
| v3 | Enterprise and partner edition: multi-tenant server, orgs, roles, API keys, SSO (OIDC), audit, web review UI, self-host (customer VPC) | enterprise + partner share of ARR |
| v4 | Deployment knowledge library: de-identified, consented reuse of test cases, integration templates and failure patterns | new deployments get faster |

Pricing (from the plan, assumptions): platform fee 3,000 USD per customer per month; 500 USD per active
deployment per month; onboarding fee one-off (not MRR).

## Shared foundation (read-only for builders)

- `src/core/llm.mjs` — `createLlm({ client?, model? }).json({ system, prompt, schema, effort?, maxTokens? })`
  returns `{ ok: true, data }` or `{ ok: false, reason: 'refusal' | 'max_tokens' }`. All Claude calls go through
  it. `isAuthError(e)` tells you when credentials are missing so you can degrade instead of crash.
- `src/core/audit.mjs` — `appendAudit(dir, { actor, action, target, detail })`, `readAudit`, `verifyAudit`.
  Actor is `agent`, `human:<name>` or `system`. Log every agent action and every state change.
- `src/core/drafts.mjs` — `registerApplier(kind, (dir, content) => summary)`, `createDraft(dir, { kind, step, content, rationale })`,
  `listDrafts`, `getDraft`, `reviewDraft(dir, id, { decision, by, note, content? })`. Agents never change a deployment
  directly: they create drafts. Register appliers at the top level of your command file so the CLI's `review`
  command can apply them.
- `src/commands/args.mjs` — `flag`, `bool`, `need`.
- v0 modules: `src/deployment.mjs` (paths, `loadConfig`, `loadTests`, `logHours`, `hoursByStep`, `STEPS`),
  `src/run.mjs` (`runDeployment(dir, { judge, concurrency, now })`, `latestRun(dir)`, `summarize`),
  `src/testset.mjs` (`buildTestSet(csv)`), `src/csv.mjs`, `src/adapters.mjs` (`callTarget`), `src/report.mjs` (`renderHtml`, `esc`),
  `src/commands/v0.mjs` (`writeTests(dir, from?)`).

A deployment folder holds `delomu.json`, `cases.csv`, `tests.json`, `hours.csv`, `audit.jsonl`, `drafts/`, `runs/<id>/`.
v1 adds `inputs/` (customer material the agent may read) and `mapping.json`.

## File ownership

| Owner | May create or edit |
| --- | --- |
| v1 builder | `src/v1/**`, `src/commands/v1.mjs`, `test/v1*.test.mjs`, `examples/acme-support/inputs/**`, `docs/v1.md` |
| v2 builder | `src/v2/**`, `src/commands/v2.mjs`, `test/v2*.test.mjs`, `docs/v2.md` |
| v3 builder | `src/v3/**`, `src/commands/v3.mjs`, `test/v3*.test.mjs`, `Dockerfile`, `.dockerignore`, `docs/v3.md` |
| v4 builder | `src/v4/**`, `src/commands/v4.mjs`, `test/v4*.test.mjs`, `docs/v4.md` |
| integrator (main session) | everything else: `package.json`, `README.md`, `src/core/**`, v0 files, `bin/`, this file |

If you need a change in a file you do not own, do not make it: list it in your final report under
"shared changes needed", with the exact change.

## Rules

- Node 20+, ES modules, no new npm dependencies. Node built-ins only (including `node:sqlite` for v3), plus `@anthropic-ai/sdk` through `src/core/llm.mjs`.
- Tests use `node:test`, never call the network or a real model (inject a fake client), use temp folders, and must pass with `npm test` from the repo root together with every other suite.
- Never store secrets in files: config values use `${ENV_VAR}`. Never log keys.
- Everything that ends up in HTML is escaped. Paths from users are checked against traversal.
- Code style: match `src/run.mjs` and `src/core/*.mjs` — small modules, a header comment saying what the file is for, comments only where the reason is not obvious.
- User-facing CLI text and customer reports are in English.

## Cross-version interfaces (build to these signatures so the integrator can wire them)

- v1 `src/v1/agent.mjs`: `draftMapping(dir, { llm })`, `draftIntegration(dir, { llm })`, `draftCases(dir, { llm, limit })`,
  `draftFixes(dir, { llm })`, `draftLaunchReport(dir, { llm })` — each returns the created draft(s).
- v2 `src/v2/monitor.mjs`: `checkDeployment(dir, { now, force, judge }) -> { ran, reason, results?, diff? }`,
  `findDeployments(root) -> string[]`, `usage(root, { month, pricing }) -> { month, active: [...], platformCustomers, lines, totalUsd }`.
- v3 `src/v3/server.mjs`: `createServer({ dataDir, deploymentsRoot, ... }) -> http.Server` (not listening), `start(port)`.
- v4 `src/v4/library.mjs`: `scrub(text) -> { text, found }`, `harvest(dir, { libraryDir }) -> { added }`,
  `search(libraryDir, query, { limit }) -> entries`, `suggest(dir, { libraryDir }) -> draft` (a v1-style draft of kind `cases`).

## Shared draft kinds

| Kind | Step | Content shape | Applier owner |
| --- | --- | --- | --- |
| `mapping` | 1 | `{ systems: [{ name, purpose }], entities: [{ name, system, fields: [{ name, meaning, example }] }], openQuestions: [string] }` → `mapping.json` | v1 |
| `integration` | 2 | `{ target: <delomu.json target>, notes: string }` → merged into `delomu.json` | v1 |
| `cases` | 3 | `{ rows: [{ id, input, expected, must_include, must_not_include, regex, tags }] }` (multi-values joined with `|`) → appended to `cases.csv`, then `tests.json` rebuilt | v1 (v4's `suggest` creates drafts of this kind) |
| `fixes` | 4 | `{ groups: [{ cause, caseIds: [string], fix, owner }] }` → `fixes.md` | v1 |
| `launch-report` | 5 | `{ summary: string, risks: [string], decisions: [{ date, decision, reason }] }` → `launch-summary.md` + decisions merged into `delomu.json` | v1 |
