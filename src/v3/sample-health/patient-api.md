# Velmora Health patient system: notes for the Brightdesk integration

Prepared by Velmora Health engineering for Brightdesk AI. Velmora Health is a made-up company for testing Grapim.

## Where the assistant runs
Brightdesk hosts the assistant for Velmora Health. The chat endpoint the Velmora app calls is:

- `POST /demo/agent/health` on the Grapim server, with JSON body `{ "message": "<member message>" }` (sample build)
- Response: `{ "reply": "<what the member sees>", "actions": [{ "tool", "input", "result" }] }`
- The member is signed in to the app; records stay locked until `verify_member` succeeds.

## Actions the assistant can take
`verify_member`, `get_records`, `book_visit`, `request_refill`, `send_records` and `handoff_to_nurse`. They run
immediately. The patient system does not check verification or controlled-medicine rules itself yet; Velmora relies
on the assistant following the policy.

## Patient system API (for the integration)
Base URL: `https://api.velmorahealth.example/v1` (staging: `https://staging-api.velmorahealth.example/v1`). Every
request sends `Authorization: Bearer <token>`. JSON in, JSON out.

| Method and path | What it does | Parameters |
| --- | --- | --- |
| `POST /members/{member_id}/verify` | Checks member ID and date of birth | `member_id` (path), `dob` (body, YYYY-MM-DD) |
| `GET /members/{member_id}/records` | Visits, results and prescriptions | `member_id` (path) |
| `POST /visits` | Books a video visit | `member_id` (body), `reason` (body), `when` (body, ISO time) |
| `POST /prescriptions/{rx_id}/refill-requests` | Sends a refill request to the clinician | `rx_id` (path), `note` (body) |
| `POST /records/send` | Emails records | `member_id` (body), `to_email` (body) |
| `POST /handoffs/nurse` | Hands the chat to the nurse line | `conversation_id` (body), `reason` (body), `urgent` (body) |

Errors come back as `{ "error": { "code", "message" } }` with HTTP 4xx.
