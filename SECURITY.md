# Security at Delomu

Delomu reads a customer's policies and sends test messages to their AI. This page says what we protect, how,
and what we have not done yet. It describes the code in this repository; where something depends on how you
host it, it says so.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security → Report a vulnerability). Please do
not open a public issue. We aim to reply within three business days.

## What Delomu stores

| Data | Where | Notes |
| --- | --- | --- |
| Orgs, members, roles, sessions, API key hashes | `delomu.db` (SQLite) in the data volume | API keys are stored as HMAC-SHA256 under a server pepper (`DELOMU_KEY_PEPPER`); the secret is shown once |
| Each deployment's config, test cases, runs, reports, drafts, scans | The deployment's folder in the data volume | One folder per org; every path is re-checked to stay inside that org's folder |
| Customer material (policies, docs, tickets) | `inputs/` in the deployment folder | Only Markdown, text, CSV, JSON, YAML and HTML, up to 1 MB each |
| Audit log | `audit.jsonl` per deployment | Hash-chained: changing or deleting a past entry breaks the chain, and the UI shows it |

Credentials for the customer's AI are never stored. A target may only reference server environment variables
with the operator's prefix (default `CUSTOMER_`), for example `${CUSTOMER_INTERCOM_TOKEN}`.

## Access control

- Roles per organization: owner, admin, engineer, viewer. The web UI and the JSON API share one permission check.
- Sign-in with OIDC single sign-on or an API key; API keys can be limited to scopes.
- Sessions are HTTP-only cookies; every state-changing form checks a CSRF token.
- Partner orgs can manage the customer orgs they created; sessions stay scoped to the home org.
- Rate limiting on the API; strict Content-Security-Policy and security headers on every page.

## AI-specific protections

- Customer material is wrapped and treated as data, never as instructions (prompt-injection guard).
- Meta "contributor" models, which allow training on the data sent, are refused in code.
- Nothing the agent drafts takes effect until a person approves it; every decision is in the audit log.
- Risk-scan findings cite the exact clause, so an engineer can check every verdict.
- Command targets (programs on the server) are off unless the operator turns them on.

## Knowledge library

Test cases are added to the cross-customer library only with the customer's recorded written consent. Names,
emails, phone numbers, card numbers, keys and customer-specific terms are scrubbed first, and a customer's entries
can be deleted on request (`delomu library forget`).

## Model providers

Customer material and test answers are sent to the configured model provider: Meta Model API or Anthropic. See
[docs/trust/subprocessors.md](docs/trust/subprocessors.md).

## Hosting

Self-hosted (the Docker image) keeps all data inside the customer's own cloud. When you host it:

- Put it behind HTTPS and set `DELOMU_PUBLIC_URL` to the https address (secure cookies follow from it).
- Encrypt the data volume at rest (your cloud provider's disk encryption).
- Back up the data volume; `delomu.db` and the deployment folders are the whole state.

## Not done yet

We say this plainly so nobody assumes otherwise:

- No SOC 2 or ISO 27001 report yet. These need an auditor and months of evidence; we will start once we have customers.
- No third-party penetration test yet.
- No built-in encryption at rest; it relies on the host's disk encryption.
- No data residency options beyond self-hosting.
