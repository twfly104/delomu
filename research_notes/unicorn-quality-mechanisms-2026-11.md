# How the leading AI agent companies check and maintain their agents (2026-11-09)

This note covers the concrete quality mechanisms: what each company tests, where its test cases come from, how it decides pass or fail, when the tests run, what they block or alert on, and how it handles judge errors and flaky results. It does not repeat positioning, funding or threat analysis (`competitive-landscape-2026-11.md`), screen patterns (`product-ux-research-2026-11-09.md`), or the academic basis for pass^k, juries and agreement metrics (`technical-basis-2026-11-09.md`). Where a mechanism below backs a change already ranked in those notes, it says so and adds only the new detail.

**Method and limits**
- Every source was opened on 2026-11-09 unless it is marked. *(snippet)* means the claim comes from search-result text because the page itself could not be read: developer.salesforce.com and openai.com returned 403, and Ada's Testing at Scale page returned 404. *(secondary)* means a third-party source. *(vendor claim)* means a number the vendor reports about itself.
- Vendors publish what they test much more often than how they judge. Almost none describe how they handle judge errors or flaky results. Where a page is silent, this note says "not described" rather than guessing.
- Grapim facts come from the code in this repo as of commit `e5b4ddc`.

---

## 0. What the leaders converged on

1. **Assertions on actions, not only words.** Every platform with a test product checks tool calls in code: Fin's data-connector criteria, PolyAI's "system actions", Google's tool-call expectations, Agentforce's expected actions plus JSONPath checks, Cresta's Tool Match and Coval's API State. Cresta reports that adding a Tool Match check cut one customer's pass rate from 94% to 71%, because the LLM judge had inferred an action from the conversation. Grapim's judge reads actions as text, and only when the target reports them.
2. **A judge is calibrated before its verdicts count.** Cresta reports F1 per requirement and promotes an evaluator only once its verdicts stabilize. Coval and LangSmith re-run a revised judge on the same human-labelled set. Fin, Decagon and Cekura dry-run a monitor or metric on real past conversations before switching it on.
3. **Test state is controlled.** Fin, Google, Decagon and Sierra run tests against mocked tools, fixed records and, in Fin's case, a set date. A boundary case such as "day 31 of a 30-day window" therefore always exists.
4. **Multi-turn is the default unit.** Every company in this set simulates whole conversations. Only Ada's bulk tester and Fin's retiring batch test are single-turn.
5. **Gates count must-pass items.** A single failed check fails the test at Fin. Cresta separates must-have from nice-to-have failures, so that "a high overall pass rate can't hide blocking failures". PolyAI, Sierra and Decagon gate releases in CI.
6. **"Not applicable" is a separate state.** Coval labels Yes/No/N/A. Cekura runs a metric only when its trigger fires. Google returns -1 when no goal is set. Grapim folds "never reached the rule" into "kept".
7. **Production failures become tests**, and live monitoring covers every conversation, with criteria written in natural language. Grapim already has both.

---

## 1. Company by company

Each company gets six fields: **Tested** (what the test covers), **Cases from** (where test cases come from), **Judged** (how pass or fail is decided), **When** (when tests run), **Gates/alerts** (what results block or alert on), and **Judge errors and flakiness**.

### Sierra
Sources:
- [sim] https://sierra.ai/blog/simulations-the-secret-behind-every-great-agent (Sachi Shah, 19 Aug 2025)
- [voice] https://sierra.ai/blog/how-voice-sims-work (Kumar Pandya, 23 Sep 2025)
- [conf] https://sierra.ai/blog/confidence-in-every-conversation (29 Oct 2025)
- [ent] https://sierra.ai/blog/enterprise-grade-agents (Thiaga Rajan, 2 Oct 2025)
- [adlc] https://sierra.ai/blog/agent-development-life-cycle (Bavor and Taylor, 3 Jun 2024)
- [ship] https://sierra.ai/blog/shipping-and-scaling-ai-agents (25 Jul 2024)
- [gw] https://sierra.ai/blog/redesigning-agent-studio-around-ghostwriter (2 Nov 2026)
- [tvoice] https://arxiv.org/abs/2603.13686 (τ-Voice, 14 Mar 2026)

- **Tested:**
  - Multi-turn conversations with mock personas that vary language, comfort with technology and tone. User context is set up front, such as being logged in or having an email on file [sim].
  - Voice: a simulated call loop and the agent's voice loop exchange audio. Personas have a goal, mood, language and patience, with background noise and DTMF tones. Silence, interruptions and overlapping speech are tracked [voice].
  - Snapshots of real conversations "simulated against mock APIs" [adlc].
- **Cases from:**
  - Generated automatically when an agent is created, from SOPs, knowledge bases, historical coaching transcripts and conversation flows [sim]. Voice cases can also come from past transcripts [voice].
  - Every conversation that reviewers annotate as wrong becomes a test [adlc][ship].
- **Judged:**
  - A separate agent acts as an "independent judge". It checks whether the user reached their goal, whether the SOP was followed, whether the agent stayed on brand, and whether answers were accurate, helpful and clear [sim].
  - Voice uses an LLM judge against defined success criteria, giving pass or fail [voice].
  - These posts describe no code-level tool or state assertion. The τ-bench lineage grades final state (see technical-basis). τ-Voice extends τ²-bench to full-duplex voice with a controllable voice user simulator (accents, noise, turn-taking) "decoupled from wall-clock time". It reports voice agents at 31–51% task success in clean conditions and 26–38% in realistic ones [tvoice].
- **When:**
  - Before any journey change is published. Also in CI/CD through GitHub Actions or the CLI [sim].
  - "thousands of conversation tests … prior to every agent release" [adlc].
  - On a platform upgrade, Sierra runs the regression suite "for every one of our live customers" [adlc].
  - Customers run more than 35,000 tests a day *(vendor claim)* [sim].
- **Gates/alerts:**
  - Releases are gated "just like unit tests" [sim].
  - Release governance adds "required approvals and controlled rollouts". Changes stay in a session until someone reviews and merges them, with a line-by-line diff [gw].
  - Releases are immutable snapshots of code, prompts, model version and knowledge, allowing instant rollback and A/B tests between releases [adlc].
  - At runtime:
    - Supervisors run alongside every response and switch from observing to intercepting on high-risk topics. When a correction would change the meaning too much or add too much latency, they escalate or end the conversation [ent][conf].
    - A dedicated supervisor screens user input for "multi-turn context poisoning" and jailbreaks [ent].
    - Monitors, written in natural language, review every conversation. The defaults are coherence, repetitiveness, grounding in fact and sentiment [conf].
- **Judge errors and flakiness:**
  - Not described. Simulations "can be run multiple times" [sim].
  - Defect logging pairs "fast, high-recall detection with slower, high-precision reasoning" [ent].
  - Instructions have tiers of tolerance: adversarial inputs and sensitive topics get the least [ent].
  - People formally review samples of conversations every day, sample by tag as volume grows, and hold a weekly review with Sierra [adlc][ship].

### Decagon
Sources:
- [sim25] https://decagon.ai/blog/decagon-simulations (Bihan Jiang, 23 Sep 2025)
- [sim26] https://decagon.ai/blog/the-next-generation-of-simulations (Eric Hermann, 30 Jun 2026)
- [tdd] https://decagon.ai/blog/the-future-of-ai-agents-is-test-driven (23 Jul 2025)
- [eval] https://decagon.ai/blog/evaluation-engine-ai-agents (Max Lu, Jul 2025)
- [wt] https://decagon.ai/blog/decagon-watchtower (25 Jun 2025)
- [wtqa] https://decagon.ai/modules/watchtower-qa
- [ver] https://decagon.ai/modules/versions

- **Tested:**
  - AOP selection and execution, knowledge retrieval, and guardrails and tone [sim25].
  - Users set the metadata, tool outputs and conversation length [sim25].
  - Voice conditions include accents, speed, noise, interruptions and emotional tone [sim25].
  - "Unit tests" check responses; "integration tests" check that the agent calls the right tools and takes the right actions [tdd].
- **Cases from:**
  - Uploaded transcripts where AI or human agents struggled. Personas and intents are generated automatically from those failure modes [sim25].
  - Duet generates tests "directly from AOPs and production conversations", such as 50+ tests for one new AOP [sim26].
- **Judged:**
  - Against user-defined expected behavior, giving pass/fail "with full traceability" [sim25].
  - Each simulation is staged with checkpoints and a severity per issue. Assertions guide the evaluation "with built-in flexibility rather than … a rigid checklist" [sim26].
  - Offline, an LLM judge scores query/context/response triplets for relevance, correctness, naturalness and empathy. Human labelers audit a subset to validate those scores. A ground-truth set of ideal answers written by experts tests factuality and intent coverage [eval].
- **When:**
  - Before go-live, after launch, and before major AOP or knowledge updates [sim25].
  - Scheduled runs catch "regressions or subtle drift" [tdd].
  - CI/CD: every agent version is tested before it merges, moving from branch to staging to production [sim26].
- **Gates/alerts:**
  - A variant must show "consistent performance offline before it is eligible for online testing". After that, traffic ramps gradually and is measured on CSAT and resolution rate [eval].
  - Versions split traffic. A version rolls out fully only when results are "positive and statistically significant" and rolls back otherwise. Branch protections and staging are optional [ver].
  - Watchtower reviews every conversation against plain-language criteria [wt]. Its rubrics score flagged conversations, and audit logs surface cases such as "a refund tool being called without a refund being issued" [wtqa].
- **Judge errors and flakiness:**
  - Runs are repeated "to check consistency" [sim25].
  - Outdated tests are detected and updated or removed automatically [sim26].
  - "Test Watchtower" runs a configuration "on a small sample of conversations" before scaling, and flag rules should include positive and negative examples [wtqa].
  - The team monitors A/B results "for noise, novelty effects, and performance drift" [eval].

### Fin (Intercom)
Sources:
- [proc] https://www.intercom.com/help/en/articles/12599517-run-simulations-for-fin-procedures
- [evals] https://fin.ai/help/en/articles/18227402-how-to-run-evals-and-read-the-results
- [cmp] https://www.intercom.com/help/en/articles/14077180-simulations-vs-batch-tests-vs-previews
- [er] https://www.intercom.com/blog/announcing-evals-and-releases/ (Brian Donohue, 13 Aug 2026)
- [crit] https://fin.ai/help/en/articles/14183781-how-to-write-effective-monitor-scorecard-criteria
- [fix] https://www.intercom.com/help/en/articles/16295106-using-monitors-to-find-and-fix-fin-answer-issues
- [mon] *(snippet)* https://intercom.com/help/en/articles/13584513-monitors-explained and https://www.intercom.com/help/en/articles/14170917-how-to-create-a-monitor
- [cxf] *(secondary)* https://cxfoundation.com/news/fin-intercom-monitors (24 Mar 2026)

- **Tested:**
  - Procedure Simulations run one Procedure end to end. Intent matching is bypassed: they "assume the Procedure has already been triggered" [proc].
  - Evals run multi-turn conversations across Fin's whole configuration, at up to 50 Simulations per Eval [cmp].
  - Batch tests were single-turn, rated by hand as Good/Acceptable/Poor. New workspaces won't see them from 5 Nov 2026 and use Evals instead [cmp].
- **Cases from:**
  - AI-suggested starter scenarios built from the Procedure's instructions [proc].
  - Created by hand, uploaded from existing conversations, or generated from real inbox conversations. A conversation that a Monitor flags becomes a Simulation in the relevant Eval [er].
- **Judged:**
  - Criteria come in four types: Fin reply, Attributes (set / equals), Data connector (triggered, not triggered, or triggered exactly n times) and Instruction outcome (finish / handoff / switch Procedure) [proc].
  - "Scoring combines deterministic checks with an LLM judge". If any criterion fails, the Simulation fails [er][evals].
  - With no checks configured, the default is a pass only if Fin resolved the conversation without a handoff [evals].
  - Fail and Error are separate states: Error means the conversation could not complete [evals].
- **When:**
  - "Run Simulations before every publish" [proc]. Evals can run against a Release before it publishes [er].
  - Scheduling goes through an Operator Routine [evals]. Runs come from a monthly allowance of 250–12,500 [proc].
- **Gates/alerts:**
  - Releases isolate changes. Rollout options are publish, ramp, or A/B against current Fin. A rollout can be paused, and a whole release rolled back in one step [er].
  - Running Evals is "strongly recommended" but not required to merge *(snippet; search result for the Releases help article)*.
  - Monitors combine natural-language flag criteria with structured filters, and can backfill up to 90 days [mon]. Scorecards are scored by AI, by a person, or both, and "auto-review" passes conversations that meet every AI-evaluated criterion [mon].
  - Real-time alerts below thresholds *(secondary)* [cxf].
- **Judge errors and flakiness:**
  - On Save, Fin "uses AI to review your simulation form" and flags unclear or inconsistent criteria [proc].
  - Over-rigid criteria fail conversations that actually solved the problem, so test outcomes, not intermediate steps [proc][cmp].
  - "Test Monitor" runs criteria against real conversations before saving, with a "Refine wording" helper [mon][crit].
  - Scorecard criteria compete: the AI "selects the single best match for each criteria", so values need clear boundaries [crit].
  - Each Simulation keeps its last 15 runs [evals]. Repeat-run variance is not described.
  - Issues found in reviews are tracked "from submission through to resolution" [fix].

### Cresta
Sources:
- [c2] https://cresta.com/blog/introducing-ai-agent-testing-2-0-confidence-at-launch-confidence-at-scale (Ping Wu, 4 Jun 2026)
- [grade] https://cresta.com/blog/how-cresta-grades-its-agents-evaluators-in-an-llm-world (Lillian Zhao and Renjie Li, 3 Aug 2026)
- [c1] https://cresta.com/blog/cresta-launches-automated-ai-agent-testing-confidence-in-every-conversation (30 Sep 2025)

Cresta publishes the most mechanism detail in this set, and it is the closest to Grapim.

- **Tested:**
  - Transcripts from manual tests, reproduced real conversations, or LLM simulations.
  - Evaluation covers both the trajectory (reasoning, tool calls, procedure) and the final outcome [grade].
- **Cases from:**
  - Requirements are drafted "from PRDs, CSVs, or existing documentation".
  - A one-click diagnosis flags requirements that are hard to verify, combine several parameters, or need context the agent can't see. Domain experts then approve each requirement [c2].
  - Tests are generated from requirement violations in closed production conversations, from reviewer feedback, from knowledge-base articles, and from frequent questions [c2].
  - Synthetic customers are built from historical conversations [c2][grade].
- **Judged:**
  - Every requirement is binary and tagged must-have or nice-to-have [c2].
  - Each requirement becomes an LLM evaluator that gets the transcript and one yes/no question. The "intern test" asks whether someone with no context, reading only the transcript, would reach the same verdict [grade].
  - Claim-based evaluators come in three kinds: Completeness (no missing required claims), Accuracy (no unapproved claims), and both [grade][c2].
  - Deterministic checks: Tool Match, Article Match, Variable Match and Action Match [grade].
  - "The same evaluator runs on test conversations and production traffic" [c2].
- **When:**
  - Before launch through simulations [grade]. Checks run "before every AI Agent deployment or update" [c1].
  - A newly generated test can run at once to confirm a fix [c2]. No CI gate is described.
- **Gates/alerts:** Results are reported per requirement, with must-have failures separated so that "a high overall pass rate can't hide blocking failures" [c2].
- **Judge errors and flakiness:**
  - Calibration: reviewers label a sample, and each requirement gets an F1 score. After a requirement is refined, it is re-run on the same labelled set [c2]. Evaluators are promoted to the full suite only after verdicts stabilize and match the team's judgment [grade].
  - Simulators replay the same conversation "dozens of times" to measure variance [grade].
  - Field examples [grade]:
    - A judge that couldn't see a date-of-birth tool call gave false negatives. The fix paired it with Tool Match.
    - A judge inferred authentication from context. Adding Tool Match dropped the pass rate from 94% to 71%.

### Parloa
Sources:
- [de] https://www.parloa.com/de/ressourcen/blog/optimiere-ai-agents-vor-dem-praxiseinsatz-mit-simulationstests/ (16 Jul 2025, German; quotes translated)
- [lab] https://parloa.com/platform/test (Performance Lab page)
- [qz] *(secondary)* https://quantumzeitgeist.com/parloa-automates-customer-interactions-using/
- OpenAI's Parloa story https://openai.com/index/parloa/ returned 403 and was not read.

- **Tested:**
  - Simulation agents hold synthetic phone conversations with the agent under test, varying the caller's tone and mood [de].
  - Each intent, tool call and agent-to-agent handoff is tested on its own [lab].
- **Cases from:**
  - Expert briefings plus example conversations from real interactions [de].
  - Coverage is "generated automatically from the agent's configuration", combined with historical transcripts [lab].
  - Generated simulations and evaluations stay drafts until a person reviews them [lab].
- **Judged:**
  - Each case ends in an assertion of the form "Confirm that the AI agent…". Categories include brand rules, briefing rules, accuracy against company knowledge only, correct tool name and parameters, resistance to manipulation, and sensitive content [de].
  - Experts also review simulated conversations [de].
  - The judge mixes deterministic checks and an LLM judge *(secondary)* [qz].
- **When:** Before go-live [de]. Two configurations run the same tests and are compared side by side [lab].
- **Gates/alerts:** Failures are traced to the prompt level. A recommended fix is tested in simulation and applied only with approval [lab].
- **Judge errors and flakiness:** Cases are repeated "until sufficient conversation data has been collected". Obvious faults appear within 3–5 conversations, subtle ones "after hundreds or thousands" [de].

### PolyAI
Sources:
- [intro] https://docs.poly.ai/testing/introduction
- [simt] https://docs.poly.ai/testing/simulation-tests.md
- [run] https://docs.poly.ai/testing/run-and-review.md
- [ci] https://docs.poly.ai/testing/ci-automation.md

- **Tested:** Voice or chat simulation tests: a plain-language caller scenario plus prompt assertions [simt].
- **Cases from:**
  - Written by hand, or generated by Wren "from natural language". Wren also keeps tests in sync as the agent changes [intro].
  - Each case stores the function-call values of its original conversation. Editing them (a date, a customer ID, a party size) creates variants [run].
- **Judged:**
  - Each prompt assertion passes or fails with a short explanation [run].
  - "System actions" check the backend in code: action name, parameter, expected value and type, for example `switch_language` with `language`=`french` [simt].
- **When:** Against a Branch, "to catch regressions before they reach Live" [intro]. Test sets show pass/fail counts and trend charts across runs [run].
- **Gates/alerts:**
  - A CI job runs the test set on a Branch and merges it to `main` (that is, publishes) only if it passes. On a failure, Live doesn't change. A Rollback API exists [ci].
  - Experiments run a Branch against Live on real calls [intro].
- **Judge errors and flakiness:** Not described. To investigate a regression, read the transcript, which usually points to a routing, function-return or flow change [run].

### Salesforce Agentforce Testing Center
Sources:
- [th] https://trailhead.salesforce.com/content/learn/modules/agentforce-agent-testing/view-test-results
- [uc] https://www.salesforce.com/blog/agentforce-testing-center-usecase-blog/ (Ran Fu and Harsha Vardhan Viswanath, 4 Nov 2025)
- [cust] *(snippet)* https://developer.salesforce.com/docs/ai/agentforce/guide/testing-api-custom-evaluation-criteria.html
- [mt] *(snippet)* https://developer.salesforce.com/blogs/2025/11/automate-multi-turn-agent-testing-with-conversation-history-in-agentforce
- [cli] *(snippet)* https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_agent_test_results.html

- **Tested:**
  - One utterance per row, scored on expected subagent (topic), expected actions and expected response. Results are reported as three pass rates: Subagent, Action and Response Evaluation [th].
  - Multi-turn: conversation history is passed as input, and the first N turns are used to evaluate turn N+1 [mt][uc].
- **Cases from:** Inputs prepared at design time [uc]. AI generation from agent metadata is covered in competitive-landscape.
- **Judged:**
  - Pass/fail per dimension [th].
  - Custom evaluations use `string_comparison` (equals, contains, startswith, endswith; case-sensitive) and `numeric_comparison` on JSONPath into `generatedData` (for example `invokedActions`). Latency is one use [cust].
  - An LLM judge given example compliant answers returns a score with reasoning [uc].
  - A community skill says action matching is a superset check *(secondary, unverified)*: https://skills.sh/forcedotcom/afv-library/testing-agentforce
- **When:** Repeatable jobs from the CLI and Agentforce DX "for automation, CI/CD" [uc]. Results come out as JUnit, TAP or JSON [cli].
- **Gates/alerts:** No gate is described beyond the CI result files.
- **Judge errors and flakiness:** Not described.

### Google (Customer Engagement Suite: CX Agent Studio / Conversational Agents)
Sources:
- [ces] https://docs.cloud.google.com/gemini-enterprise-cx/cx-agent-studio/evaluation
- [scr] https://googlecloudplatform.github.io/cxas-scrapi/latest/guides/evaluation/

- **Tested:**
  - Scenario tests: a simulated user improvises toward a goal [ces].
  - Simulations: ordered milestones, each with "Max turns to achieve" (default 3) [ces].
  - Goldens: a fixed ideal path, including tool calls [ces].
  - The open-source tooling adds tool tests that call a tool directly and assert on fields, pytest callback tests, single-turn "Turn Evals", and "Shadow Evals" that replay a recorded call's audio against the current agent version [scr].
- **Cases from:**
  - Scenarios are suggested, and a good result can be saved as a golden. Goldens can also come from conversation history or CSV [ces].
  - Personas have a name, personality and context. A random persona is used if none is chosen [ces].
- **Judged:**
  - Expectations are a message or a tool call (with input arguments), with the conditions Must have, Must not have, After tool call and Variable value [ces].
  - Metrics [ces]:
    - Tool correctness: the share of expected parameters matched. An unexpected tool call fails a golden.
    - Semantic match: scored 0–4 per turn.
    - Hallucinations: scored per turn with tool calls, can be N/A.
    - User goal satisfaction: binary, or -1 when no goal is set.
    - Task completion: goal satisfied AND no hallucination AND expectations met.
- **When:** Manual runs and import/export in the console [ces]. `cxas ci-test` gives CI exit codes [scr].
- **Gates/alerts:** Pass/fail thresholds are set per golden turn: semantic similarity, tool correctness, hallucinations [ces].
- **Judge errors and flakiness:**
  - "Each execution of a test case in a run is a separate result", which shows flakiness. AI issue-finding works best with a run count of 3 or more [ces].
  - "Stable replay" injects the expected variables and tool responses so the context doesn't shift. "Tool fake" uses mocked data [ces].

### Ada
Sources:
- [tas] *(snippet; the page returned 404)* https://docs.ada.cx/docs/optimization/testing/testing-at-scale
- [bp] *(snippet)* https://docs.ada.cx/docs/optimization/testing/testing-at-scale/best-practices
- [ar] https://docs.ada.cx/release-notes/2025/2/24 (no date on page)
- [ars] *(snippet)* https://docs.ada.cx/releases/2024/08/06/removed-data-sampling and https://docs.ada.cx/docs/generative/measure-success/understand-and-improve-your-ai-agent-s-automated-resolution-rate

- **Tested:**
  - Testing at Scale runs single-turn cases in bulk, each with an inquiry, language, channel (web chat, email or voice) and at least one expected outcome. The limit is 300 tests a day, and "some minor variability" between runs is expected [tas].
  - Expected outcomes should be specific, binary and single-turn [bp].
- **Production check (Automated Resolution):**
  - An LLM labels every conversation after it ends as Resolved or Unresolved. A conversation is resolved only if it was relevant, safe and accurate, with no human involved. Since August 2024 this covers all conversations rather than a sample [ars].
  - Accuracy is grounded in Processes, Actions, Coaching and Company Descriptions, not only knowledge content [ar].
  - The classifier is validated against users' survey answers. Ada reports that both false positives and false negatives fell after the grounding change [ar].
  - Customers can dispute a label [ars].
- **Reasoning-engine QA, beyond the above:** not found.

### Evaluation vendors (only where they publish mechanism detail)

**Coval.**
- Metrics fall into five groups [cvm] *(https://docs.coval.ai/concepts/metrics/overview)*:
  - deterministic: Transcript Regex, Metadata Field, End Reason, API State, Custom SQL
  - statistical: latency, interruptions
  - ML model
  - LLM judge: binary, categorical, numerical, audio, composite
  - trace-based: Tool Call Count, from OpenTelemetry
- Judge calibration [cvj] *(https://www.coval.ai/blog/how-to-create-ai-judge-metrics-you-can-trust, Brooke Hopkins, 11 Jun 2026)*:
  - Reviewers label Yes/No/N/A next to the judge's verdict.
  - The Metrics page shows agreement, for example "89% agreement across 314 conversations".
  - Reviewers read the disagreements, fix the metric prompt, and use "Test Metric" to re-run it on the already-labelled calls. Start with 20–30 conversations.
  - Worked example: an AI-disclosure metric failed calls in which the agent never reached the disclosure step. The fix was a note in the metric prompt, not a change to the agent.
- Runs [cvs] *(https://docs.coval.ai/concepts/simulations/overview.md)*:
  - Templates can be scheduled.
  - "Resimulate" overwrites a result, so start a new run to keep the old one for comparison.

**Hamming.**
- Regression [hreg] *(https://hamming.ai/blog/ai-voice-agent-regression-testing, 4 Oct 2025)*:
  - Versions are compared on "the same scenarios".
  - Failed calls become "replayable test cases".
- Variability [hlk] *(https://hamming.ai/resources/testing-livekit-voice-agents-complete-guide, 31 Jan 2026)*: "Use statistical thresholds (95% pass rate vs. 100%)" and "Run critical tests multiple times and average results".
- Hallucination guide *(snippet; https://hamming.ai/resources/voice-agent-hallucination-detection-guide)*: keep the source or tool result with a regression test, add forbidden claims, and run it against both the fixed and the previous version.
- The deploy-blocking gate is already in product-ux.

**Cekura.**
- Metrics [ckm] *(https://docs.cekura.ai/documentation/guides/creating-good-metric)*:
  - Binary metrics. An "Evaluation Trigger" means a metric runs only when its condition holds, for example only when the agent tries to book.
  - Test a metric on past Call IDs before saving.
  - Give a thumbs-down with a reason, then "Add to Lab". "Auto Improve" rewrites the metric from at least 6 annotated calls.
  - Rubric thresholds use AND/OR logic.
- A baseline suite is re-evaluated after every prompt, model or infrastructure change *(vendor marketing; snippet: https://www.cekura.ai/articles/cekura-automated-test-case-generation-for-voice-agents)*.

**Braintrust.**
- Online scoring [bto] *(https://docs.braintrust.dev/core/logs/score)*:
  - Rules have a sampling rate and filters, at span, trace or session-group scope. A trace is scored after it has been idle for 30 s.
  - Scorer versions can be pinned.
  - Failed scorers retry up to 5 times, but permanent failures are not retried.
  - "Traces logged while a rule is paused are never scored". A rewind is needed to cover them.
- CI: `eval-action` posts results to the pull request *(snippet: https://braintrust.dev/docs/evaluate/run-in-ci)*.

**LangSmith.**
- Align Evals [lal] *(https://docs.langchain.com/langsmith/improve-judge-evaluator-feedback)*:
  - The alignment score is "the percentage of examples where the evaluator's judgment matches that of the human expert".
  - Start with "at least 20 examples", balanced between 0 and 1. Group misaligned examples into failure modes.
- Thread-level online evaluators score a whole conversation once per completed thread *(snippet: https://docs.langchain.com/langsmith/online-evaluations-multi-turn)*.

---

## 2. AIUC-1: what its tests actually check

Sources:
- [u] https://www.aiuc-1.com/
- [usec] https://standard.aiuc-1.com/security
- [usaf] https://standard.aiuc-1.com/safety
- [urel] https://standard.aiuc-1.com/reliability
- [ud3] https://standard.aiuc-1.com/reliability/restrict-unsafe-tool-calls
- [uacc] https://standard.aiuc-1.com/accountability
- [ulog] https://standard.aiuc-1.com/changelog
- [uint] https://www.intercom.com/blog/intercom-achieves-aiuc-1-certification (8 Dec 2025)

- **Cadence and scale:**
  - The certificate is valid for 1 year, with "Quarterly retests" [u].
  - AIUC runs "thousands of real-world scenarios" (jailbreaks, prompt injection, data leakage, hallucinations, unsafe tool calls). Red-teaming is typically 1,000–5,000 scenarios [u].
  - Intercom describes "more than a thousand enterprise risk scenarios" and "quarterly adversarial testing" [uint].
- **Third-party testing requirements after the Q4 2026 update (released 15 Oct 2026):** each reads "Appoint expert third-parties to evaluate system robustness to … risk as defined in the AIUC-1 risk taxonomy", at least every 3 months.
  - B001: security risk [usec]
  - C010: safety risk [usaf]
  - D004: reliability risk [urel]
  - A009 (data and privacy) and E018 (accountability) are new [ulog][uacc]
- **Retired in that update:**
  - C011 (out-of-scope outputs) and **C012 (customer-defined risk)** were folded into C010 [ulog].
  - D002 (hallucinations) was folded into D004 [ulog].
- **Controls that describe mechanisms rather than tests:**
  - C002 calls for "internal testing … prior to deployment across risk categories for system changes requiring formal review or approval" [usaf].
  - C005 calls for preventing "agent-specific high-risk outputs as defined in risk taxonomy" [usaf].
  - C007 (flag high-risk outputs for human review) and C008 (monitor across risk categories) are optional [usaf].
  - D003 covers tool calls [ud3]:
    - D003.1: allowlists and parameter validation before execution
    - D003.2: rate limits and transaction caps
    - D003.3: tool-call logging
    - D003.4: human approval for sensitive, high-risk or multi-step operations, elevated to a core control in Q4 2026 [ulog]
    - D003.5: periodic log reviews
  - E004 requires a named lead per change type and recorded approval evidence. E015 requires logs [uacc].
- **Not public:** the scenario lists, the pass thresholds, and how AIUC judges outputs.
  - Older wording of the tool-call test described "attempts to execute unauthorized actions or access restricted data" *(secondary, pre-Q4-2026 wording)*: https://myctrl.tools/frameworks/aiuc-1/b001 and https://soc2auditors.org/frameworks/aiuc-1/
- **What follows for Grapim's evidence:** AIUC-1 now tests against its own taxonomy only. No requirement covers the client's own policy any more, since C012 was retired. The controls where a per-client record counts as evidence are C001/C005 (the client's rules are its agent-specific risk taxonomy), C002 (testing before changes), D003.4 and E004 (named approval), C007/C008 (monitoring and human review) and E015 (logs).

---

## 3. Corrections to earlier notes

- `product-ux-research-2026-11-09.md` cites https://sierra.ai/blog/agent-os-2-0 as Sierra's own post for release governance. That post (5 Nov 2025) says nothing about testing, approvals or rollouts. The required approvals and controlled rollouts are in the Ghostwriter post of 2 Nov 2026: https://sierra.ai/blog/redesigning-agent-studio-around-ghostwriter
- `competitive-landscape-2026-11.md` describes AIUC-1 reliability as "incl. tool-call failures". Since 15 Oct 2026, D004 is "third-party testing for reliability risk", and the standalone customer-defined-risk test (C012) is retired: https://standard.aiuc-1.com/changelog
- Fin batch test is going away for new workspaces from 5 Nov 2026; Evals replace it: https://www.intercom.com/help/en/articles/14077180-simulations-vs-batch-tests-vs-previews

---

## 4. Mechanism table

"Grapim has it" refers to the code at `e5b4ddc`. File references are to `src/`.

| Mechanism | Who does it | Grapim has it? | What to build |
|---|---|---|---|
| Tests generated from the company's own SOPs and docs | Sierra [sim], Cresta [c2], Fin [proc], Decagon [sim26], Parloa [lab], PolyAI Wren [intro] | **Yes**. Rules and probes come from `inputs/` (`v1/risk.mjs` 109-119, 310-352) | Nothing new |
| Requirement review and quality diagnosis before tests run | Cresta: flags hard-to-verify, compound and needs-context requirements; experts approve [c2]. Fin: AI reviews criteria on Save [proc]. Parloa: drafts until reviewed [lab] | **Partly**. Rules and probes run in one pass; only the probes are reviewed afterwards, as a cases draft (`v1/risk.mjs` 377-394) | A rule-list review step before probes are spent, with automatic flags for compound rules, unverifiable rules, and rules needing data the agent can't see |
| Must-have vs nice-to-have | Cresta [c2]. Fin: any failed criterion fails the test [evals] | **Partly**. Severity high/medium/low and `highRiskBroken` (`v1/risk.mjs` 65, 211-212) | A `must` flag used by the gates (top 8, #7) |
| Code assertions on tool calls and arguments | Cresta Tool/Action/Variable Match [grade]; Fin data-connector and attribute criteria [proc]; PolyAI system actions [simt]; Google tool-call expectations and tool correctness [ces]; Agentforce expected actions and JSONPath [th][cust]; Coval API State [cvm] | **Partly**. The LLM judge reads `actions_taken` as text (`v1/risk.mjs` 125-128, 279), and only if the target maps an `actions` path (`adapters.mjs` 61-68). Scheduled runs call the text-only `callTarget` (`run.mjs` 85) | Top 8, #1 |
| Deterministic text checks that decide the verdict | Agentforce `string_comparison` [cust]; Coval Transcript Regex [cvm]; Cresta Article Match [grade]; Google Turn Evals [scr] | **Partly**. `phraseCheck` is only a hint in checks (`v1/risk.mjs` 216-223, 273-276), but decides the verdict in saved-test runs (`grade.mjs`) | Let exact-token `must_include` (URL, amount, days) decide in checks too; the judge decides meaning only |
| "Not reached / N/A" separate from pass | Coval Yes/No/N/A [cvj]; Cekura Evaluation Trigger [ckm]; Google goal -1 and hallucination N/A [ces]; Fin Error vs Fail [evals] | **No**. Verdict is kept or broken (`v1/risk.mjs` 103-107); live treats a rule that doesn't apply as kept (`v1/live.mjs` 38-39) | Top 8, #2 |
| Accuracy / grounding: no claims that aren't in the documents | Cresta Accuracy and Completeness [grade]; Google hallucination metric [ces]; Sierra default "grounding in fact" monitor [conf]; Ada accuracy grounded in processes, actions and coaching [ar] | **No**. The judge sees one clause (`v1/risk.mjs` 121-124); live sees only rules (`v1/live.mjs` 37-42) | Top 8, #3 |
| Multi-turn simulation and history replay | All of the above. Agentforce N+1 [mt]; Google milestones with max turns [ces]; LangSmith thread evaluators | **No**. One message per probe (`v1/risk.mjs` 269); live judges one exchange (`v1/live.mjs` 120-137) | Top 8, #4 (extends technical-basis #3) |
| Personas built from real conversations | Cresta Synthetic Customers [c2]; Decagon personas from failure modes [sim25]; Google personas [ces]; Sierra [sim] | **No**. Probes carry a `tactic` only (`v1/risk.mjs` 50-51) | Persona field once multi-turn exists |
| Controlled test state: tool mocks, fixtures, simulated date | Fin mock connectors and simulation time [proc]; Google tool fake and stable replay [ces]; Decagon tool outputs and metadata [sim25]; Sierra mock APIs [adlc] | **No**. Probes depend on whatever records the vendor's test account has (`v1/risk.mjs` 114-117) | Top 8, #5 |
| Voice / audio simulation | Sierra [voice][tvoice], Decagon [sim25], Google Shadow Evals [scr], Coval [cvs], Hamming, Cekura | **No** | Don't build. The landscape note already rules out the voice-realism race |
| Repeat runs to measure variance | Google: each execution a separate result, run count ≥3 [ces]; Cresta: dozens of replays [grade]; Decagon [sim25]; Parloa [de]; Hamming thresholds [hlk] | **Partly**. Retries only after a broken verdict, and the majority decides (`v1/risk.mjs` 36-39, 289-298) | Top 8, #8 (technical-basis #2) |
| Fail vs Error states | Fin [evals]; Braintrust scorer retries [bto] | **Yes**. `error` and `unjudged` are separate (`v1/risk.mjs` 270-281, 232) | Retry judge failures automatically (Braintrust retries up to 5 times, skipping permanent errors) before marking an answer unjudged |
| Judge calibration on a labelled set | Cresta F1 per requirement, promote after stable [c2][grade]; Coval agreement plus "Test Metric" [cvj]; LangSmith alignment score, ≥20 balanced examples [lal]; Cekura Auto Improve from ≥6 labels [ckm]; Decagon humans audit a subset [eval] | **Partly**. Overrides recorded (`v1/risk.mjs` 181-196); the evidence pack counts overturned verdicts as "a floor" (`v3/evidence.mjs` 233-245). People only see what the judge flagged | Top 8, #6 (extends technical-basis #1) |
| Dry-run a monitor on past conversations before it alerts | Fin Test Monitor and 90-day backfill [mon]; Decagon Test Watchtower [wtqa]; Cekura test on past Call IDs [ckm] | **No**. Live starts judging with the latest check's rules as soon as conversations arrive (`v1/live.mjs` 56-60) | Re-judge the stored `live/<month>.jsonl` with a new rule set and show the flag counts before turning alerts on |
| Two-stage live detection (high recall, then precision) | Sierra [ent] | **No**. One call with every rule (`v1/live.mjs` 134-137) | A cheap pass picks the rules that apply; per-rule calls follow only for those (pairs with technical-basis #6) |
| Production failure becomes a regression test | Sierra [adlc]; Fin [er]; Cresta [c1][c2]; Hamming [hreg]; Decagon [sim25] | **Yes**. `v1/live-to-tests.mjs` drafts a flagged conversation into tests, approved by a person | Keep the tool result and forbidden claims with the test, and run it on the fixed and the previous instructions (Hamming) |
| Stale test detection | Decagon auto-update [sim26]; PolyAI Wren [intro] | **Partly**. Policy hash (`v1/policies.mjs`); fingerprint of tests, target and model version (`v2/fingerprint.mjs`) | On a policy change, diff the rule list and re-draft only the probes whose clause changed |
| CI gate on the test result | Sierra [sim]; Decagon [sim26]; PolyAI merge-on-pass [ci]; Agentforce JUnit/TAP [cli]; Braintrust eval-action | **Partly**. `delomu run` exits 1 unless accepted (`commands/v0.mjs` 59). `delomu scan` exits 0 even with broken rules (`commands/v1.mjs` 61) | Top 8, #7 |
| Scheduled re-runs and platform/model-upgrade regression across all customers | Sierra runs the suite for every live customer on upgrades [adlc]; Decagon scheduled sims [tdd]; Fin Operator Routine [evals]; Coval scheduled templates [cvs]; AIUC quarterly [u] | **Partly**. `v2/monitor.mjs` and `v3/monitoring.mjs` re-run saved tests every 6–72 h, or on a change to tests, target or model version. But they are text-only (`run.mjs` 85) and judged on an aggregate pass rate (`run.mjs` 43-52) | Use the rule judge with actions in scheduled runs. Add a quarterly re-check per client with fresh probes, not only the saved messages |
| Release isolation, required approvals, ramp, A/B, one-step rollback | Fin Releases [er]; Decagon versions [ver]; PolyAI branches and rollback [ci]; Sierra required approvals and immutable releases [gw][adlc] | **Partly**. A named person approves fixes (`v1/fix.mjs` 113-130); revert, plus auto-revert when a re-check is worse (`v1/fix.mjs` 132-155). No ramp: the vendor owns traffic | A watch window after a fix or go-live (see "Next") |
| Real-time supervisor / intercept | Sierra observe→intercept [ent][conf]; AIUC D003 [ud3] | **Yes**. `v1/guard.mjs` `guardReply` and `guardAction`, fail-open; the header says money callers may treat unjudged as block | Code-level caps (amount, count per conversation) checked before the LLM, failing closed for money actions (AIUC D003.2, D003.4) |
| Input screening for injection / context poisoning | Sierra input supervisor [ent]; AIUC B002/B005 (optional) [usec] | **No** | Leave to security vendors; out of scope per the landscape note |
| Every live conversation judged against written criteria | Sierra monitors [conf]; Decagon Watchtower [wt]; Fin Monitors [mon]; Ada Automated Resolution on all conversations [ars]; Braintrust online scoring with sampling rate [bto] | **Yes**. `v1/live.mjs`, every posted exchange | Per-rule calls (technical-basis #6); a sampling rate for high-volume clients |
| Monitor validated against customer signal | Ada: false positives and negatives against survey answers [ar] | **No** | Accept an optional CSAT or complaint flag in the live API and show where it disagrees with the judge (later) |
| Alerts | Fin threshold alerts *(secondary)* [cxf]; Hamming severity routing *(snippet)* | **Yes**. High-severity webhook, at most once per hour per rule (`v1/live.mjs` 19, 161-181); v2 incident dedup | Alert on a rule's break rate rising against its baseline, not only on any high-severity break |
| Human review queue for production | Sierra daily samples [adlc]; Fin review queues and Issues [mon][fix]; Coval human review [cvj] | **Partly**. Overrides on check answers only | Part of top 8, #6: a queue mixing flagged and random kept answers, for checks and live |
| Third-party periodic testing and control-level evidence | AIUC-1 (B001, C010, D004, E018, A009 quarterly) [u][ulog] | **Partly**. The evidence pack maps to "AIUC-1, Reliability and Accountability" at domain level (`v3/evidence.mjs` 282) | Map evidence rows to control IDs as of the Q4 2026 version: C001/C005, C002, C007/C008, D003.4, E004, E015. Don't cite the retired C011, C012 or D002 |

---

## 5. Top 8 mechanisms to add, ranked by risk of a bad go-live if missing

The ranking asks: if this is missing, how likely is the client to sign off on an agent that then harms a customer?

**1. Code-checked actions per rule (M).**
- *Risk:* the agent says the right thing and does the wrong thing, such as a refund over the cap or a cancellation without confirmation. Or the judge infers an action from the words. Cresta measured this: adding Tool Match cut a pass rate from 94% to 71% [grade]. Every platform in this note has an action assertion.
- *Build:*
  - Each rule gets optional `action_checks`, drafted from the clause and `connector.json` and approved with the rule. Each check states that a tool must or must not be called, or puts a limit on an argument, such as `refund.amount <= 50`.
  - Code evaluates these before the LLM judge, and a failed check means broken whatever the judge says.
  - An action rule on a target that reports no actions shows as "can't verify actions", not kept.
  - Switch `run.mjs` to `callTargetFull`, so scheduled runs keep action judging.

**2. "Not reached" as its own verdict (S).**
- *Risk:* probes that never put the agent in the rule's situation count as kept. Examples: the order wasn't found, identity checks stopped the conversation, the agent only asked a question back. The sign-off then counts untested rules as kept. Coval's AI-disclosure example shows the same trap from the judge side [cvj]. Cekura's triggers [ckm] and Google's N/A states [ces] exist to avoid it.
- *Build:*
  - Add `not_reached` to `VERDICT_SCHEMA` with a reason.
  - Show "2 of 3 messages reached this rule". A rule with none reached reads "not tested".
  - Re-write one probe with the record or detail the answer asked for.
  - In live, keep "rule did not apply" separate from "kept".

**3. Check claims against the client's own documents (M).**
- *Risk:* a Moffatt-type answer that invents terms (a fee waiver, a retroactive refund) that no extracted rule covers. Per-rule judging catches only breaches of rules on the list. Cresta's Accuracy evaluator [grade], Google's hallucination metric [ces], Sierra's grounding monitor [conf] and Ada's grounding of accuracy [ar] all close this gap.
- *Build:*
  - One global rule per check: every policy fact the agent states (amount, days, eligibility, link, fee) must appear in the client's documents or in the tool result.
  - Judge it per answer against the relevant passages (`v4/bm25.mjs` exists for retrieval).
  - Show "Claims not in your policy" with the claim quoted. Run the same rule in live.

**4. Multi-turn pressure, starting with history replay (M).**
- *Risk:* rules hold in one message and break on the third, after the customer has set things up. Technical-basis #3 makes the case. Every leader tests whole conversations.
- *New detail:* the cheapest step is Agentforce's pattern: send scripted earlier turns as history and judge turn N+1 [mt]. Next comes Google's milestone simulation with a default of 3 turns per goal [ces].
- *Build:*
  - For targets that take a messages array (the OpenAI preset in `v1/fix.mjs` 61-64), send 2–3 scripted pressure turns before the probe.
  - Then add a simulated customer with a hidden goal.
  - Let the live API take `history`.

**5. Controlled test state: fixtures, mocked reads, a set "today" (M; L outside the connector).**
- *Risk:* boundary probes such as "delivered 31 days ago" depend on records the vendor's sandbox happens to hold, and on today's real date. Fin [proc], Google [ces], Decagon [sim25] and Sierra [adlc] all fix state for this reason.
- *Build:*
  - Give the connector Grapim generates (`v1/connector.mjs`) a check mode. Read tools answer from a per-probe `fixtures.json`, and action tools are recorded but not executed.
  - Add a fixed "today" for each probe.
  - For other targets, define a fixture field or header that the vendor's test harness can honor.
  - Store the fixture with each probe, so the evidence pack can say what state was tested.

**6. Calibrate the judge per client before its verdicts count (M).**
- *Risk:* a lenient judge gives false "kept" verdicts that nobody ever sees, because people only review what was flagged (`v3/evidence.mjs` 233-245 already says this is "a floor"). Technical-basis #1 covers the metrics.
- *New detail:*
  - Cresta reports F1 per requirement and promotes an evaluator only after its verdicts stabilize [c2][grade].
  - Coval and LangSmith re-run a revised judge on the same labelled set and start at 20–30 examples [cvj][lal].
  - Fin, Decagon and Cekura dry-run on real past conversations before going live [mon][wtqa][ckm].
- *Build:*
  - A review queue with every broken answer and about 10% of kept ones.
  - Agreement per rule.
  - Override notes added to that rule's judge prompt as examples.
  - A "re-judge stored answers" action that replays saved answers through the current judge, with no agent calls, and shows what flipped.
  - Live alerts for a rule turn on only after its judge has about 20 labelled answers.

**7. Gate sign-off and CI on must-pass rules, not averages (S).**
- *Risk:* today a sign-off link can be made while high-severity rules are broken (`v3/web.mjs` 1120-1126 checks only that a check exists). `delomu scan` exits 0 with broken rules (`commands/v1.mjs` 61). Scheduled runs pass on an aggregate rate (`run.mjs` 43-52), the exact failure Cresta's must-have split avoids [c2].
- *Build:*
  - A `must` flag on rules, defaulting to high severity.
  - Refuse to create a sign-off link while a must rule is broken, not tested, or unstable, unless the lead records a waiver with a reason. The client and the evidence pack both see the waiver.
  - `delomu scan --gate` exits 1.
  - `run.mjs` fails on any failed must case.

**8. Ask every high-severity probe several times; report the worst case (S).**
- *Risk:* an answer kept once and broken 1 in 3 times ships as kept (`v1/risk.mjs` 289-298 re-asks only after a broken verdict). Technical-basis #2 has the math.
- *New detail:* Google records each execution as a separate result and recommends at least 3 runs [ces]. Cresta replays dozens of times [grade]. Hamming uses pass-rate thresholds [hlk].
- *Build:* as in technical-basis, and show "kept 3 of 3" on the sign-off page.

**Next, just outside the top 8:**
- **Watch window after a fix or go-live (M).** For the first N live conversations, judge everything and compare each rule's break rate with the pre-fix baseline. Revert a Grapim-applied fix past a threshold, or alert. This is Grapim's version of Fin's pause/rollback and Decagon's traffic split, which Grapim can't do because the vendor owns traffic [er][ver]. Today auto-revert only follows a re-check (`v1/fix.mjs` 148-155).
- **Rule-list review with automatic flags before probes run (S).** Uses Cresta's diagnosis categories [c2].
- **Scheduled re-checks per client with the rule judge, plus a fresh-probe quarterly re-check (S–M).** Matches Sierra's runs across all customers on upgrades [adlc] and AIUC's quarterly cadence [u].
- **Code caps and fail-closed money actions in `guardAction` (S).** Maps to AIUC D003.2 and D003.4 [ud3].
- **Control-level AIUC-1 mapping in the evidence pack (S).**

---

## 6. Not found

- Any vendor describing how it resolves disagreements between judges, or a quarantine policy for flaky tests. The closest are Cresta's "promote when stable" and Hamming's 95% thresholds.
- Sierra's and Decagon's judge prompts, models or agreement figures.
- How Agentforce scores "Response Evaluation" (Trailhead names it but not the method). A 0–5 LLM score with a pass at 3 appears only in third-party text *(unverified)*.
- What AIUC-1's scenarios contain and how it judges them.
- Ada's reasoning-engine QA beyond Testing at Scale and Automated Resolution.
- Parloa's own description of the deterministic plus LLM-judge mix. It is only in secondary coverage, and the OpenAI story could not be read.
