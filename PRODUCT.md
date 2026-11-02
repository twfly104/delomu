# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Confirmed 2026-11-01: the main user is the **head of support or CX lead at a SaaS company** that runs an AI support agent (Intercom Fin, Zendesk AI or its own bot). They check that the AI follows the company's own written policies before launch and keep watching real conversations after. They are not engineers; plain language beats technical terms.

Added 2026-11-02: **AI vendors** (heads of forward deployed or solutions engineering at companies that sell an AI agent to businesses) sign up as a partner org. Each client is its own workspace, and they use the Clients page, one-click rollout, client sign-off and deployment metrics. Same engine, same plain language; their pages may say rollout, client and engineer hours.

Secondary: support operations people who connect the help desk and set alerts, and engineers at AI startups who still use the deeper test-run and agent-draft tools (kept behind the More menu).

## Product Purpose
Delomu finds the policy rules a support AI breaks, before customers do. It reads the company's policies, writes the customer messages most likely to make the AI break each rule, sends them to the AI and judges every answer against the exact clause. After launch it checks real conversations and alerts on high-risk breaks. Success: a support lead sees, in one screen, which rules break, the AI's actual reply, the clause it broke and the fix.

## Positioning
Tests are built from the company's own policies and graded against the exact clause, not generic benchmarks. Every finding shows the real exchange and the clause. The agent proposes, a person decides, and every action is recorded in a tamper-evident audit log.

## Operating Context
- An AI agent (internally a "deployment"; URLs keep that word) moves through three stages: Policies, Pre-launch check, Live monitoring.
- Each agent page has four tabs: Check results, Live, Policies, Settings. Activity, test runs and agent drafts live under More.
- Organizations and roles (owner, admin, engineer, reviewer, viewer) are unchanged. Sign-in: self-serve sign-up with a sign-in key, company SSO (OIDC), or an API key.
- Plans: Free, Team, Enterprise (see the Billing page).

## Capabilities and Constraints
- Server-rendered HTML from plain Node (`src/v3/`), no frontend framework, no new npm dependencies. Must work without JavaScript for core actions; small progressive enhancement is allowed.
- English only, for US customers.
- Everything rendered is escaped; forms carry CSRF tokens; tenants never cross org boundaries.
- Runs are synchronous today and can take tens of seconds.

## Evidence on Hand
- Demo data only: the fictional Acme support bot (`examples/`, `src/v3/demo-bot.mjs`, which has deliberate bugs). Its scan results are a demonstration, never evidence of real-world error rates. No real customers, logos, testimonials or usage numbers exist; never invent them.

## Product Principles
1. Simple first: one obvious next action on every screen; complexity stays behind it.
2. Human decides: the agent's work is always presented as a proposal with its reasoning, never applied silently.
3. Evidence over claims: every verdict links to the cases and reasons behind it.
4. Same truth for everyone: engineer, lead and customer see the same facts at the depth their role needs.

## Brand Commitments
- Visual standard (confirmed 2026-11-01): look and feel at the level of Linear, Vercel and Stripe, played straight. Calm, precise product UI; no themed world or costume. Familiar navigation and controls.
- The earlier Delomu Verify look (Inter, #5B5BF5) is not carried over.
- Logo (confirmed 2026-11-01): the existing Delomu mark, a "D" cut by one diagonal slash, with the "Delomu" wordmark (capital D, confirmed 2026-11-01). Files in `assets/brand/`. Shown in the text colour (near-black on light, white on dark); the old purple app-icon tile is not used in the product UI.
