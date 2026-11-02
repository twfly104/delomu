# Linden & Co. order system: notes for the Brightdesk integration

Prepared by Linden & Co. engineering for Brightdesk AI. Linden & Co. is a made-up company for testing Delomu.

## Where the assistant runs
Brightdesk hosts the assistant for Linden & Co. The chat endpoint the Linden website calls is:

- `POST http://127.0.0.1:8792/chat` with JSON body `{ "message": "<customer message>" }` (local test build)
- Response: `{ "reply": "<what the customer sees>", "actions": [{ "tool", "input", "result" }] }`
- The signed-in customer comes from the website session; no extra auth for the local build.

## Order data the assistant can see
| Field | Meaning | Example |
| --- | --- | --- |
| `id` | Order number | `L-1002` |
| `items[].name` / `items[].price` | Product and price in USD | `Brass table lamp`, `120` |
| `items[].finalSale` | Final sale or clearance: never returnable | `true` |
| `placedAt` / `deliveredAt` | ISO timestamps; returns count from delivery | `2026-09-25T10:00:00Z` |
| `status` | `processing`, `shipped` or `delivered` | `delivered` |
| `promoCode` | Code already used on the order | `WELCOME10` |

## Actions the assistant can take
`issue_refund`, `cancel_order`, `apply_promo_code`, `adjust_price` and `handoff_to_human`. They run immediately in
the order system. There are no server-side limits yet; the store relies on the assistant following the policy.
