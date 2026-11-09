# Grapim vs. the unicorn bar: top 10 gaps (2026-11-09)

Walked as a brand-new AI vendor on a local server with a real model (`grapim-capture`, port 8799), twice, with
`.impeccable/walk.mjs`: sign-up → `/welcome` → sample agent → first check → (fix) → rollout → sign-off link →
client sign-off page → handover → questionnaire → settings → live. Screenshots: `before/` and `after/`
(desktop/phone × light/dark). Principles from `research_notes/unicorn-product-bar.md` are cited as P1–P12.

Ranked by harm to a vendor's first 10 minutes or to their trust in showing Grapim to a client.

| # | Gap (what the walk showed) | Principle | Status |
|---|---|---|---|
| 1 | With a real model the sample agent kept **all 8 rules** in both walks, so a new vendor never saw a broken rule, a drafted fix, approve or re-check: the core value never appears. | P1 real work in the first session | **Fixed** `69b05bb` — the sample agent runs on the store's previous policy (v3), so the 1-hour cancel and $1,000 hand-off rules break, and a drafted fix closes them |
| 2 | The client's sign-off page put the decision **~1,800 px down**, under the full handover detail; it did not say who sent the link; "Northwind Agents**’s**". | P7 name the sender and the ask above the fold | **Fixed** `aad3916` — heading, verdict, Decide / report / handover buttons, then the decision; "Sent by …"; possessives fixed on sign-off, handover, questionnaire |
| 3 | After sending the link the vendor could not tell whether the client had **opened** it; a revoked or expired link was a bare **404**. | P8 links never dead-end, P9 sender sees what happened | **Fixed** `28f4546` — Opened 5 min ago / Not opened yet (link-preview bots ignored); closed links answer 410 with what happened and who to ask |
| 4 | A passing check page **ended with no next step**; the sign-off lived two tabs away, and the Rollout panel said "Send the client a link once the check passes" although it had passed. | P3 one "needs you" next action, P5 land on the result | **Fixed** `74f8144` + `28f4546` — "Ready for sign-off" panel on the check page; state-aware sign-off copy |
| 5 | The once-shown link sat in a read-only field with **no Copy** button; the "Handover for the client" button wrapped onto its own full-width row in the panel head. | P12 copy confirmations, polish | **Fixed** `28f4546` — Copy → "Copied" (appears only with JS; the field selects itself on focus), header button fixed |
| 6 | Home "Waiting for your decision" leaked internals: "Test cases for **sample-linden-agent** · **Risk scan 2026-11-09T09-46-00-474Z-29b7**: … **probes** …". | P4 status in words | **Fixed** `249f50c` — agent title, "From the check on 2026-11-09: …", "test messages" |
| 7 | Wizard step 4 was a bare "Run the check": after "Try it on a sample agent" the policy step was skipped silently, and the client typed as "Harbor Bank" became "Linden & Co." with no word why. | P2 one question per screen, with context | **Fixed** `be1d9b1` — shows agent, endpoint and policy files, and that the sample is a made-up store on an older policy |
| 8 | "About a minute" — the first check took **104–110 s**, ~70 s of it on one "Reading your policies" bar. | P5 honest progress | **Copy fixed** `be1d9b1` ("about two minutes"). Not fixed: step 1 still shows no intermediate output (e.g. rules as they are read) |
| 9 | Phone: the six Rollout steps stayed in **3 columns at 390 px**, wrapping labels per word and clipping "Monitoring". | P12 | **Fixed** `f396e88` |
| 10 | Rollout says "1 of 6 steps done · Test and fix: Not run yet" right after a full check ran; the six-step Rollout and the four-step wizard/check use different vocabularies for the same progress. | P3, P4 | **Not fixed** — needs a decision on whether the Rollout steps should count the policy check; follow-up |

Also seen, smaller: the "Kept" list repeats the rule map directly above it; the sidebar shows the client
("Harbor Bank (sample)") while the agent header shows "Linden & Co. (sample)" for the sample; there is no
command menu or keyboard shortcut list (P12), which matters less for a weekly-use tool.
