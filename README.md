# Grapim

**Find what your AI will get wrong at a customer, before your customer does.**

An AI forward-deployed engineer. It helps an AI startup roll its product out to a customer:
it maps the customer's data, drafts the integration, builds a test set from the customer's own past
cases, runs the AI against it, writes the acceptance report, and keeps watching after launch.
An agent drafts each step; an engineer approves, edits or rejects every draft.

## Meta Global AI Developer Hackathon (Indie Developer track)

Everything in this repository was built during the hackathon (Oct 27 – Nov 4, 2026); the git history shows each
step. Details for judges: [hackathon/SUBMISSION.md](hackathon/SUBMISSION.md).

**The risk scan** is the focus. Upload the customer's policies; Muse Spark (`muse-spark-1.3`, Meta Model API):

1. reads them and lists the rules a support AI must keep, each with the exact clause and what breaks if it is not kept;
2. writes the customer messages most likely to break each rule (day 35 of a 30-day window, "my manager approved it");
3. Grapim sends them to the customer's AI, and Muse Spark judges every answer against the quoted clause and proposes
   the smallest fix;
4. the probes are drafted into the permanent test set for an engineer to approve.

On the demo bot one scan takes under a minute and finds 4 of 8 rules broken.

```bash
npm install
```

```bash
MODEL_API_KEY=your-meta-key node bin/delomu.mjs scan examples/acme-support
```

Or run the web app: `docs/v3.md` (Docker) and open the deployment's **Risk scan** tab.

**New here?** [docs/quickstart.md](docs/quickstart.md) walks through both ways in: AI vendors rolling out to clients, and teams running their own agent.

## Versions

| Version | What it adds | Docs |
| --- | --- | --- |
| v0 | Test set from past cases, run against the customer's AI, acceptance report, hours log | below |
| v1 | Agent drafts steps 1–5 (mapping, integration, test cases, fixes, launch report); human review of every draft | [docs/v1.md](docs/v1.md) |
| v2 | Monitoring: re-runs on change or schedule, regression diff, Slack alerts, usage billing per active deployment | [docs/v2.md](docs/v2.md) |
| v3 | Enterprise and partner server: orgs, roles, API keys, OIDC single sign-on, audit export, review UI, Docker self-hosting | [docs/v3.md](docs/v3.md) |
| v4 | Knowledge library: consented, de-identified test cases, integration templates and failure patterns reused across deployments | [docs/v4.md](docs/v4.md) |
| v5 | Two kinds of customer: AI vendors get one workspace per client, one-click rollout, client sign-off and deployment metrics; any company gets sales, billing and HR agents, re-checks on policy change, an OpenAI-compatible connection, an inline guard, an evidence pack and a public page; a vendor playbook so each rollout starts from earlier ones ([docs/v5-playbook.md](docs/v5-playbook.md)); productization health and hosted regression monitoring ([docs/v5-productization.md](docs/v5-productization.md)); read-only import from Zendesk, Intercom and Shopify and a generated client-system connector ([docs/v5-connector.md](docs/v5-connector.md)); an assistant on every page ([docs/v5-assistant.md](docs/v5-assistant.md)) | [docs/v5.md](docs/v5.md) |

中文使用指南：[docs/使用指南.md](docs/使用指南.md)。

[CONTRACT.md](CONTRACT.md) has the architecture, file ownership and the interfaces between versions.

## Setup

Node 20 or later (Node 24 for the v3 server, which uses `node:sqlite`). Run `npm install` once.

| Variable | Needed for |
| --- | --- |
| `ANTHROPIC_API_KEY` or `MODEL_API_KEY` | the v1 agent and the judge: Claude Opus 5.5 (live monitoring uses Claude Sonnet 5.5; override with `DELOMU_LIVE_MODEL`), or Meta `muse-spark-1.3` (override with `DELOMU_META_MODEL`, and the API base with `DELOMU_META_URL`; an unknown model name fails with the list of models the key can use). `DELOMU_LLM_PROVIDER=anthropic|meta` picks one when both are set. Without either, `agent` stops with a clear message and judge checks are marked "needs review". Check Meta's data-retention terms before sending real customer data. |
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

## Connecting a help-desk AI (Intercom, Zendesk)

When the customer's support AI lives inside a help desk, Grapim can talk to it there instead of through an
HTTP endpoint. Pick Intercom or Zendesk in the web "New deployment" form, or set `target` in `delomu.json`.
Credentials are always `${ENV_VAR}` references; on the v3 server they must start with `CUSTOMER_`.

**Intercom** (Fin or a bot), via the Intercom REST API:

```json
"target": { "type": "intercom", "token": "${CUSTOMER_INTERCOM_TOKEN}", "contactExternalId": "delomu-test", "timeoutMs": 60000 }
```

Each test case starts a new conversation from the test contact (found by external id, created if missing),
then polls the conversation until a bot or teammate replies, and uses that first reply as plain text. Internal
notes are ignored. `pollMs` defaults to 2000 and `timeoutMs` to 60000; for EU or AU workspaces set `baseUrl`
to `https://api.eu.intercom.io` or `https://api.au.intercom.io`.

**Zendesk** (an AI agent in Zendesk messaging), via the Sunshine Conversations API v2:

```json
"target": { "type": "zendesk", "subdomain": "acme", "appId": "<app id>", "keyId": "${CUSTOMER_ZENDESK_KEY_ID}", "secret": "${CUSTOMER_ZENDESK_SECRET}" }
```

Create the key in Admin Center under Apps and integrations, Conversations API. Each test case creates a fresh
test user (`delomu-<uuid>`) and personal conversation, posts the input as that user, and waits for the first
business-authored reply. The base URL is `https://{subdomain}.zendesk.com/sc` unless `baseUrl` is set.

Both connectors are tested only against local mock servers that follow the published API docs; confirm with
one or two cases on the customer's real workspace before a full run.

## Billing

The v3 server bills organizations through Stripe. The plans live in one table, `PLANS` in
`src/v3/billing.mjs`:

| Plan | Price | Active deployments a month | Risk scans a month |
| --- | --- | --- | --- |
| Free | $0 | 1 | 3 |
| Team | $499 / month | 5 included, then $99 per extra active deployment | unlimited |
| Enterprise | contact sales | unlimited | unlimited |

A deployment is **active** in a month once it has a completed test run that month (the same rule
`delomu usage` uses). On Free, a run that would make a second deployment active and a fourth risk scan
in a month are refused with HTTP 402 (`code: plan_limit_active_deployments` / `plan_limit_scans`,
`upgrade_url` in the API error; a link to Billing in the web UI). Deployments already active keep
running. Owners and admins open **Billing** in the sidebar (`/orgs/<org>/billing`) to see the plan,
this month's usage against the limits, **Upgrade to Team** (Stripe Checkout), **Manage billing** (Stripe
Customer Portal) and the plans side by side.

**Without Stripe** (no `STRIPE_SECRET_KEY`) the server runs normally, the Billing page says billing is
not configured and every org is on Free. A self-hosted operator can lift the limits for an org with
`node bin/delomu.mjs admin plan --org <org id> --plan enterprise` (and `--plan free` to undo).

| Variable | What |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_...`. Any other key is refused at start-up unless `DELOMU_BILLING_LIVE=1`. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` of the webhook endpoint (or the one `stripe listen` prints). |
| `STRIPE_PRICE_TEAM` | the $499/month recurring price. |
| `STRIPE_PRICE_EXTRA` | the $99 metered price, backed by a Billing Meter. |
| `STRIPE_METER_EVENT` | the meter's event name (default `delomu_extra_active_deployment`). |
| `DELOMU_PUBLIC_URL` | where Stripe sends people back after Checkout and the portal (not needed on localhost). |
| `DELOMU_SALES_CONTACT` | optional email or URL behind "Contact sales". |

Set up test mode (Stripe Dashboard in a sandbox, or the Stripe CLI):

1. Create a meter: event name `delomu_extra_active_deployment`, aggregation **Sum**, customer mapping
   `stripe_customer_id`, value key `value`.
2. Create a product "Grapim Team" with two monthly prices: a flat $499 recurring price (`STRIPE_PRICE_TEAM`)
   and a usage-based $99 per-unit price on that meter (`STRIPE_PRICE_EXTRA`).
3. Turn on the Customer Portal (Settings, Billing, Customer portal) so customers can change cards and cancel.
4. Webhooks: point an endpoint at `https://<your host>/webhooks/stripe` with the events
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and
   `invoice.payment_failed`, and copy its signing secret. Locally, run
   `stripe listen --forward-to localhost:8080/webhooks/stripe` and use the `whsec_` it prints.
5. Start the server with the variables above and pay with Stripe's test card `4242 4242 4242 4242`.

The webhook checks the `Stripe-Signature` HMAC (5-minute tolerance, constant-time compare), ignores
events it has already applied and events from the other mode (live vs test), and never lets an older
subscription event overwrite a newer one. On Team, each deployment that becomes active beyond the five
included ones sends one meter event (value 1, a stable `identifier`, so retries do not double-bill);
failed reports are retried when the Billing page is opened. Going live later means swapping in live keys,
live price ids and the live webhook secret, and setting `DELOMU_BILLING_LIVE=1`.

## Demo and tests

`npm run demo` runs a fictional support bot (`examples/mock-bot.mjs`) with three planted bugs against
`examples/acme-support`. `npm test` runs all suites (no network, no real model calls).

## Layout

| Path | What |
| --- | --- |
| `bin/delomu.mjs` | CLI; loads every command file in `src/commands/` |
| `src/core/` | shared: Claude calls, audit log, draft review store |
| `src/*.mjs` | v0: test set, adapters, grading, judge, runs, report |
| `src/connectors/` | help-desk targets: Intercom and Zendesk (Sunshine Conversations) |
| `src/v1/` … `src/v4/` | one folder per version, with its commands in `src/commands/vN.mjs` |
| `examples/` | the Acme demo deployment and mock bot |
| `Dockerfile` | the v3 server image |
