# The biggest pain for AI agent vendors and their enterprise buyers (2026, and 2027-2028)

Research brief, 2026-11-09. Public web sources only; nothing from logged-in sites or from contacting anyone.

Labels: **[VC]** = vendor-commissioned or vendor-authored. **[2nd]** = seen only in secondary coverage, primary not read. **[unverified]** = single weak source or conflicting figures. A number with no label was read on the primary page or on two or more consistent trade sources. No number here is estimated by me.

Two audiences:
- **Vendor**: deployment, FDE and solutions leads at Decagon, Sierra, Parloa, NICE Cognigy, Kore.ai, PolyAI, Ada, Lorikeet, Siena, Crescendo, Netomi, Yellow.ai, Uniphore and similar.
- **Buyer**: the enterprise's CX, legal, risk, security and procurement teams.

---

## 1. Ranking, today (late 2026)

| Rank | Pain | Who feels it most | Strength of evidence | Direction to 2027-28 | Can Grapim fix it? |
|---|---|---|---|---|---|
| 1 | **ROI proof**: buyers cannot show the agent paid off (candidate 6) | Buyer (CX leader, CFO) | Strong, independent (Gartner, McKinsey) | Worse: costs per resolution rise, budgets stay flat | No, not directly |
| 2 | **Security, compliance and legal review delays go-live** (candidate 2, the buyer half) | Buyer blocks it; vendor pays for it in time | Medium-strong, but the key survey is vendor-commissioned | Worse: more reviewers, more questions, insurance and certification enter | **Yes, this is the product** |
| 3 | **Data readiness and integration with legacy systems** (candidate 6) | Both | Strong (Salesforce [VC], KPMG) | Slowly better | No |
| 4 | **Reliability and wrong actions after launch** (candidate 3) | Buyer (brand, legal); vendor (churn) | Medium: analyst predictions plus a thin incident record | Worse as agents take more actions | Partly (pre-launch tests, runtime checks) |
| 5 | **Time and cost to deploy each client** (candidate 1) | Vendor only | Medium: timelines and pay are public, per-client hours are not | Better: vendors are automating it themselves | Partly (the review and test part only) |
| 6 | **Keeping quality as models, prompts and policies change** (candidate 5) | Vendor first, buyer next | Weak-medium today (mostly practitioner and vendor writing) | **Sharply worse**: model retirements, policy churn, regulator expectations | Yes |
| 7 | **Regulation and certification** (candidate 4) | Buyer legal; vendor sales | Medium for timing, weak as a 2026 blocker for CX | Grows from Dec 2026 and Dec 2027, but most CX agents are not "high-risk" | Indirectly (evidence that maps to frameworks) |

How to read it: ROI and data readiness are bigger *in surveys*, but they are the enterprise's own problems and Grapim cannot sell a fix for them. Among the pains Grapim can fix, the review and proof gate before go-live has the best evidence today, and keeping that proof current after each change is the strongest future pain.

---

## 2. Evidence for each pain

### 2.1 ROI proof (candidate 6), rank 1 overall

- **Who**: buyer (CX leader, finance). Vendors feel it as renewal risk and in the shift to outcome pricing.
- **Evidence**
  - Gartner analysis of 432 customer-service AI use cases: about a quarter produce positive ROI, a quarter negative, 11% break even, **42% unclear** (leaders do not know the value). Reported by CX Dive, 2026-08-17: https://www.customerexperiencedive.com/news/only-one-quarter-of-ai-customer-service-use-cases-produce-roi/827951/ (Gartner primary not read: [2nd]; the release date is reported as July 2026 by CX Dive and as Jan 2026 by IrisAgent, a conflict).
  - Same piece: 56% of service leaders expect their incentives to be tied to AI outcomes in 2026; teams run about five AI use cases and spend about 13% of the function's budget on AI.
  - Gartner, 2026-01-26: GenAI cost per resolution for customer service will exceed US$3 by 2030, more than many offshore human agents. Press release (403 to my fetch, title seen in search): https://www.gartner.com/en/newsroom/press-releases/2026-01-26-gartner-predicts-genai-cost-per-resolution-for-customer-service-will-exceed-offshore-human-agent-costs-by-2030 [2nd for the US$3 figure].
  - McKinsey State of AI 2026 (fielded 4 May-8 Jun 2026, n=1,719): only 37% say AI contributed to EBIT, flat on 2025; 40% of US$1B+ companies report scaling agents (27% a year earlier). https://www.mckinsey.com/the-state-of-ai
  - Gartner, 2025-06-25: over 40% of agentic AI projects will be cancelled by end of 2027 for rising costs, **unclear business value or inadequate risk controls**. https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027 (2025, kept because it is the main forward-looking anchor).
  - Gartner survey of 321 service leaders (Oct 2025, published 2026-02-18): 91% under executive pressure to implement AI in 2026. https://www.ictbusiness.biz/analysis/customer-service-leaders-are-under-pressure-to-implement-ai-in-2026 (Gartner page 403; [2nd] but consistent).
- **Direction**: worse in 2027. Pressure to deploy stays high while proven returns stay flat, and cost per resolution is forecast to rise.
- **Who sells a fix**: the agent vendors themselves (outcome pricing: Sierra, Fin, Decagon; Sierra's US$1-2.50 per resolution is [unverified]), CX analytics (Cresta, being bought by Salesforce for about US$2.7B, announced 2026-11-02: https://futurumgroup.com/insights/salesforce-moves-to-acquire-cresta/), BI tools. Not Grapim's fight, but note the link: Gartner's "inadequate risk controls" sits next to "unclear value" as a cancellation cause.

### 2.2 Proving the agent follows the client's own policies (candidate 2), rank 2 overall, rank 1 of the pains Grapim can fix

- **Who**: the buyer's security, legal and compliance reviewers create the gate; the vendor's deployment lead waits on it and does the work to pass it.
- **Evidence**
  - EMA for Protegrity, published 2026-07-30: **82.9%** of organisations had AI projects delayed before production by security or compliance reviews; 81.6% deployed AI in a reduced form; over two-thirds of delayed projects stalled at least a month; **nearly 30% stalled four months or more**; 69% run agents that can write to databases or trigger APIs; top concerns data leakage from agent actions (62.5%) and regulatory compliance (48.7%); 47.4% say cutting manual audit and compliance cost is the most valuable outcome. https://securitybrief.news/story/enterprise-ai-deployments-slowed-by-security-reviews **[VC]** (Protegrity sells data security; sample reported as 152 IT and security leaders in one search summary, not on the page I read). Not CX-specific.
  - Apono (Feb 2026): 98% say security and data concerns slowed agentic AI, added review steps or cut scope; 21% faced significant delays. https://techintelpro.com/news/cybersecurity/ai/apono-2026-report-security-slows-agentic-ai-adoption **[VC]** [2nd].
  - KPMG AI Pulse Q2 2026 (tech sector): 99% cite data security, privacy and risk concerns; Q3 2026 asset management: three out of four organisations do not let agents touch sensitive data without human oversight, more than double the prior quarter. https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2026/tech-aipulsesurvey-q2.pdf , https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2026/ampe-aipulsesurvey-q3.pdf (small sector samples, about 100 each; [2nd] via search snippets).
  - Zendesk CX Trends 2026: 95% of consumers want an explanation of AI decisions; only about 35% of organisations keep a clear, auditable record of AI decisions. https://s3.amazonaws.com/external_clips/5181339/Zendesk_CX_trends_report_2026.pdf **[VC]** [unverified: the 35% and 37% figures are attributed to different groups in different write-ups].
  - Enterprise AI deal cycles: security, legal and governance stages reported to take 40-60% of cycle time, median security stage up from 5.4 to 13.2 weeks. https://getscaled.com/university/the-procurement-inversion **[VC]** [unverified, no dataset shown].
  - Vendors themselves now publish this need. Lorikeet's own guide tells teams to agree pass thresholds before launch, keep a zero-tolerance list, and keep **an evidence pack per release with approver and before/after results**. https://www.lorikeetcx.ai/articles/ai-support-agent-regression-testing-model-changes-2026 **[VC]** (page dated Oct-Nov 2026).
  - Certification demand: AIUC-1 held by UiPath (Mar 2026), Intercom Fin, ElevenLabs, Sierra; AIUC raised about US$40M (Sep 2026). See research_notes/competitive-landscape-2026-11.md section 3 and https://itbrief.com.au/story/uipath-secures-landmark-aiuc-1-certification-for-ai-agents . The claim that certification is already "a common procurement requirement" is [unverified].
  - Our own lead signal: Lorikeet's Head of Forward Deployed writes that client policies are full of unwritten judgement (outreach/how-icp-uses-grapim-zh.md). Anecdote, not data.
- **Gap in the evidence**: no 2026 source isolates *CX agents* or quantifies how long a buyer's legal review of a customer-facing agent takes. The strongest numbers are cross-industry and vendor-commissioned. Treat "legal review blocks go-live" as well supported in direction, not in size, for this niche.
- **Direction**: worse to 2027-28. More agents take actions (69% per EMA), AI insurance enters (Gartner, 2026-04-02, tells general counsel to assess affirmative AI insurance: https://www.gartner.com/en/newsroom/press-releases/2026-04-02-gartner-says-general-counsel-should-assess-ai-insurace0to-mitigate-ai-risks), and insurers and certifiers want evidence.
- **Who sells a fix**: vendor-level only. AIUC-1 (certifies the vendor, not each client's rules), Vanta/Drata (questionnaires, AIUC-1 guides), Hamming (compliance reports, voice), Coval (per-customer-org layer, no sign-off), vendors' in-house simulators (Sierra, Decagon, Fin, Cresta Testing 2.0). Nobody found ships a per-client policy test plus client sign-off record (competitive-landscape-2026-11.md).

### 2.3 Data readiness and legacy integration (candidate 6), rank 3

- **Who**: both. Integration work is the FDE's biggest single task; data readiness is the buyer's.
- **Evidence**
  - Salesforce State of Service, AI agents edition: 63% (another summary says 72%) call data readiness a major blocker; 70% say data privacy concerns delay rollouts. https://www.salesforce.com/news/stories/ai-service-agents-improve-customer-satisfaction/ **[VC]** [2nd; two figures conflict].
  - KPMG Q3 2026 asset management and PE: data readiness and access is the top barrier to agent deployment at 76%; banking Q3 2026 says the same. https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2026/ampe-aipulsesurvey-q3.pdf , https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2026/banking-aipulsesurvey-q3.pdf [2nd].
  - Decagon's FDE lead describes FDE time as configuring agents, integrating back-end systems, agreeing success metrics and advising on what to automate; Decagon hand-built CRM integrations until about the 25th, then productised. https://ai.engineer/talks/how-forward-deployed-engineering-is-done-at-decagon (AI Engineer World's Fair 2026; integration-count detail from search summary [2nd]).
- **Direction**: slowly better; connectors and MCP standardise access. **Fix sellers**: iPaaS, MCP servers, the agent platforms. Not Grapim's lead.

### 2.4 Reliability, hallucination and wrong actions after launch (candidate 3), rank 4

- **Who**: buyer (brand, legal liability); vendor (churn, incident handling).
- **Evidence**
  - Forrester Predictions 2026: one third of brands will erode customer trust through premature deployment of GenAI chatbots and virtual agents; service quality will dip before it improves. https://www.forrester.com/blogs/2026-the-year-ai-gets-real-for-customer-service-but-its-not-glamorous-work/ , https://www.businesswire.com/news/home/20251028963453/en/ (published Oct 2025 for 2026).
  - LangChain State of Agent Engineering (1,300+ respondents): quality is the top barrier to production at 32%, top for the second year. https://langchain.com/state-of-agent-engineering **[VC]** (developer audience).
  - Futurum (n=820): reliability and hallucination management is the top GenAI challenge for 55%. https://futurumgroup.com/insights/has-agentic-ai-in-customer-service-finally-delivered-on-its-promise/ [2nd].
  - Gartner, Sep 2025 (IT application leaders): doubts about vendors' security, governance and hallucination protection are the main barriers to autonomous agents; only 15% considering fully autonomous agents. https://www.gartner.com/en/newsroom/press-releases/2025-09-30-gartner-survey-finds-just-15-percent-of-it-application-leaders-are-considering-piloting-or-deploying-fully-autonomous-ai-agents
  - Incidents: Moffatt v Air Canada (2024) is still the cited precedent; Cursor's support bot invented a policy (2025, AIID 1039); AIID 1765 (2026-10-15) records a Fin-handled $3,500 refund dispute that dragged for weeks (attribution in the entry looks odd, [unverified]). https://incidentdatabase.ai/cite/639 , https://incidentdatabase.ai/cite/1039/ , https://incidentdatabase.ai/cite/1765 . **I found no new 2026 court ruling** on a customer-service bot inventing a policy. The public incident record is thin; most failures are probably private.
  - Gartner, 2026-04-02: "death by AI" legal claims to exceed 2,000 worldwide by end of 2026; general counsel should assess AI insurance. (link in 2.2). Not CX-specific.
- **Direction**: worse in exposure (more actions, more volume), probably better per conversation as models improve. **Fix sellers**: vendor simulators and monitors (Sierra, Decagon Watchtower, Fin), Coval, Cekura, Hamming, Bluejay, Patronus, runtime guards (Splunk/Galileo, Guardrails), insurers (AIUC, ElevenLabs agent insurance).

### 2.5 Time and cost to deploy each new client (candidate 1), rank 5

- **Who**: vendor only. The buyer feels it only as "weeks to go-live".
- **Evidence**
  - Timelines: Decagon about six weeks from contract to production (competitor-written, eesel: https://eesel.ai/blog/decagon-vs-sierra **[VC]**); Sierra case studies 4-10 weeks (Vivid Seats 4, Singtel under 10); Sierra built Nordstrom's agent in four weeks per Bret Taylor [2nd].
  - Headcount and pay: Decagon "Agent Deployment Engineer" and "FDE, Agent Builder" roles own a strategic customer's build from scoping to launch, US$175-230k plus equity (https://jobs.accel.com/companies/decagon-2/jobs/78560265-agent-deployment-engineer); Parloa senior FDE US US$160-230k, one posting is about "unblocking go-lives under pressure" (https://jobs.generalcatalyst.com/companies/parloa/jobs/90479298-forward-deployed-engineer-us). Decagon grew from about 50 to 500 people in a year (company headcount, not FDE).
  - Margin: FDE-heavy revenue is debated as "glorified professional services"; ICONIQ-based estimate of 52% average gross margin for AI companies in 2026 vs 41% in 2024. https://www.saastr.com/iconiqs-latest-state-of-ai-report-the-10-most-important-data-points-for-saas-founders [2nd]; no public per-client FDE-hours dataset exists.
  - Vendors are fixing it themselves: Sierra Ghostwriter (launched 2026-03-25) builds agents from plain English and runs tests on every build; Agent Studio rebuilt around it 2026-11-02 (https://sierra.ai/jp/product/ghostwriter , https://www.unite.ai/fr/sierra-puts-ghostwriter-at-the-center-of-agent-studio-workflows/). Decagon's stated aim is natural-language configuration and each deployment faster than the last.
  - Capital to absorb the cost: Sierra US$950M at US$15.8B (2026-05-04), US$150M ARR disclosed Feb 2026; Decagon US$250M at US$4.5B (Jan 2026); Parloa US$350M at US$3B (2026-01-15). https://www.axios.com/pro/enterprise-software-deals/2026/01/15/agentic-ai-startup-parloa-raises-350m-at-a-3b-valuation , https://builtin.com/articles/decagon-raises-250m-series-d-4b-valuation-20260130 . The top vendors are not short of money for FDEs; mid-tier vendors are.
- **Direction**: better for the build step (agent-building agents), not for the review step. As build time falls, the share of time-to-live spent waiting on the client's review and sign-off rises.
- **Fix sellers**: the platforms themselves (Ghostwriter, Agent Studio, Decagon AOPs, Fin procedures), plus SI partners. Selling "faster builds" puts Grapim against Sierra's and Decagon's own roadmaps.

### 2.6 Keeping quality as models, prompts and policies change (candidate 5), rank 6 today, top future pain

- **Who**: vendor first (every model or prompt change touches every client); buyer once it bites (re-review, incidents).
- **Evidence**
  - Model retirement churn: provider deprecation tables (e.g. gpt-4o enterprise retirement listed for 2026-10-01: https://docs.synthflow.ai/model-deprecation-dates ; UiPath forum notice that community LLM deprecations require agent redeployment: https://forum.uipath.com/t/community-llm-models-deprecation-agent-update-and-redeployment-required/5765568 ). "67% of agents drift within 12 months" (https://agentmarketcap.ai/blog/2026/04/16/agent-behavioral-drift-silent-model-updates-canary-deployment) is [unverified], do not use.
  - Regulator expectation: UK PRA SS1/23 expects before-and-after comparison for material model changes; in the US, SR 26-2 replaced SR 11-7 on 2026-04-17 and leaves gen/agentic AI outside formal scope, so banks set their own controls (via Lorikeet's guide **[VC]**, and competitive-landscape-2026-11.md).
  - Vendors now ship it as a feature: Ghostwriter "runs tests with every build or update"; Lorikeet says to treat every model, prompt, workflow or knowledge change as a release.
- **Direction**: sharply worse to 2027-28. Each vendor runs N clients x frequent model swaps x client policy edits; each change can silently break one client's rule, and the client's sign-off goes stale.
- **Fix sellers**: vendor in-house regression (Sierra, Decagon, Fin), Coval, Cekura, Braintrust, LangSmith. None found re-issues the *client's* sign-off after a change.

### 2.7 Regulation and certification (candidate 4), rank 7 today

- **Who**: buyer legal and compliance; vendor sales (questionnaires).
- **Evidence**
  - EU AI Act Digital Omnibus: provisional deal 2026-05-07; Annex III high-risk moved to 2027-12-02, Annex I to 2028-08-02; Article 50 transparency for systems already on the market moved to 2026-12-02. https://datamatters.sidley.com/2026/06/22/eu-lawmakers-reach-provisional-agreement-to-delay-key-eu-ai-act-obligations/ , https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/ . Final adoption reported 2026-06-29 by one source; Official Journal publication [unverified].
  - Most customer-service agents are limited-risk (disclosure duties), not Annex III high-risk, unless they touch credit, insurance pricing or access to essential services. So the Dec 2027 date matters for banking and insurance clients, not most CX.
  - US: Colorado replaced its AI Act with a narrower law effective 2027-01-01; CFPB says firms stay liable for chatbot failures (see competitive-landscape-2026-11.md section 4 for sources).
  - Certification: AIUC-1 and ISO 42001 are vendor-level badges; see 2.2.
- **Direction**: grows in 2027-28 (Dec 2026 transparency, Dec 2027 high-risk, insurer requirements), but as a *reason* buyers ask for evidence, not as a separate pain a CX lead names first.
- **Fix sellers**: GRC tools (Vanta, Drata, OneTrust, Credo AI), certifiers (AIUC, Schellman), law firms.

---

## 3. Answers

**Which one pain to lead with today.** The client's review gate: proving the agent follows *that client's* rules so legal, risk and security sign off and the client goes live. It is the highest-ranked pain that Grapim can actually remove, it is felt by both sides (buyer blocks, vendor waits), and no one sells a per-client version. ROI and data readiness rank higher in surveys but are not Grapim's to fix.

**Strongest future pain (2027-28).** Keeping that proof true after every change. Model retirements, prompt edits and client policy updates multiply across a vendor's client base, while insurers, certifiers and (for banks and insurers) the EU high-risk regime from Dec 2027 want before-and-after evidence. "Signed once" becomes "re-signed every release".

**"Prove the agent follows each client's rules" vs "deploy each client faster".** The evidence supports *proof* as the lead, with *faster go-live* as the payoff, not the other way round:
- The buyer-side evidence is about review and proof (EMA 82.9% delayed, about 30% stalled four months or more; Gartner names inadequate risk controls as a cancellation cause). There is no comparable buyer-side evidence that build effort is what blocks go-live.
- "Deploy faster" as a build claim walks into Sierra's Ghostwriter and Decagon's natural-language configuration, which the vendors are already shipping for themselves.
- Caveats: the review-delay numbers are vendor-commissioned and cross-industry, and none isolates CX agents. Our demand test (0 replies as of 2026-11-08) has not confirmed it with deployment leads yet. The one-question follow-up ("what did your last client's legal or security team ask you to prove?") is the right test of this claim.

**Recommended headline**

> Your client's rules, tested and signed off, so go-live never waits on their legal team.

Supporting points:
1. **Reviews, not builds, hold up go-live.** 82.9% of organisations had AI projects delayed by security or compliance review, and nearly 30% stalled four months or more (EMA for Protegrity, Jul 2026 [VC]). Grapim turns the client's own policy into tests and a sign-off page their reviewers can keep.
2. **Proof per client, not just a vendor badge.** AIUC-1 and SOC 2 certify the vendor; only about 35% of organisations keep an auditable record of AI decisions (Zendesk CX Trends 2026 [VC][unverified]), and vendors such as Lorikeet now tell teams to keep an evidence pack with an approver for every release. Grapim produces that record for each client.
3. **It stays true after every change.** Every model swap, prompt edit or policy update can break one client's rule; Gartner expects over 40% of agentic projects to be cancelled by 2027, partly for inadequate risk controls. Grapim reruns the client's rules on each change and re-issues the sign-off.

---

## 4. Twelve-line summary

1. Biggest buyer pain in surveys is ROI proof: about 25% of 432 Gartner CX AI use cases show positive ROI, 42% unclear (CX Dive, Aug 2026); McKinsey 2026: 37% see EBIT impact.
2. Next is data readiness (KPMG Q3 2026: 76% top barrier; Salesforce [VC]: 63-72%). Grapim can fix neither.
3. Among fixable pains, the review gate ranks first: EMA for Protegrity [VC] says 82.9% had AI delayed by security/compliance review, about 30% for four months or more.
4. Evidence gap: no 2026 source isolates CX-agent legal review time; numbers are cross-industry and vendor-commissioned.
5. Reliability is a real but thinly evidenced pain: Forrester predicts a third of brands erode trust with premature bots; no new 2026 court ruling found after Moffatt.
6. Per-client deploy cost is a vendor-only pain (4-10 weeks, FDEs at US$160-230k), and Sierra and Decagon are automating the build step themselves.
7. Regulation is a 2027-28 driver (Article 50 Dec 2026, Annex III Dec 2027) but most CX agents are not high-risk; it feeds evidence demand rather than being the pain.
8. Strongest future pain: keeping per-client proof valid through model retirements, prompt edits and policy changes.
9. No one found sells per-client policy tests plus client sign-off; AIUC-1, Vanta and vendor simulators work at vendor level.
10. Lead with proof of each client's rules, sold as the thing that unblocks go-live; "deploy faster" alone collides with vendor roadmaps.
11. Headline: "Your client's rules, tested and signed off, so go-live never waits on their legal team."
12. Validate with the demand test's question about what the last client's legal or security team asked to prove; 0 replies so far.
