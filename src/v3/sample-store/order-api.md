# Linden & Co. order system: notes for the Brightdesk integration

Prepared by Linden & Co. engineering for Brightdesk AI. Linden & Co. is a made-up company for testing Delomu.

## Where the assistant runs
Brightdesk hosts the assistant for Linden & Co. The chat endpoint the Linden website calls is:

- `POST /demo/store-agent` on the Delomu server, with JSON body `{ "message": "<customer message>" }` (sample build)
- Response: `{ "reply": "<what the customer sees>", "actions": [{ "tool", "input", "result" }] }`
- The signed-in customer comes from the website session; no extra auth for the sample build.

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

## Order system API (for the integration)
Base URL: `https://api.lindenandco.example/v2` (staging: `https://staging-api.lindenandco.example/v2`). Every request
sends `Authorization: Bearer <token>`; Linden issues one token per environment. JSON in, JSON out.

| Method and path | What it does | Parameters |
| --- | --- | --- |
| `GET /customers/{customer_id}/orders` | The customer's orders, newest first | `customer_id` (path), `status` (query, optional) |
| `GET /orders/{order_id}` | One order with items, dates, status and promo code | `order_id` (path) |
| `POST /orders/{order_id}/cancel` | Cancels an order that has not shipped | `order_id` (path), `reason` (body) |
| `POST /orders/{order_id}/refunds` | Refunds to the original payment method | `order_id` (path), `amount` (body, USD), `reason` (body) |
| `POST /orders/{order_id}/promo-codes` | Applies a promo code | `order_id` (path), `code` (body) |
| `POST /orders/{order_id}/price-adjustments` | Refunds the difference when the price dropped | `order_id` (path), `amount` (body, USD), `reason` (body) |
| `POST /handoffs` | Hands the chat to the care team | `conversation_id` (body), `reason` (body) |

Errors come back as `{ "error": { "code", "message" } }` with HTTP 4xx. Refunds and price adjustments are final.
