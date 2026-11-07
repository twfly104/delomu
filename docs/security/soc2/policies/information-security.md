# Information security policy

Owner: Alexander Ko, founder. Approved 2026-11-07. Reviewed every 12 months and after any security incident.

## Purpose
Grapim holds clients' policies, documents, test messages and their AI agents' answers. This policy says how that
data is protected and who is responsible.

## Rules
1. Client data is used only to provide Grapim to that client. It is never used to train models, and model
   providers that train on submitted data are refused in code.
2. Each org's data stays in its own folder and database rows. No person or process crosses an org boundary,
   except a vendor's admins acting on the clients that vendor manages.
3. Secrets (API keys, tokens, passwords) are never committed to git, pasted into chat tools, or shown back in the
   product. They live in environment variables or are encrypted per deployment.
4. Every admin account used to run Grapim has multi-factor authentication.
5. Security problems are reported and handled under the incident response policy.
6. Anyone who joins Grapim reads these policies and records that they did, before getting access.

## Related
Access control, change management, incident response, vendor management, data retention.
