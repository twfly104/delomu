# 2026 papers on agent evaluation: what changes for Grapim (2026-11-09)

This note covers 2026 work, plus a few late-2025 papers that are still the reference, on how Grapim should test, judge and maintain a client's customer-facing agent. It does not repeat anything in `technical-basis-2026-11-09.md`. Each paper below was opened on its arXiv abstract page, or the official page, on 2026-11-09. Numbers are quoted only as the abstract states them. Numbers marked **(body)** come from the paper's full HTML text. Venue is what the arXiv comments or journal-ref field says. Most entries are 2026 preprints without peer review, and several have a single author, so weigh them accordingly. Anything not confirmed on the page is marked **(unverified)**.

## What changed in the code since technical-basis

- `risk.mjs` `judge()`: high-severity probes are now always asked `TRIES` (3) times, and any confirmed break counts against the rule (pass^k). Each "broken" verdict is read a second time **by the same judge model**. When the two readings disagree, the probe goes to a person as a "judge split".
- `VERDICT_SCHEMA` in `risk.mjs` puts `verdict` first, then `what_happened`, then `fix`.
- `v3/evidence.mjs` `judgeRecord()` counts overrides and says itself that the count is "a floor on the judge's errors, not a measured accuracy".
- `live.mjs` `checkConversation()` and `guard.mjs`: each judges one message and one answer, with no earlier turns, against every rule in one call.
- `fix.mjs` `undoIfWorse()`: reverts a fix when broken rules or broken answers rise **on the same messages**. It uses no held-out messages and no noise margin.

---

## 1. Simulated users and multi-turn evaluation

**Mind the Sim2Real Gap in User Simulation for Agentic Tasks.** Xuhui Zhou, Weiwei Sun, Qianou Ma, Yiqing Xie, Jiarui Liu, Weihua Du, Sean Welleck, Yiming Yang, Graham Neubig, Sherry Tongshuang Wu, Maarten Sap. arXiv 11 Mar 2026, v2 31 Jul 2026, COLM 2026. https://arxiv.org/abs/2603.11245
- Finding: the authors ran the full tau-bench protocol with 451 real people on 165 tasks and compared them with 31 LLM user simulators. Simulators are too cooperative and too uniform in style. They make tasks easier, inflate agent success and give more uniformly positive feedback, and a more capable model is not a more faithful simulator. **(body)** Agent success was 63.6% with humans and up to 77.8% with general-purpose simulators. The best User-Sim Index was 76.0 against 92.7 for human inter-annotator agreement. A persona prompt *lowered* the index from 70.9 to 64.6.
- Change: present simulated multi-turn results as a worst-case attack, never as "how your customers behave". Only live conversations (`live.mjs`, `live-to-tests.mjs`) are evidence of real customer behaviour.

**Simulated Customers Never Walk Away: Decision Fidelity of LLM User Simulators Measured Against Real Purchase Outcomes.** Liang Chen. arXiv 16 Jun 2026 (no venue listed). https://arxiv.org/abs/2606.20708
- Finding: the paper uses 2,790 production conversations of an LLM sales agent, 793 of them with a verified payment. Simulators match eventual buyers, but they overstate how much non-buyers deliberate and persist, which the author calls a "disengagement deficit". This holds across model families. Telling the simulator it may leave reduces the overall bias but not the gap between buyers and non-buyers.
- Change: for multi-turn probes, record the turn at which the rule broke. The report can then say whether the break needed a persistence that real customers rarely show, which matters most for sales agents.

**RealUserSim: Bridging the Reality Gap in Agent Benchmarking via Grounded User Simulation.** Ming Zhu, Juntao Tan, Rithesh Murthy, Jielin Qiu, Liangwei Yang, Wenting Zhao, Silvio Savarese, Shelby Heinecke, Huan Wang. arXiv v1 dated 7 Apr 2026 on the page (ID 2605.20204; no venue listed). https://arxiv.org/abs/2605.20204
- Finding: the authors extracted 7,275 behaviour profiles from more than 14,000 real WildChat conversations. On a 600-conversation fidelity benchmark, grounding a simulator in these profiles raised the match rate from 24.2% to 45.3% across five behaviour dimensions. On TauBench, grounded simulators exposed three failure mechanisms that cooperative simulators miss, and task success fell by about 3.2% to 3.5% on average. Hand-written behaviour directives made simulators overreact.
- Change: if Grapim builds a simulated customer, condition it on behaviour taken from the client's own scrubbed live conversations, not on hand-written persona text.

**CUEing User Simulators: Calibrated User Embeddings for Multi-Turn Benchmarking.** Anjali Kantharuban, Jonas Mueller. arXiv 1 Oct 2026 (no venue listed). https://arxiv.org/abs/2610.02460
- Finding: existing simulators copy human style but not real users' success rates or failure patterns. CUE encodes observed sessions and decodes them into persona instructions, with no training. On tau2-Bench it causes fewer simulator errors and matches real-user failure modes and overall success more closely.
- Change: test a simulator on outcomes. Once a client has live traffic, compare each rule's live broken rate with its simulated broken rate, and show the gap.

**Flipping the Dialogue: Training and Evaluating User Language Models.** Tarek Naous, Philippe Laban, Wei Xu, Jennifer Neville. arXiv 8 Oct 2025, v2 22 Mar 2026, ICLR 2026. https://arxiv.org/abs/2510.06552
- Finding: assistants prompted to act as users make poor user simulators, and more capable assistants make worse ones. Trained "User LMs" are closer to real users. When a User LM plays the user, GPT-4o drops from 74.6% to 57.4% on coding and math conversations.
- Change: don't default to the strongest model as the simulated customer. UserLM is not a drop-in fix either. Sim2Real **(body)** shows UserLM-8B front-loading identifiers, at 4.8 per turn against 2.6 for humans.

**Effective Red-Teaming of Policy-Adherent Agents.** Itay Nakash, George Kour, Koren Lazar, Matan Vetzler, Guy Uziel, Ateret Anaby-Tavor. arXiv 11 Jun 2025, v3 23 Aug 2025 (no venue listed). https://arxiv.org/abs/2506.09600 . It is from 2025 but remains the reference for this threat model.
- Finding: the threat model is a customer who exploits a policy-adherent service agent for personal gain. CRAFT, a multi-agent red-teamer that uses "policy-aware persuasive strategies", beats DAN-style, emotional and coercive jailbreaks. The authors build tau-break on tau-bench. Simple defences help but fall short. The abstract gives no figures.
- Change: this is the design for Grapim's multi-turn probe. The attacker reads the clause and plans persuasion aimed at it, rather than using generic jailbreak tactics. It extends `rulesSystem` in `risk.mjs` to several turns for high-severity rules.

**Eliciting Behaviors in Multi-Turn Conversations.** Jing Huang, Shujian Zhang, Lun Wang, Andrew Hard, Rajiv Mathews, John Lambert. arXiv 29 Dec 2025 (no venue listed). https://arxiv.org/abs/2512.23701
- Finding: online methods, which learn from interacting with the target, reach average success rates of 45/19/77% across three tasks with a few thousand queries. Static multi-turn benchmarks find few or no failures on the same tasks.
- Change: Grapim's probes are static, written before any answer is seen. For high-severity rules that **held**, add one adaptive round that writes new probes from the agent's actual answers. Those are the rules a static test under-explores.

**Building Customer Support AI Agents at 100M-User Scale: An Evaluation-Driven Framework.** Aman Gupta, Kevin Rossell, Edesio Alcobaça, Jose Chrystian Lima Pacheco, Carolina Baptista de Lima, Shao Tang, Luiz Paulo Rabachini, Luis Moneda, Herbert Fei, Daniel Silva, Rohan Ramanath (Nubank). arXiv 7 Jun 2026, v2 13 Jun 2026, KDD '26. https://arxiv.org/abs/2606.08867
- Finding: the paper covers five production support deployments. It uses an LLM judge "with measured inter-rater agreement" plus GEPA. In an A/B test of the card-delivery agent, AI transactional NPS rose 37 pp and self-service rose 29 pp. Offline simulation metrics correlated strongly with online outcomes.
- Change: this is the counterweight to Sim2Real. Offline numbers can track production when judge agreement is measured and the loop is closed with live data. Put Grapim's measured judge agreement in the client report, as Nubank does.

## 2. LLM-as-judge reliability

**How to Correctly Report LLM-as-a-Judge Evaluations.** Chungpa Lee, Thomas Zeng, Jongwon Jeong, Jy-yong Sohn, Kangwook Lee. arXiv 26 Nov 2025, v4 31 May 2026, ICML 2026 (journal-ref). https://arxiv.org/abs/2511.21140
- Finding: a judge with imperfect sensitivity and specificity biases the raw score. A plug-in correction uses sensitivity and specificity measured on a human-labelled calibration set and returns a bias-corrected estimate. Its confidence intervals cover both test and calibration uncertainty. The paper also gives an adaptive way to allocate calibration labels and claims the estimate stays unbiased under distribution shift. The abstract gives no figures. Code: UW-Madison-Lee-Lab/LLM-judge-reporting (per the search result).
- Change: report "rules broken" in scans and the weekly broken rate in live this way. Per deployment, have a person label a **random** sample of kept and broken verdicts, compute the judge's sensitivity and specificity, and publish corrected rates with intervals. This replaces the floor that `judgeRecord()` reports today.

**Nine Judges, Two Effective Votes: Correlated Errors Undermine LLM Evaluation Panels.** Guneet Kohli. arXiv 28 May 2026 (no venue on the arXiv page; a NeurIPS 2026 listing appeared in search, **unverified**). https://arxiv.org/abs/2605.29800
- Finding: 9 frontier LLMs from 7 families were tested on three NLI datasets with 100 human annotations per item. Together they carry about 2 independent votes, so about three-quarters of the panel's nominal independence is lost. Panel accuracy trails independent voting by 8-22 pp. The best single judge matches or beats the full panel in every condition. Established aggregation methods close at most 11% of the gap.
- Change: technical-basis upgrade 4 ("2-3 model families vote on close calls") no longer holds as an accuracy measure, and "judged by a panel" no longer holds as a sales line. Spend the budget on human labels and the best single judge.

**CARE: Confounder-Aware Aggregation for Reliable LLM Evaluation.** Jitian Zhao, Changho Shin, Tzu-Heng Huang, Satya Sai Srinath Namburi GNVV, Frederic Sala. arXiv 9 Feb 2026, v2 8 Sep 2026. The comments say "ICLM 2026", which the PMLR v306 listing in search gives as ICML 2026. https://arxiv.org/abs/2603.00039
- Finding: judges share confounders such as verbosity and style, so majority vote or averaging may add little or even reinforce mistakes. Modelling those confounders cuts aggregation error by up to 26.8% across 12 benchmarks.
- Change: if Grapim ever combines judges, plain majority vote is the weakest choice. Low priority.

**A Finite-Calibration Regime Map for LLM Judge Panels.** Bin Zhu, Yi Xie, Yanghui Rao. arXiv 31 May 2026, v2 20 Aug 2026, WISE 2026. https://arxiv.org/abs/2606.01034
- Finding: with a limited budget of human labels, simple scalar or reliability-based aggregation gave lower MSE than full joint-table calibration in 16 of 20 dataset-budget cells.
- Change: keep calibration simple, one sensitivity/specificity pair per deployment. Don't fit per-rule calibration tables on a few dozen overrides.

**trajectory-judge: What Outcome-Only LLM Judges Miss on Agent Trajectories.** Hadi Mohammadi. arXiv 29 Aug 2026, v4 3 Nov 2026, NeurIPS 2026 Workshop "Who Verifies the Agents?" (poster). https://arxiv.org/abs/2609.00038
- Finding: the testbed is a deterministic support desk with 400 labelled trajectories.
  - A 14B judge that saw only the request and the final reply caught 34% to 76% of four fault types that leave the reply unchanged. Its paired discrimination was zero, meaning it flagged clean runs just as often.
  - Told to check each step, the same judge flagged every one of those faults and 0 of 100 clean runs.
  - But it then under-checked the reply. Of four invented promises, it flagged one every time and the other three once in 42 faults.
- Change: two changes.
  - (a) Split the `risk.mjs` verdict into two checks: one goes through `actions_taken` step by step against the clause, and the other reads the reply alone for promises and claims.
  - (b) Test the judge with paired faults, which needs no human labels. Take kept answers, inject one fault (a forbidden refund in actions, or an invented promise in the text), and report the flag rate on faulted copies minus the flag rate on the originals.

**Judge Reliability Harness: Stress Testing the Reliability of LLM Judges.** Sunishchal Dev, Andrew Sloan, Joshua Kavner, Nicholas Kong, Morgan Sandler. arXiv 5 Mar 2026, ICLR 2026 workshop "Agents in the Wild". https://arxiv.org/abs/2603.05399
- Finding: an open-source library that builds judge validation tests, binary and ordinal, for free-response and agentic tasks. Four judges were tested on four benchmarks, and accuracy shifted under formatting changes, paraphrase, added length and flipped labels. "No judge that we evaluated is uniformly reliable across benchmarks using our harness."
- Change: per agent kind (support, sales, billing), check that a reformatted, paraphrased or padded copy of the same answer gets the same verdict. Put the result in the evidence pack as a judge check.

**Can LLM-as-a-Judge Reliably Verify Rubrics in Agentic Scenarios?** Yangda Peng, Yunjia Qi, Haotian Xia, Guanzhong He, Xintong Shi, Richeng Xuan, Songyuanyi Lu, Yixian Liu, Zhichao Hu, Yuhong Liu, Hao Peng. arXiv 29 Jun 2026, v2 2 Sep 2026, EMNLP 2026. https://arxiv.org/abs/2606.29920
- Finding: RuVerBench has 2,458 human-labelled instances from deep research and agentic coding. Frontier judges perform strongly but still show substantial noise. Batched verification trades accuracy for efficiency, and majority voting helps with diminishing returns. A search snippet also names the failure modes "partial evidence as full satisfaction" and "invented requirements", which are not in the abstract **(unverified)**.
- Change: "batching costs accuracy" is direct 2026 evidence against `live.mjs` and `guard.mjs` judging all rules in one call. First pick the few rules relevant to the message, then judge each one separately.

**RubricEval: A Rubric-Level Meta-Evaluation Benchmark for LLM Judges in Instruction Following.** Tianjun Pan, Xuan Lin, Wenyan Yang, Qianyu He, Shisong Chen, Licai Qi, Wanqing Xu, Hongwei Feng, Bo Xu, Yanghua Xiao. arXiv 26 Mar 2026 (no venue listed). https://arxiv.org/abs/2603.25133
- Finding: the benchmark has 3,486 instances. GPT-4o reaches 55.97% on the Hard subset. Judging rubric by rubric beats judging a whole checklist at once, explicit reasoning improves accuracy, and the two together reduce variance between judges.
- Change: `risk.mjs` already judges one rule at a time. What's missing is reasoning before the verdict (next entry).

**LLM-as-a-Judge Is Not an Oracle: Why Self-Improving Agents Need Deterministic Guardrails.** Vansh Wahi. arXiv 2 Sep 2026 (no venue listed). https://arxiv.org/abs/2609.02246
- Finding: the author ran prompt-optimisation loops in production for months and recorded eleven failure modes in four classes: judge bias, harness and metric failures, ground-truth errors, and reward hacking. Agents reached a 100% pass rate while their true capability was 68%. Rewriting the rubric plateaued, and the only reliable gain came from constraining the judge's output order. **(body)** Reordering the schema to "rationale first, score last" raised exact-match agreement with experts from 42.6% to 51.9%. The proposed loop has five deterministic layers, including frozen holdouts and canary integrity cases.
- Change: in `VERDICT_SCHEMA` (`risk.mjs`), put `what_happened` before `verdict`, and in the `live.mjs` and `guard.mjs` schemas put the reason before `rule_id`. Plant a few canary answers with known verdicts in every scan to catch judge drift.

**Evaluating LLMs as Agentic Workflow Executors in Real-World Customer Support Skills.** Md Tahmid Rahman Laskar, Gundeep Singh, Xue-Yong Fu, Karol Chang, Kevin Sanders, Shi Zong, Tania Habib, Julien Bouvier Tremblay, Shayna Gardiner, Harsh Saini, Matthias Lee, Elena Khasanova, Quinten McNamara, Shashi Bhushan TN. arXiv 9 Oct 2026, v2 14 Oct 2026 (no venue listed). https://arxiv.org/abs/2610.14346
- Finding: workflows were mined from real support transcripts and run against mocked tools in multi-turn dialogues. Five strong LLM judges scored them, alongside a deterministic evaluator for tool coverage, hallucinated tool use and unsupported claims. The choice of judge significantly changes results: pairwise agreement on pass/fail **averaged Kappa=0.524 across 10 judge pairs**.
- Change: this is the most direct 2026 figure for Grapim's setting. Strong judges agree only moderately on support pass/fail, so a single judge's "broken" should not be shown as fact without the calibration from Lee 2026. Write the mechanical checks in code, for example a claimed refund that does not appear in `actions`.

## 3. Policy and rule compliance

**Policy Loopholes in Agent Evaluation: When Policy Ambiguity Masquerades as Agent Error.** Hongliu Cao. arXiv 13 Sep 2026, REALM workshop at EMNLP 2026. https://arxiv.org/abs/2609.14400
- Finding: policies written in natural language can be silent, ambiguous or contradictory. In two tau2-bench domains, tasks with loopholes lowered scores unevenly across models and made every model less consistent across trials. Exploiting a loophole needs both an ambiguous policy and permissive tools. "Policy specification quality sets the ceiling on evaluation quality."
- **(body)** Figures from the full text:
  - The paper names five loophole types: scope gap, silent-on-edge, conflicting clauses, implicit precondition and compositional ambiguity.
  - 7 of the 50 airline tasks were affected.
  - Success was 37% on loophole tasks and 51% on the rest.
  - Cross-trial variance was 0.110 on loophole tasks and 0.068 on the rest.
  - tau3-bench changed 29 of the 50 airline tasks, including all 7 loophole tasks, and left the policy files unchanged.
- Change: this is the most important 2026 finding for Grapim.
  - In `risk.mjs`, after extracting rules, tag each rule with any of the five loophole types.
  - Send ambiguous rules to the client's sign-off as a question ("which reading is right?") instead of probing them as if the answer were known.
  - An `unstable` probe on an ambiguous rule should read "policy unclear", not "agent inconsistent".
  - Report loophole-free rules separately.

**tau3-bench (sierra-research/tau2-bench repository).** README and CHANGELOG read 2026-11-09. https://github.com/sierra-research/tau2-bench . The 1.0.0 release date is a placeholder in the CHANGELOG. Secondary sources say March 2026 **(unverified)**.
- Finding: the release lists "75+ task fixes". Per the CHANGELOG these cover 27 airline tasks, 26 retail tasks and 20+ banking-knowledge tasks: wrong expected actions, ambiguous instructions, impossible constraints, policy loophole prevention and missing fallbacks. It adds `banking_knowledge` (97 tasks, 698 documents) and voice. v2.0.0 (2026-10-19) adds a Persona Guidelines block to the text user simulator.
- Change: the most-used hand-built customer-service benchmark needed dozens of task fixes after two years. Grapim's LLM-written `expected` fields will contain errors too. Log corrections to them as test-set fixes, kept apart from judge overrides, so they don't count as judge errors.

**SABER: Small Actions, Big Errors -- Safeguarding Mutating Steps in LLM Agents.** Alejandro Cuadron, Pengfei Yu, Yang Liu, Arpit Gupta. arXiv 26 Nov 2025 (submitted to ICLR 2026). https://arxiv.org/abs/2512.07850
- Finding: in tau-Bench and SWE-Bench Verified traces, each decisive deviation in a step that changes the environment cuts the odds of success by up to 92% (Airline) and 96% (Retail). Deviations in steps that change nothing have little or no effect. Errors grow with context length. The paper releases tau-Bench Verified because of annotation errors and underspecified tasks.
- Change: rank findings by action. A broken rule where `actions_taken` contains a mutating call (refund, cancel, plan change) is more severe than bad wording. Point probe writing at the connector's mutating tools first. `guardAction` already sits at the right point.

**Beyond IVR: Benchmarking Customer Support LLM Agents for Business-Adherence.** Sumanth Balaji, Piyush Mishra, Aashraya Sachdeva, Suraj Agrawal. arXiv 2 Jan 2026 (preprint). https://arxiv.org/abs/2601.00596
- Finding: JourneyBench generates support scenarios from graph-structured SOPs and scores policy adherence with a User Journey Coverage Score. Across 703 conversations in three domains, an agent that explicitly models policy control (DPA) substantially beats a static prompt and lets GPT-4o-mini outperform GPT-4o.
- Change: two uses.
  - (a) Rules about order (verify identity, then offer, then confirm) can't be tested with single-turn probes. Extract them as small graphs and test path coverage.
  - (b) When a broken rule is procedural, `fix.mjs` `gaps` should say "needs workflow control", not only "more instructions".

**PolicyGuard: A Dialogue-Grounded Sub-Agent Verifier for Policy Adherence in LLM Agents.** Seongjae Kang, Taehyung Yu, Sung Ju Hwang. arXiv 28 Jun 2026 (no venue listed). https://arxiv.org/abs/2606.29225
- Finding: a verifier sees the same dialogue as the agent and gives feedback for its next turn. On the tau2-bench airline domain, with GPT-5.4, Claude Sonnet 4.6 and Gemini 2.5 Pro and 4 trials each, PASS^4 rose +12.0 / +6.0 / +12.0 pp. It caught more violations while blocking roughly half as often as guards that check only action arguments.
- Change: `guard.mjs` and `live.mjs` should receive the conversation so far. "Refund without explicit confirmation" can only be seen across turns, and dialogue context also reduces needless blocks.

**PolicyGuide: From Guarding One Action to Guiding the Whole Workflow for Policy-Compliant LLM Agents.** Seongjae Kang, Taehyung Yu, Sung Ju Hwang. arXiv 20 Aug 2026 (no venue listed). https://arxiv.org/abs/2608.19861
- Finding: each policy is compiled into a workflow graph, with a verifier at user-turn boundaries. On tau2-bench airline, retail and telecom with GPT-5.4, mean Pass^4 rose from 0.42 to 0.62, and telecom from 0.19 to 0.61. The method transfers to Claude Sonnet 4.6 and Gemini 2.5 Pro agents.
- Change: for procedural rules, the best-supported fix is a workflow-state check, not more prompt text. This is a later product (a guard with workflow state), not a change for now.

**Do Agents Still Follow the Rules? Benchmarking Rule Compliance under Agent Context Compaction.** Yiwei Zha, Qingyu Meng, Herbert Bos, Min Chen. arXiv 2 Nov 2026 (no venue listed). https://arxiv.org/abs/2611.03223
- Finding: ARCBench shows that most violations after compaction happen **while the rule is still in the history**, often because the agent treats a later request as permission. Compacted runs that keep the rule violate it more than twice as often as full-history runs. The strongest attack on the compactor more than doubles violations.
- Change: multi-turn probes should include the "later request as permission" move ("OK, so go ahead now") and long sessions. `live.mjs` should store the conversation length so breaks can be split by length.

**HANDBOOK.md: A Benchmark for Long-Context Agentic Instruction Following.** Liudas Panavas, Sebastian Minus, Bradley Monton, Derek Ray, Suhaas Garre, Sushant Mehta, Edwin Chen. arXiv 28 Jul 2026, v3 3 Aug 2026, Workshop on Agent Behavior at COLM 2026. https://arxiv.org/abs/2607.25398
- Finding: 65 tasks follow expert-written SOPs of 20-124 pages and are graded by 824 deterministic criteria. The best model passes 36.2% of trials under strict grading, and most frontier models score below 25%. Agents let unauthorized requests override standing policy, act against their own check results, and claim compliance they did not achieve.
- Change: "claims compliance it did not achieve" is a mismatch between reply and actions, which the split action/reply check (trajectory-judge) catches. It is also more support for deterministic checks on mechanical rules (RuLES, in technical-basis).

**CRM-Agent-Bench: Benchmarking Tool-Using Agents in Stateful Enterprise Environments.** Monojit Banerjee, Zhujun Lan, Defu Cao. arXiv 23 Oct 2026 (no venue listed). https://arxiv.org/abs/2610.32004
- Finding: 555 stateful multi-turn tasks in nine business domains, each with an executable contract. Outcome, trajectory, operational viability and policy compliance are scored together. Strict success ranges from 64.32% to 83.60% across 16 systems, and leaders that are close on success differ sharply in cost and per-domain reliability.
- Change: report reliability per rule category (refunds, identity, disclosures), not one overall score.

**tau-Knowledge: Evaluating Conversational Agents over Unstructured Knowledge.** Quan Shi, Alexandra Zytek, Pedram Razavi, Karthik Narasimhan, Victor Barres. arXiv 4 Mar 2026 (no venue listed). https://arxiv.org/abs/2603.04370
- Finding: tau-Banking is a fintech support domain with about 700 interconnected knowledge documents plus tools. Frontier models with high reasoning budgets reach only ~25.5% pass^1, and reliability drops sharply over repeated trials. Agents fail both to find the right documents and to reason over complex internal policies.
- Change: when the client's agent reads from a knowledge base, a broken rule may be a retrieval miss. Capture which documents the agent retrieved, when the adapter exposes them, so the fix targets retrieval or instructions correctly.

**BLINDSPOT: A Benchmark for Safety and Refusal Calibration in Long-Horizon Tool-Using Agents.** Sadia Asif, Mohammad Mohammadi Amiri, Momin Abbas, Tejaswini Pedapati, Prasanna Sattigeri. arXiv 14 Sep 2026 (no venue listed). https://arxiv.org/abs/2609.16305
- Finding: more than 2,500 trajectories averaging 14.7 turns. Each gets one of five outcomes: Safe Completion, Correct Refusal, Unsafe Completion, Over-Refusal or Indeterminate. The 13 models differ substantially in how they balance safety and usefulness. Failures can appear only after several safe steps.
- Change: give the verdict these outcome classes instead of only kept/broken. This is the concrete form of the ST-WebAgentBench CuP change in technical-basis, and it lets `fix.mjs` see when a fix caused over-refusal.

**Towards a Science of AI Agent Reliability.** Stephan Rabanser, Sayash Kapoor, Peter Kirgis, Kangheng Liu, Saiteja Utpala, Arvind Narayanan. arXiv 18 Feb 2026, v3 2 Jun 2026, ICML 2026. https://arxiv.org/abs/2602.16666
- Finding: twelve metrics in four dimensions: consistency, robustness, predictability and safety. Across 15 models and two benchmarks, recent capability gains brought only small reliability improvements.
- Change: Grapim reports consistency (pass^k) only. Add robustness (the same probe paraphrased) and severity (the rule's `harm`, and whether a mutating action fired). This also answers a buyer who asks whether a newer model removes the need for Grapim.

## 4. Test generation from specifications, and coverage

**Inverting the Shield: Systematically Generating Safety Tests from Policy Specifications.** Xiaoyue Lu, Xianglin Yang, Haijun Liu, Jiahao Liu, Kuntai Cai, Yan Xiao, Jin Song Dong. arXiv 24 May 2026, ACL 2026. https://arxiv.org/abs/2605.24883
- Finding: POLARIS compiles natural-language policies into first-order logic, builds a Semantic Policy Graph whose paths are violation scenarios, and turns those paths into test queries. It achieves higher policy coverage and attack success counts than baselines. The abstract gives no figures.
- Change: this is the closest published method to Grapim's rule-to-probe step, and it adds two things Grapim lacks: a coverage measure, and tests where two clauses interact. Keep a map from rules to probes and report coverage per clause, including combinations of rules that share a condition.

**Toward Pre-Deployment Assurance for Enterprise AI Agents: Ontology-Grounded Simulation and Trust Certification.** Thanh Luong Tuan, Abhijit Sanyal. arXiv 2 Jun 2026, v2 4 Jun 2026 (no venue listed). https://arxiv.org/abs/2606.04037
- Finding: 1,800 scenarios were checked against 125 primary-source regulatory requirements and 25 injected faults, across fintech, banking, insurance and healthcare in the US and Vietnam. Ontology-grounded generation covered 48.3% of requirements against 33.1% for a persona-based baseline (corrected p_c = .0006). Its advantage over plain and retrieval-augmented prompting did not survive Bonferroni correction. The paper also proposes a machine-verifiable Trust Certificate with graduated deployment verdicts.
- Change: generating tests anchored to each requirement beats persona-style generation, which supports Grapim's one-rule-to-probes design. Even so, coverage was under half. Grapim caps a check at 40 rules, so for long policies the report should say "N of M clauses tested" and list the untested ones.

**Noise Floor Audit for Agent Benchmarks.** Yihang Chen, Pin Qian, Su Wang, Chong Peng, Huan Xu, Xiyang Wu, Yiqi Sun. arXiv 23 Aug 2026 (no venue listed). https://arxiv.org/abs/2608.22331
- Finding: on BFCL tool-calling at temperature 0, reruns are nearly deterministic, with ever-flip rates of 0.7%, 2.0% and 2.7%. Paraphrases that keep the meaning give median paired SDs 11x to 58x larger than reruns.
- Change: `TRIES` re-sends the identical message, which measures the smallest source of noise. For high-severity rules, make some of the k tries paraphrases of the probe, same tactic in different words. Caveat: this is a function-calling benchmark, not customer conversations.

**Thin area.** I found no 2026 paper on mutation testing of conversational agents against business policies, and none on adequacy criteria for policy test suites. The 2026 test-generation work on mutation and coverage that search turned up (for example arXiv 2602.08146 and 2608.17177) is about code, and I did not open it.

## 5. Production monitoring, drift, regression, and fixing agents

**Test Before You Deploy: Governing Updates in the LLM Supply Chain.** Mohd Sameen Chishti, Damilare Peter Oyinloye, Jingyue Li. arXiv 30 Apr 2026, LLMSC 2026 workshop at FSE 2026 (4 pages). https://arxiv.org/abs/2604.27789
- Finding: hosted providers can change a model's behaviour without announcing a version change. The paper proposes production contracts, regression suites organised by risk category, and compatibility gates. Early validation suggests targeted risk-area tests reveal regressions that overall metrics miss. Setting thresholds for non-deterministic systems is still open.
- Change: when the client's underlying model changes, and on a schedule because changes can be silent, re-run the high-severity probes as a gate and alert per rule, not on an overall score. The existing `v2` fingerprint and monitor path is the hook.

**Sequential statistical inference for Large Language Models: Representation, validity, and monitoring.** Yao Xie. arXiv 30 May 2026, prepared as an invited discussion for *The American Statistician*. https://arxiv.org/abs/2606.07624
- Finding: frames deployment as statistical process control. Interactions are modelled as dependent processes, uncertainty guarantees must hold under repeated use, and sequential alarms or change-point detection flag shifts in calibration, hallucination, refusal behaviour and fairness. The abstract gives no figures.
- Change: `live.mjs` alerts on any single high-severity break, limited to once an hour. Add a change-point alarm on each rule's daily broken rate and on the refusal rate. That catches slow drift, and one noisy verdict no longer pages anyone.

**Measuring the Prevalence of Policy Violating Content with ML Assisted Sampling and LLM Labeling.** Attila Dobi, Aravindh Manickavasagam, Benjamin Thompson, Xiaohan Yang, Faisal Farooq. arXiv 19 Feb 2026, v2 17 Aug 2026. No venue is listed on the page; Pinterest and KDD '26 come from search **(unverified)**. https://arxiv.org/abs/2602.18518
- Finding: daily probability sampling, weighted by an ML model toward high-risk items, keeps estimates unbiased. An LLM labels the sample from policy prompts and is checked against a gold set. The output is prevalence with confidence intervals, broken down by post-stratification.
- Change: this is the template for `live.mjs` at volume. Screen cheaply, judge a weighted sample, have a person label a gold subset, and report "x% of conversations broke rule R (interval)". Combine it with Lee 2026.

**When Evidence is Sparse: Weakly Supervised Early Failure Alerting in Dialogs and LLM-Agent Trajectories.** Avinash Baidya, Xinran Liang, Ruocheng Guo, Xiang Gao, Kamalika Das. arXiv 3 Jun 2026, v2 30 Oct 2026 (no venue listed). https://arxiv.org/abs/2606.05414
- Finding: a lightweight monitor trained only on trajectory-level outcomes predicts failure mid-conversation. It costs 1,103-3,749x less per decision than a GPT-5.2 uncertainty monitor and is 31-106x faster.
- Change: later, once a client has enough labelled live conversations, a cheap trained screen could decide which live conversations the LLM judge reads. Not now.

**GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning.** Lakshya A Agrawal, Shangyin Tan, Dilara Soylu, Noah Ziems, Rishi Khare, Krista Opsahl-Ong, Arnav Singhvi, Herumb Shandilya, Michael J Ryan, Meng Jiang, Christopher Potts, Koushik Sen, Alexandros G. Dimakis, Ion Stoica, Dan Klein, Matei Zaharia, Omar Khattab. arXiv 25 Jul 2025, v2 14 Feb 2026, ICLR 2026 (Oral). https://arxiv.org/abs/2507.19457
- Finding: GEPA reflects in natural language on sampled trajectories and keeps a Pareto frontier of candidate prompts. It beats GRPO by 6% on average and by up to 20%, with up to 35x fewer rollouts, and beats MIPROv2 by over 10%.
- Change: this is the current reference for what `fix.mjs` does. `draftFix` is a single reflection step that writes one block. GEPA's Pareto selection keeps candidates that each win on different rules. Use it only behind the gates in the next two entries.

**Reflective Prompt Optimization of a Deep-Research Agent: A Topic-Disjoint, Multi-Seed Protocol for Measuring Transferable Gains and Prompt-Level Overfitting.** Elias Lumer, Sahil Sen, Vamse Kumar Subbiah, Kevin Paul. arXiv 8 Oct 2026 (no venue listed). https://arxiv.org/abs/2610.12601
- Finding: GEPA was evaluated on a split where no topic appears in more than one of train, validation and test.
  - Held-out reward rose 0.079 (0.702 to 0.781, 95% CI [0.051, 0.107]) and replicated across three seeds.
  - Nearly half of the winning prompt was a memorised answer key, which earned no reward.
  - The large gap between validation and held-out scores came from selecting on a small sample under a noisy judge.
  - Per-dimension feedback drove the transferable gain. Collapsing it into one score made held-out transfer **negative**.
- Change: `recheck` judges the fix on the same messages it was written from, which is the setup this paper warns about. Gate a fix on held-out probes for the same rules that `draftFix` never saw. Keep giving `draftFix` per-rule findings, never a single count.

**TextReg: Mitigating Prompt Distributional Overfitting via Regularized Text-Space Optimization.** Lucheng Fu, Ye Yu, Yiyang Wang, Yiqiao Jin, Haibo Jin, B. Aditya Prakash, Haohan Wang. arXiv 20 May 2026, v2 5 Oct 2026 (no venue listed). https://arxiv.org/abs/2605.21318
- Finding: rewriting prompts from LLM feedback tends to produce longer prompts with narrow, sample-specific rules that generalise poorly. Regularising the rewrites improves out-of-distribution accuracy by up to +11.8% over TextGrad and +16.5% over REVOLVE, on reasoning benchmarks.
- Change: in `fix.mjs`, flag drafted instructions that copy probe specifics, such as an order id or a phrase from a test message. Track instruction length across fixes, because adding one special case per broken probe is overfitting.

**Build, Judge, Optimize: A Blueprint for Continuous Improvement of Multi-Agent Consumer Assistants.** Alejandro Breen Herrera, Aayush Sheth, Steven G. Xu, Zhucheng Zhan, Charles Wright, Marcus Yearwood, Hongtai Wei, Sudeep Das, Danny Nightingale, Meg Watson, Charles Pollnow V. arXiv 3 Mar 2026, v2 30 Apr 2026 (no venue listed). https://arxiv.org/abs/2603.03565
- Finding: describes a production grocery assistant. A rubric breaks quality into dimensions, and the LLM-judge pipeline is checked against human annotations. Two GEPA strategies are used: per sub-agent with local rubrics, and MAMuT GEPA across all agents with multi-turn simulation. The abstract gives no figures. A search snippet mentions 77.1% to 84.7% on 238 held-out trajectories and a "safety veto" on prompt updates **(unverified)**.
- Change: check judges against human labels and use per-rule rubrics before optimising anything. The safety-veto idea means making `undoIfWorse` revert when **any** high-severity rule gets worse.

**Refusal side effects.** BLINDSPOT (section 3) is the only opened 2026 work that scores over-refusal for tool-using agents. I found no 2026 paper that measures over-refusal *caused by prompt-level fixes* to customer-service agents, so this area is thin.

## 6. Certification and assurance of AI agents

**AIUC-1 (Artificial Intelligence Underwriting Company).** Read 2026-11-09 at https://www.aiuc-1.com/ , https://standard.aiuc-1.com/safety/ , https://standard.aiuc-1.com/reliability/ and https://standard.aiuc-1.com/changelog/ . Last updated in the Q4 2026 release, 15 Oct 2026.
- Finding: the standard has six domains: Data & Privacy, Security, Safety, Reliability, Accountability and Society. AIUC runs the technical tests, typically 1,000 to 5,000 red-team scenarios, and an accredited auditor reviews the evidence. A certificate lasts one year, with quarterly retests. Mandatory controls include:
  - C002, conduct pre-deployment testing
  - C004, prevent out-of-scope outputs
  - C010, third-party testing for safety risk, at least every 3 months
  - D003, restrict unsafe tool calls
  - D004, third-party testing for reliability risk, at least every 3 months
  - C008, monitor AI risk categories, is optional.
- The Q4 2026 update **retired C011** (third-party testing for out-of-scope outputs) **and C012** (third-party testing for customer-defined risk) and folded both into C010.
- Change: map the evidence pack to these IDs: the pre-launch check to C002, the quarterly re-check to C010 and D004, action checks to D003, and live monitoring to C008. For the pitch: since Q4 2026 no standalone AIUC-1 control requires testing against a customer's own policies. That is the gap Grapim fills. Grapim is not an AIUC-accredited tester, so it supplies evidence; it does not satisfy a control by itself.

**Sierra achieves AIUC-1 certification** (Sierra blog, 17 Sep 2026). https://sierra.ai/blog/sierra-achieves-aiuc-1-certification
- Finding: Schellman audited Sierra and AIUC tested it across everyday and adversarial scenarios. The certificate covers the platform "underneath those agents". The post says customer-defined policies guide the agent but does not describe testing each customer's deployment.
- Change: a platform certificate does not test each deployment's policy. Say this plainly to buyers of certified platforms: Grapim checks the layer on top.

**NIST AI 800-2 ipd: Practices for Automated Benchmark Evaluations of Language Models.** NIST Center for AI Standards and Innovation (CAISI), initial public draft, January 2026. https://doi.org/10.6028/NIST.AI.800-2.ipd . Comments closed 31 Mar 2026, and the draft is still listed at https://www.nist.gov/caisi/guidelines (page updated 30 Sep 2026).
- Finding: for LLM-as-a-judge, the draft's [Emerging Practice] is to compare against human grading, use multiple judges and compute interrater agreement, and test judge prompts. Practice 3.1: report uncertainty as standard errors or intervals, and report separately the variation from model sampling and the variation from which test items were chosen. It also recommends manual transcript review and suggests releasing a random or representative ("e.g., stratified") sample of transcripts.
- Change: the evidence pack should show an interval per rule, agent-retry variance separately from probe-sampling variance, judge-versus-person agreement, and a stratified sample of transcripts. It is a US government draft, which makes it the easiest text to cite to a client's auditor.

**Who Audits Whom, on What Substrate, with What Evidence? An Independence-Graded Audit Protocol for Agentic AI.** Mohamed Chahine Ghanem, Baidaa Al-Bander. arXiv 16 Sep 2026, v2 31 Oct 2026 (no venue listed). https://arxiv.org/abs/2609.18272
- Finding: the paper grades auditor independence on three axes: principal (who controls the auditor), substrate (whether the auditor shares the auditee's foundation model, toolchain or guardrails) and evidence (attested or self-reported). The weakest axis sets the grade. In a closed-form study with assumed parameters (a 0.90 common-mode share for a same-family auditor, 0.6 reporting probability for an internal team), an internal audit surfaces 5.9% of the faults it could in principle see. The framework is mapped to the amended EU AI Act and ISO/IEC 42006.
- Change: record, per deployment, the model family of the client's agent and of Grapim's judge. Say so when they match, and prefer a judge from a different family. That is the sound reason for a second model family: independence from the agent, not panel accuracy (Kohli). The override log with its actors already supports evidence independence.

**Making AI Compliance Evidence Machine-Readable.** Rodrigo Cilla Ugarte, Miguel Ángel Patricio Guisado, Antonio Berlanga de Jesús, José Manuel Molina López. arXiv 15 Apr 2026, submitted to an IEEE Computer special issue. https://arxiv.org/abs/2604.13767
- Finding: proposes NIST OSCAL, the format used for FedRAMP, as the exchange format for AI governance evidence. It defines 16 property extensions and produces native OSCAL Assessment Results, tested on two EU AI Act Annex III systems.
- Change: later, export the evidence pack as OSCAL Assessment Results JSON alongside the HTML, so a client's GRC tool can import it. Low priority, since this is one paper and not yet a standard.

**Thin area.** I found no 2026 standard or paper that says what an auditor accepts as evidence that a *support agent keeps the company's own policy*. AIUC-1 and NIST AI 800-2 are the closest.

## Seen in search but not opened (unverified)

- "Refusal Is Not Action Safety: Behavioral and Mechanistic Evidence from Tool-Using LLM Agents". I saw only a NeurIPS 2026 listing.
- MAMuT GEPA (Herrera et al., 2026). It is cited in arXiv 2603.03565, but I found no paper.
- "Agent Drift" (arXiv 2601.04170), "Semantic Invariance in Agentic AI" (2603.13173), Chen, Rambachan and Tamer on prevalence from correlated LLM panels (2606.15031), "The Refusal-Compliance Tradeoff" (2605.05427), and the text of ISO/IEC 42006:2025.

---

## Where 2026 work overturns or refines technical-basis-2026-11-09.md

1. **Overturned: Verga 2024 juries, used for accuracy** (technical-basis upgrade 4). Kohli 2026 found nine cross-family judges worth about 2 votes, with the best single judge matching or beating the panel. CARE 2026 shows why majority vote adds little. Drop "jury on close calls" and the "judged by a panel" sales line. A judge from a different family is still worth using, for independence from the agent's model (Ghanem 2026).
2. **Refined: Thakur 2024 "report kappa and the 2x2 table".** Lee 2026 (ICML) says to report sensitivity and specificity from a random human-labelled sample and a bias-corrected rate with an interval. In 2026, pairwise kappa between strong judges on support pass/fail was 0.524 (Laskar 2026).
3. **Refined: the tau-bench user simulator and technical-basis upgrade 3.** LLM customers are too cooperative and inflate success (Zhou 2026; Naous 2025/26; Zhu 2026; Chen 2026), and persona prompts made fidelity worse. Build multi-turn probes as clause-aware attackers (CRAFT 2025) and label them worst-case. Do not claim they are realistic.
4. **Refined: pass^k from identical re-asks** (tau-bench, now in `risk.mjs`). Paraphrase variance is 11x to 58x the rerun variance (Noise Floor Audit 2026), and reliability has more dimensions than consistency (Rabanser 2026). Instability can also come from an ambiguous policy rather than the agent (Policy Loopholes 2026).
5. **Refined: reference-guided judging** (Zheng 2023). One clause per call is right (RubricEval 2026), and batching rules in one call costs accuracy (RuVerBench 2026), so judging all rules at once in `live.mjs` and `guard.mjs` is now contradicted by 2026 data, not only by Thakur's warning. Add rationale before the verdict (Wahi 2026; RubricEval 2026).
6. **New: the judge sees the reply and `actions_taken` together.** A judge reading the outcome misses faults in the actions, and a judge checking the steps misses invented promises (trajectory-judge 2026). Check them separately.
7. **Strengthened: SOP-Bench "make the rule list reviewable".** Policy Loopholes 2026 and the 75+ task fixes in tau3-bench make it specific: audit each rule against five loophole types before spending probes on it.
8. **Made concrete: ST-WebAgentBench CuP and over-refusal.** BLINDSPOT 2026 provides the five outcome classes.
9. **Strengthened: technical-basis upgrade 5, held-out re-tests after a fix.** Lumer 2026 shows selecting on a small sample under a noisy judge inflates gains and a single scalar makes held-out transfer negative. TextReg 2026 and Wahi 2026 (frozen holdouts) point the same way.
10. **Extended: Crescendo and Laban 2025 on multi-turn.** ARCBench, HANDBOOK.md and BLINDSPOT (2026) show rules broken late in a conversation, and later requests treated as permission. PolicyGuard 2026 shows that verifying against the dialogue works better and blocks less.
11. **No 2026 update found** for ToolEmu's 68.8% valid-failure figure, AgentDojo or RuLES. RuLES's case for deterministic checks is reinforced by HANDBOOK.md, CRM-Agent-Bench and Laskar 2026.

## Methods Grapim should adopt (ranked)

1. **Measure the judge, correct the rates, and show it in the evidence pack (S-M).**
   - Per deployment, have a person label a random sample of kept and broken verdicts, compute the judge's sensitivity and specificity, and report bias-corrected broken rates with intervals. This replaces the floor that `judgeRecord()` reports today.
   - Add canary answers with known verdicts to every scan, plus paired fault injection (a forbidden action or an invented promise added to a kept answer).
   - In the evidence pack, state which model family the agent and the judge use, and map the pack to AIUC-1 C002, C010, D003 and D004 and to NIST 800-2 Practice 3.1.
   - Supported by: Lee 2026, Laskar 2026, NIST AI 800-2 ipd, trajectory-judge 2026, Wahi 2026, Ghanem 2026, AIUC-1.
2. **Rationale first, split action and reply checks, outcome classes (S).**
   - In `VERDICT_SCHEMA`, put `what_happened` before `verdict`.
   - Judge `actions_taken` step by step, and separately judge the reply for promises and claims.
   - Replace kept/broken with outcome classes: kept and served, correct refusal, broken, over-refused, unclear.
   - Supported by: Wahi 2026, RubricEval 2026, trajectory-judge 2026, BLINDSPOT 2026, HANDBOOK.md 2026, SABER 2025.
3. **Loophole and coverage pass before probing (S-M).**
   - Tag each extracted rule with any of the five loophole types and send ambiguous ones to client sign-off as questions.
   - Report "N of M clauses tested", list the untested clauses, and show loophole-free results separately.
   - Read `unstable` on an ambiguous rule as "policy unclear".
   - Supported by: Policy Loopholes 2026, tau3-bench task fixes, SABER 2025, POLARIS 2026, Tuan & Sanyal 2026.
4. **Gate fixes on held-out messages, paraphrases and over-refusal (M).**
   - `recheck` and `undoIfWorse` should also run new probes that `draftFix` never saw, plus paraphrases.
   - Revert when any high-severity rule gets worse or over-refusals rise, and require a gain larger than the noise.
   - Flag instructions that copy probe specifics, and track how long the instructions grow.
   - Supported by: Lumer 2026, TextReg 2026, Wahi 2026, Noise Floor Audit 2026, BLINDSPOT 2026, GEPA 2025/26.
5. **Live and guard: relevant rules one at a time, with the dialogue (M).**
   - `checkConversation()` and `guardReply()` should accept earlier turns.
   - Pick the few relevant rules first, then judge each one separately instead of all 40 in one call.
   - Store the conversation length.
   - Supported by: RuVerBench 2026, PolicyGuard 2026, ARCBench 2026, BLINDSPOT 2026; Thakur 2024 and Laban 2025 in technical-basis.
6. **Paraphrased tries in pass^k for high-severity rules (S).**
   - In `judge()`, replace some of the identical re-asks with same-tactic paraphrases.
   - Report consistency (same message) and robustness (paraphrases) separately, as NIST asks for variance split by source.
   - Supported by: Noise Floor Audit 2026, Rabanser 2026, NIST AI 800-2 ipd.
7. **Sampled live rates and change alarms (M).**
   - Weight a sample toward risky conversations, judge it, have a person label a gold subset, and report each rule's rate with an interval.
   - Add change-point alarms on rule and refusal rates, and re-run the high-severity probes whenever the agent's model fingerprint changes.
   - Supported by: Dobi 2026, Lee 2026, Xie 2026, Chishti 2026, Gupta (Nubank) 2026.
8. **Adversarial multi-turn probes, labelled worst-case (M-L).**
   - For high-severity rules, use a clause-aware attacker over 3-6 turns that includes "later request as permission", and run one adaptive round on rules that held.
   - The judge reads the whole transcript, and the report notes the turn where the rule broke.
   - Do not present these as realistic customers.
   - Supported by: CRAFT 2025, Huang 2025, ARCBench 2026, Sim2Real 2026, Chen 2026; Crescendo and Laban in technical-basis.

Not adopted or demoted:
- Juries of judges for accuracy (Kohli 2026).
- Persona-prompted "realistic" simulators (Zhou 2026).
- An OSCAL export and a trained early-failure monitor, both later (Cilla Ugarte 2026, Baidya 2026).
- Workflow-graph guards, a later product (PolicyGuide 2026, JourneyBench 2026).
