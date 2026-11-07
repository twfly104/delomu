# Access control policy

Owner: Alexander Ko, founder. Approved 2026-11-07. Reviewed every 12 months and after any security incident.

## Production access
- Who: the founder only, today. Each new person gets the least access their work needs, recorded in
  `../evidence/access-review.md`.
- Systems: GitHub (code), Railway (hosting and data volume), Cloudflare (DNS), the Anthropic and Meta model
  consoles, Stripe, Gmail or Google Workspace, Resend.
- MFA is required on every one of them. Shared accounts are not allowed.

## In the product
- Roles and permissions are defined once in `src/v3/rbac.mjs`. API keys, sessions and share links are stored as
  hashes only. Orgs can require SSO (OIDC).
- Removing a member revokes their keys and ends their sessions.

## Reviews
- Every quarter, list who has access to each system above and remove anyone who no longer needs it. Record the
  date and result in `../evidence/access-review.md`.
- When someone leaves: remove all of their access the same day.
