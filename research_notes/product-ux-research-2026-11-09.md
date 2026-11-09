# Product UX research: competitors and best-in-class moments (2026-11-09)

This note covers what `unicorn-product-bar.md` (Linear, Stripe, Vercel, Sierra, Loom: first value, main screen, empty states, external sharing, polish) and `competitive-landscape-2026-11.md` (funding and positioning) do not. It focuses on concrete UI at six moments plus motion. `reports/unicorn-walk/gaps.md` lists what has already been fixed, and none of it is repeated here.

**Method and limits**
- Every bullet cites a page that was actually fetched on 2026-11-09. *(secondary)* marks third-party or search-snippet sources.
- The Mobbin screen library was unavailable ("requires a paid plan"), so no real app screenshots were inspected. Everything here comes from vendor docs, changelogs and product pages.
- Several competitors publish almost no UI. Hamming's docs are behind an access code. Cekura's and Bluejay's public pages describe features, not screens. Decagon's posts are prose without captions.
- Patronus's docs say: "The LLM evaluation platform documented on this site is retired and no longer offered." https://docs.patronus.ai/docs/percival/debugging_overview. It is excluded from patterns.
- I found no published animation timings for Linear, Arc, Attio or Retool. The motion section uses what is published by Vercel, Atlassian, and practitioners who worked on Vercel and Linear.

---

## 0. Competitor product UI: what is actually visible

| Product | What its public material shows of the UI | Source |
|---|---|---|
| **Hamming** | Product-page figures with real headers. "Release 2.4 · 1,240 calls · 50 failed". Failing calls carry condition tags ("Interrupter", "Speakerphone", "TV in background"). One failure is shown as the agent's line next to the outcome: "You're booked for Tuesday at 3." → "nothing was booked". Version compare: "v2.4 → v2.5 · same 1,240 scenarios" with rows such as "fail → pass" and "pass → fail", plus the gate "Switch blocked until the regression passes". The test-generation header reads "From your prompt · 186 scenarios" and ends "+183 more from the rest of the prompt". | https://hamming.ai/product/automated-testing |
| Hamming | Security table: "Audit: Full audit trail, exportable to your SIEM". CI row: "deploys that fail the quality gate are blocked". | https://hamming.ai/why-hamming |
| Hamming | Per-agent "Trends" section: Latency p50/p90, Call duration (avg/min/max), Scoring metrics. Dashboards link back to replayable traces. No per-customer view is mentioned. | https://hamming.ai/blog/call-analytics-voice-agent-testing |
| Hamming *(secondary, FAQ snippet)* | Test results can be exported as a PDF, which is emailed to you. | https://eu.hamming.ai/faqs |
| **Coval** | The run results page is a table with one row per simulated conversation and one column per metric. **Resimulate** overwrites a result, so launch a new run to keep the old one for comparison. Transcripts collapse extra tool calls behind "+N more". | https://docs.coval.ai/concepts/simulations/overview.md |
| Coval | The run view flags a run that used an older resource version. Scheduled runs use **Launch ▾ → Schedule** (interval or time of day). Each schedule's page lists every run it launched, with per-metric results. | https://docs.coval.ai/concepts/runs/overview.md |
| Coval | Observability: "New Dashboard Widget" with "Graph Type" and "Filter by" Agent / Persona / Metadata / Custom. Out-of-bounds periods are shaded as a fail zone. "One-click monitors" create a threshold-based alert. Failures are grouped into categories (truncation, off-script, escalation, compliance gaps). The page shows Sierra, Decagon and Parloa compared on the same metrics, so Coval sells to the *buyer* of those agents. | https://www.coval.ai/products/observability |
| Coval *(search snippet of docs)* | Monitoring lets you "Add to Test Sets: Convert production issues into regression tests". | https://docs.coval.dev/concepts/monitoring/overview |
| **Cekura** | Docs describe a workflow ("Select, Run, and Wait for Results"), "Transcript analysis" and "Conversation flow validation". No result-screen detail is public. | https://docs.cekura.ai/documentation/guides/testing-agents/overview.md |
| **Bluejay** | Homepage pillars "Test / Monitor / Improve" and stat counters. No result screens are shown. | https://getbluejay.ai |
| **Braintrust** | Most detailed public UI of the set; patterns are in sections 1 and 3. Also: built-in table views "Non-errors", "Errors", "Scorer errors", "Unreviewed", "Assigned to me". | https://docs.braintrust.dev/guides/evals/interpret |
| **LangSmith** | Experiment compare with a source experiment and red/green rows, detailed in sections 1 and 3. Prompt Hub has a **Diff** toggle on commits. | https://docs.langchain.com/langsmith/compare-experiment-results |
| **Intercom Fin (Evals)** | Most detailed on running and pass/fail states, covered in sections 1 and 2. | https://fin.ai/help/en/articles/18227402-how-to-run-evals-and-read-the-results |
| **Decagon** | Results use "checkpoints" that show "exactly where in a conversation something went right or wrong" with severity. The platform detects outdated tests and updates or removes them, and gates releases through CI. No screen is described. | https://decagon.ai/blog/the-next-generation-of-simulations |
| Decagon | Versions are saved as commits. Optional "Git diffs", branch protections and staging. Traffic split between versions, with per-version performance and rollback. | https://decagon.ai/modules/versions |
| **Sierra Agent Studio** *(secondary)* | The Nov 2026 redesign puts Ghostwriter at the centre. New "Projects" group agents for testing and release together. Release governance adds required approvals and controlled rollouts, and Simulations can be required to pass before production. | https://www.unite.ai/?p=500107 (Unite.AI), Sierra's own short post https://sierra.ai/blog/agent-os-2-0 |

**Read-across.** None of these products shows a *client-facing* page. All of them are internal tools for the team that builds the agent. The closest is Hamming's "Reports that show the agent's accuracy and reliability, so customers trust it" (https://hamming.ai/why-hamming), but no sharing workflow is described. Grapim's no-login sign-off page has no visible counterpart in this set.

---

## 1. Test / eval results screen

1. **Compare against a baseline, show counts of what moved, and make the counts filters.** In LangSmith, each feedback column header shows how many runs did better or worse than the source experiment, and rows are highlighted red (regressed) or green (improved). Clicking a count shows only those runs. https://docs.langchain.com/langsmith/compare-experiment-results. In Braintrust, clicking a score in the column header offers "X regressions" / "X improvements", and **Order by regressions** puts the worst movers first. https://docs.braintrust.dev/evaluate/compare-experiments
2. **Grade the comparison in one word.** Braintrust's Summary table has a **Comparison grade** row reading Improvement, Regression, Tradeoff or Tie, and it highlights the best and worst experiment per row. https://docs.braintrust.dev/evaluate/compare-experiments
3. **Pass only when every check passes, with a per-check breakdown that states the expectation.** A Fin Simulation passes only if every Simulation check and Handoff check passes. The Simulation page lists Handoff (Pass/Fail plus "Expected: No handoff"), each check with its criterion and the reason it passed or failed, and an optional Scorecard. Evals in the list show a ratio: "8/10 Passed", "Partially passed". https://fin.ai/help/en/articles/18227402-how-to-run-evals-and-read-the-results
4. **"Fail" and "Error" are separate states with separate advice.** In Fin, Fail means the conversation finished but missed a check, so open the transcript and event log. Error means it couldn't complete, so re-run, then check the setup. Same source. Braintrust also separates "Errors" from "Scorer errors" as built-in views. https://docs.braintrust.dev/guides/evals/interpret
5. **Show a failure as "what the agent said → what actually happened".** Hamming's figure pairs the agent line "You're booked for Tuesday at 3." with "→ nothing was booked", and tags the condition that caused it. https://hamming.ai/product/automated-testing

Also: Fin keeps each Simulation's last 15 runs behind a run-history dropdown (Fin source above). Coval flags a run made against an older resource version (https://docs.coval.ai/concepts/runs/overview.md).

## 2. A run in progress

1. **A live count in the header, with rows resolving one by one.** Fin rows show "Queued" → "Running" (Last run "Just now") → Pass/Fail/Error. The Eval header shows a count such as "3/10 Running", and results update as each Simulation finishes. A stop button cancels the run. There is *no* completion notification. https://fin.ai/help/en/articles/18227402-how-to-run-evals-and-read-the-results
2. **A determinate bar with a real ceiling, and a named stage beside it.** Vercel Geist Progress says to use `max={files.length}`, not a hardcoded 100. Label the current stage next to the bar ("Step 2 of 4 · Building"), name the work and units ("Uploading 12 of 30 files"), and don't say "successfully" when it fills, but move to a completion state instead. Use a spinner only for 1–3 s waits. Throttle `aria-valuenow` to about once per second. https://vercel.com/geist/progress
3. **The run graph is the progress view.** In GitHub Actions, every workflow run gets a real-time graph with one node per job and a status icon. Clicking a node opens its log. https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/monitoring-workflows/using-the-visualization-graph
4. **Every line of the live log is linkable.** In Vercel build logs, clicking a timestamp gives a URL anchor (`#L6`, and `#L6-L9` with Shift). Warnings are yellow and errors red. https://vercel.com/docs/deployments/logs
5. **Loading timing rules.** Show a loader after about 150–300 ms and keep it visible for at least 300–500 ms to avoid flicker. Loading labels end with "…" ("Generating…"). A busy button keeps its original label. https://vercel.com/design/guidelines

Not found: Braintrust and LangSmith docs do not describe a row-by-row live view during an offline experiment. One third-party tutorial implies LangSmith rows fill in as evaluators finish *(secondary)*: https://theneuralbase.com/langsmith/learn/intermediate/viewing-experiment-results-in-the-ui/

## 3. Diff / before-after of a fix

1. **Three diff directions and character-level inline by default.** Braintrust's **Diff** toggle splits each test case into one sub-row per experiment. A selector offers Base → Comparison, Comparison → Base, and Expected → Output. The detail panel shows a character-level inline diff, and **Show side-by-side diffs** switches to two columns. https://docs.braintrust.dev/evaluate/compare-experiments
2. **Diff the instructions themselves, commit by commit.** LangSmith Prompt Hub has a **Diff** toggle on the commit detail page that compares a commit with its predecessor or across several commits. The changelog pitches it partly as a way to revert. https://changelog.langchain.com/announcements/diff-view-in-langsmith-s-prompt-hub, https://docs.langchain.com/langsmith/manage-prompts
3. **Pair the text diff with the behaviour diff on the *same* tests.** Hamming's "v2.4 → v2.5 · same 1,240 scenarios" shows per-scenario "fail → pass" / "pass → fail", and the next release is blocked until the regression passes. https://hamming.ai/product/automated-testing
4. **Accept a suggested change in one click, or batch several.** GitHub review suggestions offer **Commit suggestion** (one change, one commit) or **Add suggestion to batch** then **Commit suggestions** (one commit for all). https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request
5. **Ask a person which output is better.** Braintrust's **Pairwise** card asks "Which experiment is better?" (Base / Comparison) with an optional comment, aggregated as Wins / Losses. https://docs.braintrust.dev/evaluate/compare-experiments

## 4. Client-facing share / approval page

1. **A guided path through the required items, with Finish gated on all of them.** DocuSign signers click **Start**, which jumps to the first field needing action. It becomes **Next** while more fields remain, and **Finish** only completes when every required field is done, followed by a confirmation that the document is complete. *(secondary: university and vendor how-to guides)* https://support.filesanywhere.com/hc/en-us/articles/23469346076045, https://www.mabreybank.com/resources/docusign-electronic-signature/
2. **Access requests with expiry and a history.** In the Vanta Trust Center, admins **Give Access** or **Deny** from an Access requests tab, can set an expiration date, and **Request history** logs every prior decision. Requestable documents need an NDA (clickwrap or DocuSign) before viewing. https://help.vanta.com/en/articles/11345468-trust-center-ndas-clickwrap (via search result text)
3. **One message thread per request, with system messages for state changes.** In the Drata Audit Portal, each request has a thread. Drata posts a system message when evidence is attached or a status changes, and the client replies in the same thread. https://help.drata.com/en/articles/13773092-using-the-drata-audit-portal-new-experience
4. **The external party first sees a list of what is open, with status and "Last activity".** The Drata auditor's request pane shows status (New, In progress, Completed, with "Needs more info" as a filter), assignee and Last activity. Same source.
5. **Approval requests reach reviewers where they are, not only in the app.** LaunchDarkly sends approval requests through the **Approvals** dashboard, email, the in-app inbox, and Slack or Teams. Flags show a "Pending changes" panel. https://launchdarkly.com/docs/home/releases/approvals (the reviewer-screen page returned 404, so no diff layout was confirmed)

## 5. Multi-customer overview

1. **A fixed set of status badges with a reason on hover, and a tab per status.** Stripe Connect accounts are labelled Restricted, Restricted soon, In review, Enabled or Rejected. Hovering a badge gives context, and status tabs group the accounts. "Restricted soon" means requirements are due by an upcoming date, so the badge warns *before* the failure. https://docs.stripe.com/connect/dashboard
2. **An "Actions required" list at the top of each account.** On the Stripe Connect account details page, what is needed to re-enable the account comes first. Same source.
3. **One cross-account health view, scoped to what you manage.** Drata's MIM Dashboard gives MSSPs and vCISOs "a centralized view of compliance health across all your accounts", scoped to their assignments. Per-account readiness is a percentage of controls ready, and frameworks at 0% are hidden. https://help.drata.com/en/articles/9677750-mim-dashboard (search result text), https://help.drata.com/en/articles/13259515-dashboard-overview
4. **Projects group related agents to test and release together.** Sierra Agent Studio's Nov 2026 redesign *(secondary)*. https://www.unite.ai/?p=500107
5. **Filter one dashboard by agent, persona or custom field, and drill from a data point to the conversation.** https://www.coval.ai/products/observability. Coval describes no dedicated per-customer view, and neither does Hamming.

## 6. Audit / evidence export

1. **Packages are snapshots, and the UI says when they were frozen.** Drata's "Download pre-audit package" is fixed when the audit opens. "Download control evidence" is fixed when samples are first set, and new evidence requires regenerating. The ZIP is prepared in the background, with an email when it's ready and a copy kept in the portal. **View past downloads** keeps earlier packages. https://help.drata.com/en/articles/13773092-using-the-drata-audit-portal-new-experience, *(search text)* https://help.drata.com/en/articles/14670641-section-5-drata-for-auditors
2. **Export from the summary itself.** Braintrust puts a **Download as PDF** icon in the Summary table header, plus CSV/JSON export (capped at 1,000 rows in the UI) and a public/private **Share** toggle. https://docs.braintrust.dev/evaluate/compare-experiments
3. **A machine-readable audit trail.** Hamming lists "Full audit trail, exportable to your SIEM". https://hamming.ai/why-hamming. Fin batch tests export to CSV. https://fin.ai/help/en/articles/14077180-simulations-vs-batch-tests-vs-previews
4. **Read-only access is the customer's choice.** Drata auditors can be granted "Read-only access" to browse beyond the audit, but cannot edit, upload or delete. https://help.drata.com/en/articles/15266741-what-auditors-can-see-in-audit-hub-new-experience (search result text)
5. **Redact secrets and say so.** Vercel replaces long secret values in logs with `[REDACTED]` and records an Activity Log event for each masked key. https://vercel.com/docs/deployments/logs

---

## 7. Motion: durations, easings, where it is and isn't used

**Published numbers**
- **Atlassian** (the only first-party source with full tokens): interactions 50–150 ms (list hover 50 ms), transitions 150–400 ms (dropdown 150 ms, modal 250 ms). Exits are faster than entrances, and larger elements take longer. Easings:
  - Ease-out bold `cubic-bezier(0, 0.4, 0, 1)` for panels entering
  - Ease-in-out bold `cubic-bezier(0.4, 0, 0, 1)` for repositioning
  - Ease-in practical `cubic-bezier(0.6, 0, 0.8, 0.6)` for exits
  - Ease-out practical `cubic-bezier(0.4, 1, 0.6, 1)` for popups

  High-frequency motion stays under 150 ms, and expressive motion is kept for first-run and milestones. Avoid motion when removing it loses no information, when it makes users wait, or when several elements move at once. https://atlassian.design/foundations/motion
- **Vercel Web Interface Guidelines:**
  - Animate only when it clarifies cause and effect.
  - Animate only `transform` and `opacity`, never `transition: all`.
  - Motion must be interruptible by user input and anchored to its physical origin.
  - Provide a reduced-motion variant.
  - The guidelines give no durations.

  https://vercel.com/design/guidelines
- **Emil Kowalski** (Vercel design engineer, author of Sonner): keep animations under 300 ms, default to ease-out, and don't animate keyboard-initiated or high-frequency actions. "Raycast has no animations" and it feels right. A Vercel dashboard tab animation dropped frames during page loads until it was moved to CSS. https://emilkowal.ski/ui/great-animations
- **Rauno Freiberg** (Vercel): command menus and context menus appear without animation, and the macOS App Switcher never animates. He removed motion from core interactions in his own tool after a few days because it felt sluggish. The exception is a selected menu item that briefly blinks its accent to confirm. https://rauno.me/craft/interaction-design

**Where these products use motion:**
- state change of a single thing: Vercel's Status Dot animates only while in flight (already in `unicorn-product-bar.md`)
- confirmation blinks
- overlays entering and leaving
- first-run and milestone moments (Atlassian)

**Where they don't:**
- page navigation in frequent-use tools
- command menus
- keyboard actions
- multiple elements at once

**Not found:** published ms or easing values for Linear, Stripe's dashboard, Arc, Attio or Retool. Stripe's 2014 Checkout animation post exists only on Medium and was not fetched in full (https://medium.com/bridge-collection/3d1b0a9b810e).

**Grapim today** (`src/v3/html.mjs` lines 284–292):
- Every page's `.content>*` children "rise" over .34 s with stagger delays up to .12 s, so every navigation animates.
- Running and current steps pulse continuously (`pulse 2s infinite`).
- Buttons scale to .97 on press, and menus pop in at .14 s.
- Reduced motion is respected.

The page-load stagger runs against all four sources above for a tool used every day. The landing and verdict moments (`.pt.new`, `.ex-verdict` stamp) are the kind of motion they endorse.

---

## What Grapim should build in its own way

Ranked by what a deployment lead would notice in a 3-minute demo. Each change is Grapim's own version of a pattern, not a copy.

1. **Check result page: lead with "before → after" on the same test messages.** Replace the current kept/broken list header with one line in the form "Policy v3 instructions → fixed instructions · same 24 test messages". Under it, the moved rules show as "broken → kept" (and any "kept → broken" first, in red). Clicking a count filters to those rules. *Why:* this is the moment the product proves itself, and today it is spread over the check page, fix and re-check. *From:* Hamming's "v2.4 → v2.5 · same 1,240 scenarios", LangSmith and Braintrust clickable improvement/regression counts, Braintrust's one-word comparison grade.
2. **Check in progress: rows resolve live under a counted header.** Show "Judging answers · 9 of 24" with the real total. Each test-message row moves Queued → Running → Kept/Broken/Error as it lands, and only the running row animates. In step 1 ("Reading your policies", ~70 s, gap #8 not fixed), list each rule as it is extracted, with its clause number. *Why:* 104–110 s of a bar is the longest dead time in the demo. *From:* Fin's "3/10 Running" with per-row states, Geist Progress (real `max`, named stage, no "successfully"), Vercel's Status Dot.
3. **Fix review: an instruction diff tied to the rules it repairs.** Show the drafted fix as a word-level inline diff of the agent's instructions, with a side-by-side toggle. Label each changed passage with the broken rule and clause it addresses. Offer "Apply all fixes" plus per-rule apply. *Why:* a lead won't apply a fix they can't read, and tying text to rule is something general eval tools can't do. *From:* Braintrust inline/side-by-side diff, LangSmith prompt commit Diff, GitHub "Commit suggestion" / "Add suggestion to batch".
4. **One honest failure card per broken rule.** Show what the policy clause says ("Expected: hand off above $1,000"), what the agent said, and what actually happened ("→ no hand-off"), with the test message that triggered it. *Why:* it shows in a single glance why Grapim's judge is credible. *From:* Fin's per-check "Expected:" plus reason, Hamming's "You're booked… → nothing was booked".
5. **Separate "Error" from "Broken" everywhere.** When the agent endpoint timed out or the judge couldn't decide, show **Error** with "Re-run this message" and the setup to check, not a red rule. *Why:* a timeout shown as a broken rule in front of a client is the worst demo failure. *From:* Fin's Fail vs Error advice, Braintrust's separate "Errors" and "Scorer errors" views.
6. **Sign-off link gated by the check, in words.** On the Rollout and check pages, the sign-off action reads "Sign-off link blocked until rule 4.2 is kept" while anything is broken. *Why:* it makes the release gate visible, which is the governance story buyers ask for. *From:* Hamming's "Switch blocked until the regression passes", Sierra's required simulations before production, Decagon's CI gates.
7. **Client sign-off page: a guided Start → Next → Sign path.** Count the items needing review ("3 rules to review"). Step through them one at a time, each with a "Looks right" / "Ask a question" choice. Enable the final sign-off only when all are reviewed, then show a plain confirmation. Questions go into one thread per rule, where Grapim adds system lines ("Fix applied", "Re-checked: kept"). *Why:* the client is not a power user, so a guided path is faster than a long report. *From:* DocuSign's Start/Next/Finish, Drata's per-request thread with system messages.
8. **Home: a fixed set of client status badges with tabs and a reason on hover.** Use one word per client, for example "Rule broken", "Policy changed since check", "Waiting on client", "Sign-off due soon", "Signed off". Each has a status tab with a count, and each client page opens with an "Actions required" list. *Why:* the multi-client view is what differentiates Grapim from single-agent tools, which have no per-customer view. *From:* Stripe Connect's Restricted / Restricted soon / In review / Enabled with hover context and "Actions required", and Drata's MIM cross-account health.
9. **Evidence pack: label it as a snapshot and keep past packs.** Header: "Snapshot taken at sign-off, 9 Nov 2026 14:02 · agent version · policy version". Add "Download PDF" in the summary header, "Past packs" below it, and a CSV of the audit trail. *Why:* auditors and procurement ask "as of when?", and a snapshot answers it. *From:* Drata's frozen packages and View past downloads, Braintrust's Download-as-PDF in the summary header, Hamming's SIEM-exportable audit trail.
10. **Run history per client, with stale runs flagged.** Add a "Previous checks" dropdown on the check page. Any result run against an older policy or agent version gets a flag: "Ran on policy v3, now v4: re-check". *Why:* it keeps the lead from showing a client an out-of-date pass. *From:* Fin's last-15-runs dropdown, Coval's flag for runs made on an older resource version.
11. **Live monitoring: "Add to tests" on any flagged live conversation.** One button turns the conversation's customer message into a test message for that client's next check. *Why:* it closes the loop from production back to sign-off in one click, which is visible in a demo. *From:* Coval's "Add to Test Sets".
12. **Motion: stop animating every page and spend motion on verdicts.** Remove the `.content>*` rise and stagger on navigation, keeping it for the first-run wizard and the sample walk only. Animate only:
    - a result row landing (≤200 ms, ease-out)
    - the final verdict and the "2 → 0 rules broken" change
    - menus (enter about 150 ms, exit faster)

    Replace the infinite `pulse` on current steps with a dot that animates only while work is actually running. Keep press feedback and reduced-motion handling. *Why:* in a demo, everything moving on every click reads as a template, while motion only at verdicts points attention at the result. *From:* Atlassian tokens and "under 150 ms for frequent", Vercel guidelines, Kowalski and Freiberg on not animating frequent actions, Vercel's Status Dot.
