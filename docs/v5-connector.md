# v5: importing from the client's systems, and the client-system connector

This covers two parts of the rollout that used to be done by hand: getting the client's material in, and
connecting the agent to the client's own systems.

## Read-only import (Policies tab)

Grapim imports straight from three client systems, so nobody has to export and upload files. The code is in
`src/v3/importers.mjs`.

| Source | What it brings in | Credentials |
| --- | --- | --- |
| Zendesk Support | Up to 50 solved tickets, with the customer's message and the agent's final public reply, as `zendesk-tickets.csv`; Help Center articles as `zendesk-help-center.md` | **OAuth** (Connect Zendesk: the client's own Confidential OAuth client, PKCE, read scope; the token refreshes once when it expires), or subdomain, agent email and API token for older accounts. New Zendesk accounts cannot make API tokens, and existing ones stop working on 30 April 2027 |
| Intercom | Up to 50 closed conversations as `intercom-tickets.csv`; published articles as `intercom-help-center.md` | Access token (read permissions are enough) |
| Shopify | Store policies (refund, shipping, privacy, terms) as `shopify-policies.md` | Store domain (`*.myshopify.com`), Admin API token with `read_legal_policies` |

### How the import treats the client's data

- **Read only.** Grapim sends only GET requests, plus Intercom's search, which reads.
- **Personal data is removed.** Emails, phone numbers and card numbers in ticket text are replaced with
  placeholders, and requester names and emails are never kept.
- **The token is stored encrypted** in the deployment's saved keys, so **Import again** needs nothing typed.
  The subdomain, email and store domain are remembered in `delomu.json` under `imports`.
- **Private addresses are blocked.** Every request goes through the same network guard as the agent's
  connections.
- **Policies are re-checked.** If the import changes the policy files and a check exists, the check runs again,
  as it does after an upload.

## Client-system connector (Rollout page, step 2)

The connector is the tools the AI agent calls in the client's systems: look up an order, cancel it, refund it.
The code is in `src/v1/connector.mjs`.

1. **The agent drafts a manifest from the client's API docs.** It writes one tool per documented endpoint, with
   a method, a path, parameters and a description that includes the policy limit. Every tool that changes
   something is marked as an action. It only uses endpoints the docs show. When the docs describe none, it says
   so and creates nothing.
2. **An engineer approves, edits or rejects the draft.** It is the `connector` kind on the Review tab. Validation
   checks that names are snake_case, every non-GET tool is an action, path placeholders are declared, and paths
   stay on the base URL.
3. **Grapim generates the rest.** After approval it writes `connector.json`, and the Rollout page offers two
   downloads:
   - `connector.js`: a dependency-free Node module with `anthropicTools`, `openaiTools` and
     `runTool(name, input, { message })`. With `DELOMU_API_KEY` set, every action tool calls this deployment's
     guard first and does not run if the guard blocks it. The guard fails open, as the guard itself does.
   - `connector-tools.json`: the same tools in Anthropic and OpenAI format, for agents not written in Node.

The client-specific part is only the manifest. The code is generated the same way for every client, following
rule 3 of the plan: customize in configuration, never in one-off code.

**Run the rollout** drafts the connector right after the integration.

## Checked so far

- **Connector, real model:** run once on the sample store's order API section. It drafted 7 tools (2 that read,
  5 that act), and each action's description carries its policy limit.
- **Generated code:** the tests run it against a local fake API and guard. It reads with GET, sends the body for
  actions, and does not act when the guard blocks.
- **Imports:** Zendesk ran for real on 2026-11-05: a new trial account connected through OAuth from the live site
  and imported a solved ticket. Intercom and Shopify are tested against recorded API shapes only.
