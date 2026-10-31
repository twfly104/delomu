# Delomu

An AI forward-deployed engineer. It helps an AI startup roll its product out to a customer:
it maps the customer's data, drafts the integration, builds a test set from the customer's own past
cases, runs the AI against it, writes the acceptance report, and keeps watching after launch.
An agent drafts each step; an engineer approves, edits or rejects every draft.

The previous Delomu Verify code was moved, untouched, to `Desktop\delomu-verify-archive`.

## Versions

| Version | What it adds | Docs |
| --- | --- | --- |
| v0 | Test set from past cases, run against the customer's AI, acceptance report, hours log | below |
| v1 | Agent drafts steps 1–5 (mapping, integration, test cases, fixes, launch report); human review of every draft | [docs/v1.md](docs/v1.md) |
| v2 | Monitoring: re-runs on change or schedule, regression diff, Slack alerts, usage billing per active deployment | [docs/v2.md](docs/v2.md) |
| v3 | Enterprise and partner server: orgs, roles, API keys, OIDC single sign-on, audit export, review UI, Docker self-hosting | [docs/v3.md](docs/v3.md) |
| v4 | Knowledge library: consented, de-identified test cases, integration templates and failure patterns reused across deployments | [docs/v4.md](docs/v4.md) |

[CONTRACT.md](CONTRACT.md) has the architecture, file ownership and the interfaces between versions.

## Setup

Node 20 or later (Node 24 for the v3 server, which uses `node:sqlite`). Run `npm install` once.

| Variable | Needed for |
| --- | --- |
| `ANTHROPIC_API_KEY` or `MODEL_API_KEY` | the v1 agent and the judge: Claude Opus 5.5, or Meta `muse-spark-1.3` (override with `DELOMU_META_MODEL`). `DELOMU_LLM_PROVIDER=anthropic|meta` picks one when both are set. Without either, `agent` stops with a clear message and judge checks are marked "needs review". Check Meta's data-retention terms before sending real customer data. |
| `DELOMU_KEY_PEPPER` | the v3 server (16+ characters, from a secret manager) |
| `DELOMU_LIBRARY_SALT` | v4 library harvests (16+ characters, from a secret manager) |
| `CUSTOMER_*` | API keys of the customer's AI, referenced from `delomu.json` as `${CUSTOMER_API_KEY}`; never written into files |

## One customer, start to finish

```bash
node bin/delomu.mjs init deployments/acme --customer "Acme"
```

Put the customer's material (policies, API docs, a ticket export) in `deployments/acme/inputs/`, then:

```bash
node bin/delomu.mjs agent deployments/acme all
```

```bash
node bin/delomu.mjs drafts deployments/acme
```

```bash
node bin/delomu.mjs review deployments/acme <draft-id> approve --by alex
```

```bash
node bin/delomu.mjs run deployments/acme
```

```bash
node bin/delomu.mjs agent deployments/acme fixes
```

```bash
node bin/delomu.mjs agent deployments/acme launch-report
```

After launch, run the monitor from cron (or leave it running without `--once`):

```bash
node bin/delomu.mjs watch deployments --once
```

Log your own hours per step with `delomu log`, and check gate 1 (the 5th deployment needs under half the
hours of the 1st) with `delomu compare-hours deployments`. Every agent action and human review is in a
hash-chained `audit.jsonl`; `delomu audit <dir> --verify` checks it was not altered.

`node bin/delomu.mjs help` lists every command.

## Demo and tests

`npm run demo` runs a fictional support bot (`examples/mock-bot.mjs`) with three planted bugs against
`examples/acme-support`. `npm test` runs all suites (no network, no real model calls).

## Layout

| Path | What |
| --- | --- |
| `bin/delomu.mjs` | CLI; loads every command file in `src/commands/` |
| `src/core/` | shared: Claude calls, audit log, draft review store |
| `src/*.mjs` | v0: test set, adapters, grading, judge, runs, report |
| `src/v1/` … `src/v4/` | one folder per version, with its commands in `src/commands/vN.mjs` |
| `examples/` | the Acme demo deployment and mock bot |
| `Dockerfile` | the v3 server image |
