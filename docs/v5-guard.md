# Inline guard

Live monitoring (`POST .../conversations`) judges an exchange after the customer has already read the
answer. The inline guard checks the reply **before** it is sent: the customer's code asks Grapim whether
the reply keeps the company's policy rules, and gets back a decision it can act on immediately.

It uses the same rules as live monitoring (the latest risk scan's), the same scrubbing of emails, phone
numbers, card numbers and keys, and the same 4,000-character cap on each text. The code is in
`src/v1/guard.mjs` (`guardReply`) and the endpoint in `src/v3/api.mjs`.

## Request

```
POST /v1/orgs/:org/deployments/:name/guard
Authorization: Bearer <API key with guard:check>
Content-Type: application/json
Idempotency-Key: <optional>

{ "message": "Can I get a refund after 45 days?", "reply": "Sure, I issued a full refund.", "id": "ticket-123" }
```

- `reply` (required): the text your AI is about to send. A missing or empty reply is a `400`.
- `message` (optional): the customer's message it answers. Without it the guard judges the reply alone.
- `id` (optional): your own reference, stored with the record.

Permission: `guard:check` (owner, admin, engineer; the same roles as `conversations:write`). A restricted
key needs `guard:check` in its scopes; `conversations:write` alone does not allow it. The per-key rate
limit and `Idempotency-Key` replay work as for every other `POST`.

## Response

`200` with:

```json
{
  "object": "guard_check",
  "id": "gd_…",
  "decision": "rewrite",
  "violations": [
    { "rule": "refund-window", "clause": "refund-policy.md §2", "severity": "high", "what_happened": "Promised a cash refund at day 45." }
  ],
  "safeReply": "After 30 days we can offer store credit for this order."
}
```

| `decision` | Meaning | What your code should do |
| --- | --- | --- |
| `allow` | No rule broken, or the check could not run (see `unjudged`) | Send the original reply |
| `rewrite` | A rule is broken and the model wrote a reply that keeps every rule | Send `safeReply` instead |
| `block` | A rule is broken and no safe reply could be written without inventing policy | Do not send it; hand off to a person or send your own fallback |

`safeReply` is only present on `rewrite`. It is written from the company's own clauses; the model is told
never to invent a policy, price, date or promise, and to leave it empty (which gives `block`) if a safe
reply would need one. Because `safeReply` is built from the scrubbed reply, it never contains the
personal data that was removed.

## Fail-open

The guard sits in the path of a real customer, so it must never be the reason they get no answer. In these
cases the response is still `200` with `decision: "allow"`, `unjudged: true` and a `reason`:

- the deployment has no risk scan yet (no rules to check; no model call is made and nothing counts);
- the model refuses, errors, returns unusable output or has no credentials;
- the model does not answer within 15 seconds (`GUARD_TIMEOUT_MS` in `src/v1/guard.mjs`);
- the record or audit entry cannot be written (logged on the server).

Unjudged checks are stored with status `unjudged`, so they show on the Live page for a person to read.
Errors that are the caller's to fix are not failed open: unknown org or deployment (`404`), missing
permission (`403`), a missing `reply` (`400`), the rate limit (`429`) and the plan limit (`402`). Callers
that want strict behaviour can treat `unjudged: true` as a block in their own code.

## Records, quota and audit

Every judged check (including unjudged ones after a model call) is appended to the deployment's
`live/<YYYY-MM>.jsonl` with `source: "guard"`, the `decision` and the `safeReply`. That means it shows on the
Live page and counts toward the plan's monthly live conversations; past the allowance the endpoint returns
`402 plan_limit_conversations` before any model call. Each check appends a `guard.check` entry to the
deployment's audit log, and each `rewrite` or `block` records an org event (`guard.rewrite` /
`guard.block`).

## Model

One structured-output call per check through `src/core/llm.mjs`. The default model is `claude-haiku-5-5`
(`DEFAULT_GUARD_MODEL`), the smallest Claude model, because the guard adds its time to every reply. Set
`DELOMU_GUARD_MODEL` to use another one, for example a larger model when accuracy matters more than
speed. On the Meta provider a Claude name falls back to the Meta default, as for live monitoring.
The wording of the prompt follows the deployment's agent kind (`src/v1/kinds.mjs`).

## Cost and latency

These depend on your rules and traffic; Grapim has not published measured numbers.

- **Cost:** one model call per check. The prompt holds every rule of the latest scan plus the message and
  reply, so cost grows with the number of rules. A `rewrite` adds output tokens for the safe reply.
- **Latency:** the guard adds one model round trip to every reply before it is sent. Measure it from your
  own region with your own rules before going live, and set your own client timeout below the 15-second
  server limit if your channel needs a faster answer (on your timeout, send the original reply or your fallback).
- To reduce both: keep the scan's rule list focused, and consider guarding only the channels or intents
  where a broken rule is costly, while sending the rest to `POST .../conversations` after the fact.

## Checking an action before it runs

An agent that takes actions (refunds, cancellations, promo codes, price changes, hand-offs) can ask before each
tool call. Send the action and the record it touches to the same endpoint:

```
POST /v1/orgs/:org/deployments/:name/guard
Authorization: Bearer <API key with guard:check>

{ "action": { "tool": "cancel_order", "input": { "order_id": "L-1006" } },
  "context": { "id": "L-1006", "placedAt": "2026-11-03T15:03:58Z", "status": "processing" },
  "message": "Can you cancel both of my recent orders?" }
```

Response: `{ "object": "guard_action", "id", "decision": "allow" | "block", "violations": [{ "rule", "clause", "severity",
"what_happened" }], "tellCustomer"? }`. On `block`, do not run the tool; give the agent the reason and
`tellCustomer`, the policy's own wording for what to say instead. The judgment uses the record and the current time,
so "within 1 hour of being placed" or "within 30 days of delivery" is decided from real dates.

It fails open like the reply check (`allow` with `unjudged: true`) when there is no scan yet or no verdict. An agent
that moves money may choose to treat `unjudged` as `block`. Each check is in the audit log (`guard.action`) and
counts toward the plan's live conversations.

`examples/linden-agent/server.mjs` shows the integration: with `LINDEN_GUARD_URL` and `LINDEN_GUARD_KEY` set,
every tool call goes through this check first. In the real test it let a cancel 20 minutes after ordering through and
blocked one 3 hours after, and the agent explained the 1-hour window to the customer instead.
