# Submission form text — Meta Global AI Developer Hackathon

Copy each field. Fill in `<REPO_URL>`, `<VIDEO_URL>` and `<X_POST_URL>` before submitting.
Deadline: Wed Nov 4, 9:00 PM ET (Thu Nov 5, 10:00 Taiwan time).

## Project name

Delomu

## Tagline

An AI forward-deployed engineer: it finds what your AI will get wrong at a customer, before launch.

## Track

Indie Developer (solo student founder).

## Theme

Build for Your World.

## Links

- Public repo: `<REPO_URL>`
- Demo video (3:00): `<VIDEO_URL>`
- X post (Most Viral bonus): `<X_POST_URL>`

## Description

AI startups win enterprise customers, then spend weeks of engineer time per rollout: reading the customer's policies,
wiring up their systems, writing tests from the customer's history, and arguing about whether the AI is ready. One
wrong answer about a refund or a data deletion costs real money and trust.

Delomu is an AI forward-deployed engineer. Its headline feature is the risk scan. You upload the customer's own
policies; Muse Spark reads them and lists the rules a support AI must keep, each with the exact clause and what breaks
if it is not kept. Then it writes the customer messages most likely to make an AI break each rule: day 31 of a 30-day
refund window, "my manager already approved it", a deletion request the AI has no tool for. Delomu sends every
message to the customer's AI, and Muse Spark judges each answer against the clause and proposes the smallest fix. On
the demo bot, one scan took under a minute and found 4 of 8 policy rules broken, including a cash refund promised on
a 35-day-old order.

Around the scan sits the rest of a rollout: the agent drafts the data mapping, the integration, a test set from
past tickets, grouped fixes and a launch report. A person approves, edits or rejects every draft, and every action
goes into a hash-chained audit log. Tests re-run when the customer's system or model changes, and the customer gets a
readable acceptance report.

## How Meta's models are used

Muse Spark (`muse-spark-1.3`, Meta Model API, structured JSON output with strict schemas) does three different jobs:

1. **Red-teaming from policy** (reasoning effort high): reads the customer's documents, extracts the rules with clause
   citations and writes adversarial customer messages per rule, targeting boundaries, pressure and missing tools.
2. **Clause-grounded judging** (effort medium): judges each answer of the customer's AI against one quoted clause and
   writes the smallest fix. Every verdict cites where the rule comes from, so an engineer can check it.
3. **Drafting the rollout**: data mapping, integration config, test cases from tickets, grouped fixes and the launch
   report, each as a reviewable draft.

Customer material is wrapped and treated as data (prompt-injection guard), contributor models that allow training on
sent data are refused in code, and phrase checks are limited to exact tokens so the judge decides on meaning.

## What was built during the hackathon

Everything in this repository was built between Oct 31 and Nov 4, 2026; the git history shows every step. The
founder's earlier, different product (an agent-action verification API) is not part of this repository or demo.

- Rollout CLI: test sets from past cases, runs against the customer's AI, acceptance reports
- The agent for steps 1–5 with human review of every draft, and the tamper-evident audit log
- **Risk scan** (the demo's focus): policy → rules with clauses → adversarial probes → live answers → clause-grounded verdicts and fixes
- Meta Model API provider with strict structured output, retries and refusal handling
- Monitoring with regression diffs and Slack alerts; usage metering per active deployment
- Multi-tenant server: organizations, roles, API keys, OIDC single sign-on, review UI, Docker image
- De-identified, consented knowledge library that reuses test cases across rollouts
- 150+ automated tests

Built by a solo student founder working with an AI coding assistant. The demo video's narration is a synthetic voice (Microsoft neural text-to-speech); every screen in it is the real product.

## Team

Alexander Ko (solo).
