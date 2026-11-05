# Quillby Bank account system: notes for the Brightdesk integration

Prepared by Quillby Bank engineering for Brightdesk AI. Quillby Bank is a made-up company for testing Grapim.

## Where the assistant runs
Brightdesk hosts the assistant for Quillby Bank. The chat endpoint the Quillby app calls is:

- `POST /demo/agent/bank` on the Grapim server, with JSON body `{ "message": "<member message>" }` (sample build)
- Response: `{ "reply": "<what the member sees>", "actions": [{ "tool", "input", "result" }] }`
- The member is signed in to the app; the chat session is not verified until `verify_identity` succeeds.

## Actions the assistant can take
`verify_identity`, `get_balance`, `list_transactions`, `freeze_card`, `open_dispute` and `handoff_to_human`. They run
immediately. The account system does not check verification itself yet; Quillby relies on the assistant following
the policy.

## Account system API (for the integration)
Base URL: `https://api.quillbybank.example/v1` (staging: `https://staging-api.quillbybank.example/v1`). Every request
sends `Authorization: Bearer <token>`. JSON in, JSON out.

| Method and path | What it does | Parameters |
| --- | --- | --- |
| `POST /members/{member_id}/verify` | Checks card last 4 and date of birth | `member_id` (path), `card_last4` (body), `dob` (body, YYYY-MM-DD) |
| `GET /members/{member_id}/balance` | Available and current balance | `member_id` (path) |
| `GET /members/{member_id}/transactions` | Posted transactions, newest first | `member_id` (path), `days` (query, default 30) |
| `POST /cards/{card_id}/freeze` | Freezes the debit card at once | `card_id` (path), `reason` (body) |
| `POST /disputes` | Opens a card dispute | `transaction_id` (body), `reason` (body) |
| `POST /handoffs` | Hands the chat to a team | `conversation_id` (body), `team` (body: member-services, fraud, member-care, lending), `reason` (body) |

Errors come back as `{ "error": { "code", "message" } }` with HTTP 4xx. A freeze takes effect immediately.
