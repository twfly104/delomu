# SOC 2 readiness

Status on 2026-11-07: **not certified, no audit booked.** This folder is the groundwork an auditor asks for first:
written policies, a map from each SOC 2 criterion to the control that meets it (with where the evidence lives),
and the gaps still open. Nothing here is a claim of compliance. Say "we are preparing for SOC 2", never "SOC 2
compliant", until a CPA firm has issued a report.

## The path

| Step | What | Who | Rough cost and time |
| --- | --- | --- | --- |
| 1. Readiness (this folder) | Policies, control map, gap list | Founder | Done in draft; review yearly |
| 2. Close the gaps below | Mostly settings and habits, a few code items | Founder | 2–4 weeks part time |
| 3. Compliance platform (optional) | Vanta, Drata, Secureframe or Sprinto collect evidence from GitHub, Railway, Google Workspace automatically | Founder | about US$7–15k a year; startup programs are often cheaper |
| 4. SOC 2 Type I | An auditor checks the controls exist on one date | CPA firm | about US$10–25k, 1–2 months |
| 5. SOC 2 Type II | The auditor checks the controls ran over 3–12 months | CPA firm | about US$15–40k, after the window |

Start step 3 or 4 when a paying client's security review asks for a report. Until then, the security overview
(`docs/security.md`), the subprocessor list and the DPA template answer most questionnaires.

Scope for the first report: Security (required). Add Confidentiality, because clients send their policies and
tickets. Availability and Processing Integrity can wait.

## Control map (Trust Services Criteria, Security)

"Evidence" is where an auditor would look. "Gap" is what is missing today.

| Criterion | Control | Evidence | Gap |
| --- | --- | --- | --- |
| CC1 Control environment | One owner of security (the founder); policies in `policies/`, reviewed yearly | This folder, git history | No signed policy acknowledgements; no background check process (no employees yet) |
| CC2 Communication | Public security overview, vulnerability reporting through GitHub private reports | `SECURITY.md`, `docs/security.md`, grapim.com/security | None for now |
| CC3 Risk assessment | Yearly risk review | `policies/risk-assessment.md` | First review not yet recorded |
| CC4 Monitoring of controls | Audit logs, regression monitoring, alert webhooks | `src/core/audit.mjs`, `src/v3/monitoring.mjs` | No scheduled review of access and logs |
| CC5 Control activities | Tests before deploy, also in CI | 290+ `node:test` tests, `.github/workflows/test.yml` | Railway does not yet wait for CI |
| CC6.1 Logical access | Roles and permissions; per-org isolation; hashed API keys, sessions and links; SSO (OIDC) | `src/v3/rbac.mjs`, `src/v3/sessions.mjs`, `src/v3/keys.mjs`, `src/v3/sso.mjs` | MFA on admin accounts (GitHub, Railway, Cloudflare, Google, Anthropic, Stripe) not yet confirmed and recorded |
| CC6.6 Boundary protection | Outbound-call guard against internal addresses; CSRF; rate limits; strict headers | `src/core/netguard.mjs`, `src/v3/http.mjs`, `src/v3/ratelimit.mjs` | No WAF; rate limits are per process |
| CC6.7 Data in transit and at rest | HTTPS (Railway certificate); saved keys AES-256-GCM | `src/v3/secrets.mjs` | No app-level encryption of uploaded files; relies on the host's disk |
| CC7.1 Vulnerability management | Dependencies kept minimal; Dependabot version updates | `package.json`, `.github/dependabot.yml` | Dependabot alerts and secret scanning not yet on in GitHub settings |
| CC7.2–7.5 Incident response | Written plan | `policies/incident-response.md` | Not yet tested with a tabletop exercise |
| CC8 Change management | All changes through git on `main`; tests before push | git history | No pull-request review or branch protection; one person approves their own changes |
| CC9 Vendor risk | Subprocessor list, DPA template | `docs/trust/subprocessors.md`, `docs/trust/dpa-template.md`, `policies/vendor-management.md` | Vendors' own SOC 2 reports not yet collected |
| A1 Availability | Railway volume, health check | `/healthz` in `src/v3/server.mjs` | Backups of the data volume not confirmed; no restore test |
| C1 Confidentiality | De-identification for the playbook; PII scrub of live conversations; retention policy | `src/v4/scrub.mjs`, `policies/data-retention.md` | No automatic deletion; no self-serve delete of an agent or org |

## Gaps, in the order to close them

1. Turn on MFA everywhere an admin signs in (GitHub, Railway, Cloudflare, Google, Anthropic, Stripe, Hunter, LinkedIn) and record it in `evidence/access-review.md`. Founder, 1 hour.
2. Dependabot version updates are configured (`.github/dependabot.yml`). Still to do in GitHub settings: turn on Dependabot alerts and secret scanning. Founder, 10 minutes.
3. A CI workflow runs `npm test` on every push (`.github/workflows/test.yml`). Still to do: turn on "Wait for CI" in Railway so a failing build does not deploy. 5 minutes.
4. Confirm Railway volume backups are on; do one restore into a scratch service and write down how long it took. 2 hours.
5. Self-serve deletion of an AI agent and an org, and an automatic retention period for live conversations. Code, 1–2 days.
6. Record the first risk assessment and a tabletop incident exercise. 2 hours.
7. Collect SOC 2 reports from Railway, Anthropic, Stripe and Cloudflare. 1 hour.
8. When a second engineer joins: pull requests with review, and branch protection on `main`.

## Policies

- [Information security](policies/information-security.md)
- [Access control](policies/access-control.md)
- [Change management](policies/change-management.md)
- [Incident response](policies/incident-response.md)
- [Business continuity and backups](policies/business-continuity.md)
- [Vendor management](policies/vendor-management.md)
- [Data classification and retention](policies/data-retention.md)
- [Risk assessment](policies/risk-assessment.md)
