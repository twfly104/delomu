# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
One integrated product for everyone involved in rolling an AI product out to an enterprise customer (confirmed: "all guy, it should be integrated, make everything simple"):

- **Deployment engineers** at an AI startup (Series A–C): every day they review agent drafts, run tests and move several customer rollouts forward.
- **Deployment leads and executives** at the same startup: they check which rollouts are on track, at risk or ready to launch, and rarely operate anything themselves.
- **The enterprise customer**: they sign in to see their own acceptance report, launch decision and monitoring status.

The same screens serve all three; roles decide what each person can do, not which product they use.

## Product Purpose
Delomu is an AI forward-deployed engineer. An agent drafts each step of a customer rollout (data mapping, integration, test cases from the customer's own past tickets, fixes, launch report); a person approves, edits or rejects every draft; tests run against the customer's AI and are re-run automatically after launch. Success: one engineer can carry more rollouts, each rollout is faster than the last, and every launch decision is backed by evidence the customer can read.

## Positioning
The agent proposes, a person decides, and every action is recorded in a tamper-evident audit log. Tests are built from the customer's own history and graded against the customer's own policy, not generic benchmarks.

## Operating Context
- A rollout moves through six steps: 1 mapping, 2 integration, 3 test set, 4 test and fix, 5 launch report, 6 monitoring.
- Daily work is a queue: drafts waiting for review, runs that regressed, rollouts close to launch.
- Customer material (policies, API docs, ticket exports) is uploaded per deployment; the agent may only read that.
- Organizations: customer orgs, and partner orgs that run rollouts for several customers. Roles: owner, admin, engineer, reviewer, viewer.
- Sign-in: company SSO (OIDC) or an API key; programs use API keys.
- Pricing (planning assumption): 3,000 USD per customer per month platform fee, 500 USD per active deployment per month.

## Capabilities and Constraints
- Server-rendered HTML from plain Node (`src/v3/`), no frontend framework, no new npm dependencies. Must work without JavaScript for core actions; small progressive enhancement is allowed.
- English only, for US customers.
- Everything rendered is escaped; forms carry CSRF tokens; tenants never cross org boundaries.
- Runs are synchronous today and can take tens of seconds.
- Not yet in the web UI (as of 2026-11-01): creating deployments, uploading inputs, starting the agent, starting runs. These are in scope for the redesign.

## Evidence on Hand
- Demo data only: the fictional Acme support bot (`examples/`). No real customers, logos, testimonials or usage numbers exist; never invent them.

## Product Principles
1. Simple first: one obvious next action on every screen; complexity stays behind it.
2. Human decides: the agent's work is always presented as a proposal with its reasoning, never applied silently.
3. Evidence over claims: every verdict links to the cases and reasons behind it.
4. Same truth for everyone: engineer, lead and customer see the same facts at the depth their role needs.

## Brand Commitments
- Visual standard (confirmed 2026-11-01): look and feel at the level of Linear, Vercel and Stripe, played straight. Calm, precise product UI; no themed world or costume. Familiar navigation and controls.
- The earlier Delomu Verify look (Inter, #5B5BF5) is not carried over.
- Logo (confirmed 2026-11-01): the existing Delomu mark, a "D" cut by one diagonal slash, with the "Delomu" wordmark (capital D, confirmed 2026-11-01). Files in `assets/brand/`. Shown in the text colour (near-black on light, white on dark); the old purple app-icon tile is not used in the product UI.
