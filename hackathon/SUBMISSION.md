# Submission form text — Meta Global AI Developer Hackathon

Copy each field. Fill in `<REPO_URL>`, `<VIDEO_URL>` and `<X_POST_URL>` before submitting.
Deadline: Wed Nov 4, 9:00 PM ET (Thu Nov 5, 10:00 Taiwan time).

## Project name

Delomu

## Tagline

Finds the policy rules an AI agent breaks, before customers do, and keeps checking every reply after launch.

## Track

Indie Developer (solo student founder).

## Theme

Build for Your World.

## Links

- Public repo: `<REPO_URL>`
- Live app (free sign-up): https://delomu-production.up.railway.app/signup
- Demo video (2:11): `<VIDEO_URL>`
- X post (Most Viral bonus): `<X_POST_URL>`

## Description

Companies now let AI agents answer their customers, and the agents read the company's refund, cancellation and
privacy policies. Nobody checks that they follow them at the edges, and a wrong answer is public and expensive: a
tribunal made Air Canada honor a refund its chatbot promised against policy.

Delomu checks an AI agent against the company's own written policies. You upload the policies; Muse Spark reads them,
lists the rules the AI must keep with the exact clause for each, and writes the messages most likely to make an AI
break each rule: day 31 of a 30-day refund window, "my manager already approved it", a deletion request the AI has no
tool for. Delomu sends every message to the company's AI, and Muse Spark judges each answer against its clause. The
result is one screen: a tile per rule, red where it broke, with the AI's actual reply, the clause and the fix. On the
demo bot, one check took under a minute and found 4 of 8 policy rules broken, including a cash refund promised on a
35-day-old order.

Then it closes the loop. The agent drafts one change to the AI's instructions; a person approves it; Delomu applies it
and runs the same messages again, showing before and after, with one-click undo if it got worse. After launch it checks
real conversations and alerts on high-risk breaks, and an inline guard can check a reply before the customer sees it,
returning allow, a rule-keeping rewrite, or block. When the company changes its policies, the check runs again.

It serves two kinds of customer with the same engine:

- **A company running an AI agent** (support, sales, billing or HR) uses the check, live monitoring and the guard.
- **An AI vendor deploying its agent to clients** gets a separate workspace per client, a one-click rollout (the agent
  drafts the data mapping, integration and test set; a person approves every draft), a sign-off link the client opens
  without an account, and deployment metrics: engineer hours per rollout and how much the agent drafted.

Every action goes into a hash-chained audit log. For legal and compliance there is an evidence pack (checks, fixes with
before and after, live results, the audit chain) and an optional public page that states only dated facts.

## How Meta's models are used

Muse Spark (`muse-spark-1.3`, Meta Model API, structured JSON output with strict schemas) does the reasoning work:

1. **Red-teaming from policy** (reasoning effort high): reads the company's documents, extracts the rules with clause
   citations and writes adversarial messages per rule, aimed at boundaries, pressure and missing tools. The wording and
   focus follow what the agent does, for example discounts beyond policy for a sales AI.
2. **Clause-grounded judging** (effort medium): judges each answer against one quoted clause and writes the smallest
   fix, so every verdict cites where the rule comes from.
3. **Fixing**: drafts one change to the AI's instructions for the broken rules, and names the rules that need a
   capability (a refund tool, a hand-off) rather than more words.
4. **Live judging and the inline guard**: checks real exchanges after launch, and checks a reply before it is sent,
   writing a safe reply that keeps every rule.
5. **Drafting the rollout**: data mapping, integration config, test cases from past tickets and the launch report, each
   as a reviewable draft.

Delomu has a second provider (Claude), chosen by configuration. With the Meta provider selected, every job above runs
on Muse Spark, including live monitoring and the guard. Customer material is wrapped and treated as data
(prompt-injection guard), personal data is scrubbed before anything live is stored or judged, contributor models that
allow training on sent data are refused in code, and phrase checks are limited to exact tokens so the judge decides on
meaning.

## What was built during the hackathon

Everything in this repository was built between Oct 31 and Nov 4, 2026; the git history shows every step. The
founder's earlier, different product (an agent-action verification API) is not part of this repository or demo.

- **The check** (the demo's focus): policy → rules with clauses → adversarial messages → live answers →
  clause-grounded verdicts and fixes, shown as a rule map
- The fix loop: drafted instructions, human approval, apply, re-check on the same messages, undo
- Live monitoring with Slack alerts, the inline guard API, and re-checks when policies change
- AI vendor workspaces: a workspace per client billed to the vendor, one-click rollout, client sign-off, deployment
  metrics
- The agent for rollout steps 1–5 with human review of every draft, and the tamper-evident audit log
- Evidence pack and public page; agent kinds (support, sales, billing, HR)
- Meta Model API provider with strict structured output, retries and refusal handling; an OpenAI-compatible connection
  alongside Intercom, Zendesk and HTTP
- Multi-tenant server: organizations, roles, API keys, OIDC single sign-on, self-serve sign-up, Stripe billing, Docker
- De-identified, consented knowledge library that reuses test cases across rollouts
- 230+ automated tests

Built by a solo student founder working with an AI coding assistant. The demo video was edited in Clueso and its
narration is a synthetic voice (ElevenLabs, via Clueso); every screen in it is the real product. It was recorded before
the last day's redesign, so the live app looks newer than the video. All results shown are from a made-up sample
company, not from real customers.

## Team

Alexander Ko (solo).
