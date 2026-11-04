# Grapim security overview

For legal and security reviewers at companies whose AI agents are checked with Grapim. It answers one question:
is Grapim itself safe to send your policies and tickets to? Every statement below describes the code in this
repository as it is today. Grapim was called Delomu, so file names, cookies and environment variables still say
`delomu`. Each section ends with "Where this lives" for your engineers.

## Hosting

- The hosted service runs on Railway, deployed automatically from the `main` branch, from the repository's Docker image.
- The image runs as a non-root user. All state lives in one data volume mounted at `/data`.
- The same image can be self-hosted, which keeps all data inside your own cloud.

Where this lives: `Dockerfile`, `src/v3/server.mjs`.

## What Grapim stores, and where

All of it is in the data volume (`DELOMU_DATA`, `/data` in the image):

| Data | Where |
| --- | --- |
| Orgs, users (email only), memberships, roles, API key hashes, session hashes, SSO settings, share-link hashes, org audit events, billing state | `delomu.db` (SQLite) |
| Each AI agent's settings, test cases, check results, run reports, drafts | `deployments/<org id>/<agent name>/` |
| Policies and documents you upload or import (Markdown, text, CSV, JSON, YAML, HTML; up to 1 MB each) | `inputs/` in that folder |
| Live conversations and guard checks | `live/<YYYY-MM>.jsonl` in that folder |
| Keys you paste for your AI or help desk (encrypted) | `secrets.json` in that folder |
| Client sign-off decisions (name, note, decision) | `signoff.json` in that folder, and its audit log |
| Hash-chained audit log | `audit.jsonl` in that folder |
| A vendor's playbook (only with recorded client consent, de-identified) | `deployments/<org id>/.library/` |

- The database and files are not encrypted by Grapim. Only saved keys are (see Secrets). Encryption at rest
  depends on the host's disk.
- Server errors are written to standard error, which the host collects.

Where this lives: `src/v3/db.mjs`, `src/v3/workspace.mjs`, `src/v3/secrets.mjs`, `src/v3/signoff.mjs`,
`src/v1/live.mjs`, `src/v3/playbook.mjs`, `src/v3/web.mjs` (upload limits).

## What is sent to the model provider

The AI judge and the drafting agent call a model provider through one module. The hosted service uses Anthropic.
The code also supports Meta's Model API if an operator configures it, and refuses Meta "contributor" models,
which allow training on the data sent. Default models: Claude Opus 5.5 for checks, Claude Sonnet 5.5 for live
monitoring, Claude Haiku 5.5 for the guard.

What is scrubbed before it is sent or stored:

- **Live conversations and guard checks**: scrubbed before they are stored and before they go to the model.
- **Imports from Zendesk, Intercom and Shopify**: ticket text is scrubbed before it is written to disk. Requester
  names and emails are not kept. Help-center articles and store policies are kept as published.
- **Playbook entries**: scrubbed, with client and org names removed too.

What is not scrubbed:

- **Files you upload** are stored and sent to the model as uploaded. If you upload a ticket export, remove
  personal data first.
- **Policy checks** send your policy text, the test messages and your AI's answers to the model as they are.

The scrubber is pattern-based and runs offline. It replaces emails, phone numbers, card numbers (Luhn-checked),
IBANs (checksum-checked), US social security numbers, IP addresses, URL credentials and query strings, and API
keys and tokens with placeholders such as `[EMAIL]`. It does not detect people's names on its own; names are
removed only where Grapim is given a list (for the playbook). It can miss data in formats it does not know.

Customer material is wrapped in tags and the model is told to treat it as data, not instructions.

Where this lives: `src/core/llm.mjs`, `src/v4/scrub.mjs`, `src/v1/live.mjs`, `src/v1/guard.mjs`,
`src/v3/importers.mjs`, `src/v4/harvest.mjs`, `src/v1/risk.mjs`, `src/v1/agent.mjs` (`neutral`).

## Tenant isolation

- Every request names an org. The server looks up the caller's role in that org. No role means "not found",
  so other orgs' names are not revealed.
- Each org's files live in their own folder. AI agent names are validated strictly, and every path is
  re-checked to stay inside the org's folder.
- An AI vendor (partner org) has one client workspace (customer org) per client. The vendor's owners and admins
  act in its client workspaces as admins. Nobody else crosses an org boundary, and a client workspace never
  manages another org.
- A vendor's playbook stays with that vendor; it is never shared between vendors.

Where this lives: `src/v3/rbac.mjs` (`roleIn`), `src/v3/operations.mjs` (`access`), `src/v3/workspace.mjs`
(`deploymentDir`), `src/v3/accounts.mjs`, `src/v3/playbook.mjs`.

## Secrets

- A key you paste for your AI or help desk is encrypted with AES-256-GCM under a key derived (SHA-256) from the
  server's pepper, and written to `secrets.json` with owner-only file permissions.
- It is never shown again. The settings page shows only its name and when it was saved. The audit log records
  only its name.
- The agent's settings refer to it as `${secret:NAME}`. It is decrypted only when the server calls your system.
- Otherwise a setting may only reference server environment variables with the operator's prefix (default
  `CUSTOMER_`), so a tenant cannot read server secrets.
- Help-desk import tokens are kept the same way, so "Import again" needs nothing typed. Tokens are removed from
  error messages.

Where this lives: `src/v3/secrets.mjs`, `src/v3/workspace.mjs` (`checkTarget`), `src/v3/web.mjs` (secret and
import routes), `src/v3/server.mjs` (secret resolver).

## Authentication and roles

- **Sign-in keys and API keys** (`dk_...`, 256 random bits) are shown once. The database stores only an
  HMAC-SHA256 of each key under the server pepper, plus a short prefix for display. Keys can be revoked; revoking
  a key ends the browser sessions opened with it.
- **API** (`/v1`, `/mcp`): bearer API keys only, no cookies, so no CSRF surface. Keys can be limited to scopes.
- **Browser sessions**: a random token in a cookie that is `HttpOnly` and `SameSite=Lax`, and `Secure` when the
  server's public URL is https. The database stores only the token's SHA-256. Sessions last 12 hours.
- **CSRF**: every form that changes something checks a per-session token with a constant-time compare. The
  sign-in, sign-up and sign-off forms use their own short-lived token cookie.
- **Single sign-on (OIDC)**: per org, with state, nonce and PKCE; the ID token is verified; the email must be
  verified and its domain on the org's allow list. New users are added with a default role, never owner. The
  client secret stays in a server environment variable; only its name is stored. SSO is set up through the API
  by an org owner or admin.
- **Roles**: owner, admin, engineer, reviewer, viewer, from one permission table used by the web app and the
  API. Only an owner can grant or remove the owner role, and an org always keeps one owner. Removing a member
  revokes their keys and ends their sessions.

Where this lives: `src/v3/keys.mjs`, `src/v3/sessions.mjs`, `src/v3/http.mjs` (`cookie`), `src/v3/web.mjs`
(`/login`, `/signup`, `/sso/start`, `/sso/callback`, `requireCsrf`), `src/v3/sso.mjs`, `src/v3/oidc.mjs`,
`src/v3/rbac.mjs`, `src/v3/accounts.mjs`, `src/v3/api.mjs` (`authenticate`).

## Share and sign-off links

- A client sign-off link and an agent's public page open without an account. Only a SHA-256 of each link's
  token is stored, so a link is shown once when it is made.
- Sign-off links expire after 30 days and can be revoked. Public-page links do not expire; turning the page off
  ends every link. The public page is off until an owner or admin turns it on.
- A sign-off link shows only the check it was made for, its report and the launch summary.

Where this lives: `src/v3/shares.mjs`, `src/v3/signoff.mjs`, `src/v3/verified.mjs`, `src/v3/web.mjs`.

## Audit log

- Each AI agent has an append-only audit log. Each entry includes the SHA-256 of the one before it, so editing or
  deleting a past entry breaks the chain.
- The chain is verified when the log is read; the API and the app show whether it is intact.
- A person can overrule the AI judge on one answer. The check record is never edited: the override is stored
  beside it with who made it and when, the page shows the judge's verdict next to the person's, and the change
  is an audit entry (`verdict.override`, `verdict.restore`).
- When a re-check after a fix Grapim applied comes out worse, Grapim puts the earlier instructions back and logs
  it as `fix.revert` by `grapim`.
- Org-level events (sign-ins, member and key changes, uploads, exports, with IP address) are kept in the
  database. These are not hash-chained. Both can be exported as one CSV.

Where this lives: `src/core/audit.mjs`, `src/v3/events.mjs`, `src/v3/api.mjs` (audit routes).

## Web hardening

- **Headers on every response**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY`, `Cache-Control: no-store`.
- **Content-Security-Policy on every page**: `default-src 'none'`, scripts only by hash, no framing, no base
  URI. Fonts are served by Grapim, so pages make no third-party requests. Reports get a stricter policy with no
  scripts.
- **Rate limits**: per API key on the API and MCP; per address on sign-up, sign-off and the demo bot. Limits are kept in
  memory on one server.
- **Body size**: 1 MB per request by default; uploads up to 8 MB in total, 1 MB per file.
- **Outbound calls**: on an internet-facing server, calls to addresses a tenant chooses (your AI, a help desk,
  an alert webhook, an SSO issuer) are refused if the host resolves to a private or local address (localhost,
  cloud metadata, private ranges), and redirects are refused. `DELOMU_ALLOW_PRIVATE_TARGETS` overrides this. A
  host that changes its DNS answer between the check and the call is not covered.
- **No shell commands**: agents that run programs on the server are off unless the operator turns them on.

Where this lives: `src/v3/http.mjs` (`SECURITY_HEADERS`, `readBody`), `src/v3/web.mjs` (`PAGE_CSP`),
`src/v3/ratelimit.mjs`, `src/v3/server.mjs`, `src/core/netguard.mjs`.

## The guard fails open

The inline guard checks a reply (or an action such as a refund) before your customer sees it. If it cannot
judge (no check run yet, the model errors, refuses, or takes more than 15 seconds), it answers **allow** and marks
the result `unjudged`. So an outage at Grapim or the model provider never stops your AI from answering, but
during an outage replies go out unchecked. If an action moves money, your code can treat `unjudged` as block.

Where this lives: `src/v1/guard.mjs`.

## Subprocessors

| Who | What for | What it receives |
| --- | --- | --- |
| Anthropic | The AI model | Policies, test messages, your AI's answers, scrubbed live conversations, uploaded files used in a check |
| Railway | Hosting | Everything stored in the data volume, and server logs |
| Stripe | Billing, only when an org pays | The email of the person who upgrades, and the subscription; no policies or tickets |

Grapim also calls systems you point it at: your AI, your help desk (read-only import), and your alert webhook.

Where this lives: `src/core/llm.mjs`, `src/v3/billing.mjs`, `src/v3/importers.mjs`, `src/v2/alerts.mjs`.

## Deleting data

What exists today:

- Remove a member (also revokes their keys and ends their sessions). Revoke an API key.
- Revoke sign-off links; turn off the public page.
- Withdraw playbook consent, which removes that rollout's entries from the playbook.
- Expired sessions and sign-in attempts are removed.

What does not exist:

- No way in the app or the API to delete an AI agent, its uploaded files, check results or conversations, or a
  whole org. Today this is done by the operator on the server.

## Not yet

- No SOC 2 or ISO 27001 report.
- No third-party penetration test.
- No formal retention period. Data is kept until it is deleted by hand; live conversations are kept in monthly
  files with no automatic expiry.
- No self-serve deletion of an AI agent, its data, or an org.
- No choice of data region on the hosted service. Self-hosting is the only way to choose where data lives.
- No encryption at rest by Grapim beyond saved keys; it relies on the host's disk.
- Uploaded files are not scrubbed of personal data.
- SSO is not a self-serve screen; an owner or admin sets it up through the API, and the client secret must be set
  as an environment variable on the server.
- No rate limit on the key sign-in form (keys are 256-bit random values).
- Rate limits are in memory, for one server process.
- The org-level audit events in the database are not hash-chained.
- The guard fails open (see above).
