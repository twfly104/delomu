# Unicorn hands-on vs Grapim (2026-11-10)

Method: Claude in Chrome, the user's real Chrome, one new tab (closed after). Look only: no sign-ups, sign-ins, form submits or setting changes. One cookie banner (sierra.ai) declined with "Reject All". Measurements come from `getComputedStyle`, element boxes and `innerText` word counts in the page, plus screenshots.

Viewport for every desktop measurement: **1280 x 529** (the Chrome window is short, so "above the fold" here is about 529px tall, not a full laptop screen).

## Limitations (plain)

- **Mobile 390px not tested on any site.** `resize_window` reported success twice, but the page viewport stayed 1280x529, probably because the window is maximized. Embedding the page in a 390px iframe was blocked by Grapim's frame-ancestors policy. The mobile rows below cover only what can be seen without rendering at 390px.
- **decagon.ai blocked.** Both `decagon.ai` and `www.decagon.ai` returned only the text `edge-module-ok GET https://webflow2.decagon.ai/.dispatch_worker/`. Nothing from Decagon is used below.
- **Signed-in unicorn products:** only **Vercel** was signed in (team "rushsol", Hobby). These were not signed in and I stopped at the sign-in page: Linear (`linear.app/login`), Stripe (`dashboard.stripe.com/login`), Intercom (`app.intercom.com/admins/sign_in`). Notion (`notion.so`) redirected to the public marketing site. So every product-pattern citation below is Vercel. Linear's in-app patterns are cited only where its landing page shows a real UI replica.
- **Grapim client sign-off page not reached.** The open link's URL is not shown anywhere in the app (the rollout page HTML has only `/signoff/revoke`), and making a new link would create data, so I did not. I saw the in-app "Handover for the client" page and the landing's sign-off mock instead.
- I did not press "Run check again", "Send sample traffic", "Create a new link" or any approve buttons in Grapim, so I did not observe Grapim's live loading or progress UI in the app. The landing video does show it.

## What I saw, per site (desktop 1280x529)

| Site | Hero headline | Above-fold words / total words | Sections | Shows product as | Proof | CTAs above fold | Motion | Type / theme |
|---|---|---|---|---|---|---|---|---|
| linear.app | "The product development system for teams and agents" (64px, wt 510, -1.4px tracking) | 29 / ~1,293 | 8 `<section>`, 7 h2 | A full-width, real-looking **app replica**: issue DRV-8852 with activity feed, agent side panel "Thinking…", sidebar. Later sections show the board, roadmap timeline and PR diff, all as live HTML, not images | "Linear powers over 50,000 product teams", 2 named quotes (OpenAI, Ramp), logo strip | 2 (Log in, Sign up) plus a "New: Loops →" chip | 82 running animations. Hero text fades in after load (first screenshot was blank), agent panel types "Thinking…" | Dark (#08090A), Inter Variable 16px body |
| vercel.com/home (vercel.com sends a signed-in user to the dashboard) | "Agentic Infrastructure" (64px, wt 400, -3.84px tracking), with 3 one-line qualifiers on the right | 28 / about 91 at load, 257 after scrolling (content mounts as you scroll) | 10 | Hero is a 3D triangle mark. Below it, a real-looking AI chat UI ("How can I help you today?") inside a Notion case | Logo strip right under the hero (Meta, DoorDash, OpenAI…), stat tiles "450K+ agents built / 9,000+ / 3.39M+" | 2 (Deploy now, Talk to sales) plus "Ask AI" | Sections reveal on scroll. Large empty bands before each reveal | Light (#FAFAFA), Geist |
| stripe.com | "Financial infrastructure to grow your revenue." in dark, then the rest of the sentence in grey (34px, wt 300) | 86 / ~1,750 | 16 | Product **UI cards** in a bento grid (checkout page "roastery.com/checkout", "Pro Plan Billed monthly" invoice, a card-issuing visual) | A live-ticking "Global GDP running on Stripe: 1.74672138%" counter above the h1, logo row (OpenAI, Amazon, NVIDIA, Ford, Coinbase, Google, Shopify) | 3 (Get started, Sign up with Google, Contact sales) | Animated gradient ribbon, particle globes, the counter ticking | Light, sohne-var |
| sierra.ai | "Better outcomes. Built on Sierra." (65px, wt 400) over a full-bleed video (sleeping baby) | 37 / ~513 | 16 | Lifestyle video in the hero. Product shown later (Ghostwriter "Build / Optimize" panels, Explorer/Monitors/Experiments) | Logo wall (Singtel, SoftBank, Singapore Airlines…), 4 executive quotes, "Trust and reliability" block | 1 (Learn more) plus Sign in | Hero video. Gradient cards | Light, gtAmerica, very airy, centered |
| vanta.com | "Get your compliance together" (56px serif "SC Ripley") | 44 / ~701 after scroll | 9 | **Scroll-driven product cards** in the hero: "15 tools now connected · Monitoring", then "One test needs remediation · S3 is not encrypted · Critical · Generate fix" with a cursor clicking | Logo strip pinned at the bottom of the hero (ramp, Cursor, Snowflake, Clay, Lovable, Samsara). "Proof? We've got proof." section, Forrester Wave Leader | 1 email field + "Get a demo" (the header repeats Get a demo and Log in) | Hero cards animate on scroll. A chat widget auto-opens on scroll ("Welcome to Vanta 👋") | Light purple hero block, Soehne body, serif display |
| **grapim.com** | "Go-live never waits on your client's legal team. Their rules, tested and signed off." (55px, wt 620, Geist, second sentence in grey) | **121** / ~700 | 13 (12 h2) | Below the hero: a 5-column "Client rollouts" board (Draft → Check → Fix → Sign-off → Live) built from real app components; then a recorded product video; then 5 step sections, each with a real UI card | 3 trust ticks ("Never used to train models", "Each client's data kept apart", "Tamper-evident audit log"). **No customer logos, no usage numbers, no quotes** | 3 + banner (Start free in the nav, Start free, Become a design partner; top banner "Design partners: first cohort, 5 spots Apply →") | 252 running animations (pixel-grid hero background, board cards animate in). The video autoplays muted, 1039x649 | Light (#FAFAFA), Geist **14px body** |

Grapim specifics measured:
- The board ("Your workspace / Client rollouts") starts at **y=559**, just below a 529px fold. On a short window the first screen is the headline, the subline and the CTAs over an animated dot grid, with no product in view.
- The video section starts at y=1137. Its first frames are a **title card** (Grapim logo, then "Recorded live. Real product, sample client.") before any product appears.
- Big empty bands between step sections (for example about 300px of blank space between "Drafted from the client's docs" and "Every rule, tested hard").
- Page height is 6,711px. No horizontal scroll at 1280.

## Vercel product patterns (signed in, read only)

| Pattern | What Vercel does (URL) |
|---|---|
| Home / overview | `vercel.com/rushsol`: a two-column team overview. Left: a Usage card with meters ("CDN Requests 7.4K / 1M"), Alerts (empty state), Recent Previews. Right: one project card each, with live domain, last commit message, branch and date, plus a status ring. Search field "Search Projects…" with a `/` hint |
| List with status | `vercel.com/rushsol/~/deployments`: dense one-line rows (project · commit message, truncated · ●Ready 5s · Production pill · commit hash · branch icon · date · avatar). Filter chips "Author / Environment / Status" with "Add Filter". Hovering the status dot shows a tooltip ("This deployment is ready."). "Load More" at the bottom |
| Loading | The same deployments URL first renders a **skeleton of the exact row layout** (grey pills where each column goes), then swaps in the data after about 3s. The deployment logs and project analytics pages also show skeletons that match their layout |
| Detail page | `vercel.com/rushsol/outrovo_test1/<id>`: a **screenshot of the deployed site** on the left. Right side: a key/value grid (Created, Status, Duration "5s 23d ago", Environment "Production · Current", Domains, Source branch + commit). Header actions: Share, Logs, **Visit (one primary)**, and a "…" menu. Tabs: Deployment / Logs / Resources / Source / Open Graph. A collapsible "Deployment Settings · 2 Recommendations" |
| Share / approval | The Share button opens a modal: "Choose who can **view and comment** on outrovotest1.vercel.app", an "Add team members or emails…" field, a "People with access" list, an access dropdown ("Only people with access can view and comment") and **Copy Link** |
| Command menu | Ctrl+K opens "Find" anchored to the sidebar search (Esc hint). The suggestions are **contextual to the current page** (Deployments · outrovo_test1, Domains, Build Machines, Firewall) plus an AI entry: **"what did we deploy today?" · Navigation Assistant** |
| Keyboard | The sidebar search shows a `F` key hint, the project search shows `/`. Pressing `?` did nothing visible |
| Empty state | Alerts: a bell icon, "Get notified when usage or errors spike across your projects.", button "Upgrade to Pro". Web Analytics (not enabled): the pitch, "Enable" and "Limits & Pricing", with a **populated preview of the metric tiles beneath it** (Visitors 18,138 / Page Views 54,414 / Bounce Rate 52%), so you see what you would get |
| Nudges | A small dismissible "Enable 2FA" card in the sidebar footer. A notification bell with a dot |
| Linear (landing replica only) | Issue page with "1 / 84" position counter, an activity timeline that mixes human and agent events ("Triage Intelligence added the labels…", "Linear moved from Todo to In Progress · just now"), and a properties side panel (status, priority, assignee, cycle, labels) |

## Grapim product walk (localhost:8799, test user chromewalk1@example.com)

| Page | What I saw |
|---|---|
| Home `/` | "AI agents · 1 AI agent" table (AI agent, Organization, Rollout "● Waiting on client", Pre-launch check "● All 8 rules kept", Live "Not connected", Last checked "3 h ago"), then "Waiting for your decision (1)" and "Waiting on the client (1)" inbox rows with Review / Open buttons. Sidebar: Home (1), Organizations: Northwind Agents, Harbor Bank (managed). No search, no metrics, no keyboard hints. Ctrl+K and `?` did nothing visible |
| Vendor org `/orgs/org_708f…` | Titled "Clients": 3 stat tiles (1 Clients · 1 AI agent / **1 Need attention** in red / 0 Live), a table (Client, Status "1 draft to review", Stage "Waiting for client sign-off", Last checked), and buttons "Rollout metrics" and "+ Add client". **A second, different overview** from Home |
| Rollout | Header "Linden & Co. · Lia ● All 8 rules kept", sub-line "Linden & Co. (sample) · HTTP endpoint". Tabs: Rollout 1 / Check results / Live / Policies 4 / Settings. A 6-step grid: "2 of 6 steps done · Next: 1 draft…", **step 1 "Data mapping: Not started" while steps 2 and 4 are done**. Two buttons side by side: "Review 1 draft" (filled) and "Run the rollout". Then a "Client sign-off" card (Opened 2 h ago · Waiting · 1 open link, "Create a new link", "Revoke 1 open link"), a client question with its answer, and "More settings". The sidebar on this page gains "AI agents" and "Audit log", which Home's sidebar does not have |
| Check results `/scan` | A large green "All 8 policy rules kept", "After the fix: 2 → 0 rules broken, 3 → 0 messages failed", Broken → kept chips, buttons "Customer report" and "Evidence pack". An 8-tile rule grid where **all 8 file names are cut off** ("returns-and-support-policy.md…"). Then a "Ready for … sign-off" card, a "Check the judge" spot-check (1 of 5 reviewed) with full transcripts and a tool call shown in monospace and cut mid-word ("…file a chargeback wit"), and finally a "Kept" list **repeating the same 8 rules**. 2,888px tall, 858 words |
| Live | 3 zero tiles (0 Conversations checked / 0 Broke a rule / 0 of 8 Policy rules broken), "No conversations yet. Connect the help desk, or send sample traffic.", "Send sample traffic", and a Set up rail (Connect the help desk, Check one conversation, Slack alerts Off) |
| Policies | A file table (name, size, added), then importers (Zendesk, Intercom, Shopify), a **native unstyled "Choose files / No file chosen" input** plus Upload, and "Add a public policy page". File rows are not links (no preview) |
| Settings | MCP snippets with **placeholders** `https://YOUR-GRAPIM/mcp` and `YOUR_KEY`. Sections: Check every change in CI, Public page, Connection and acceptance, Decisions |
| Review (drafts) | "The agent proposes. You approve, edit or reject." Test-case table that shows raw slugs ("risk-return-window-30-days-1", "risk high return window 30 days") and field names (`deliveredAt`) |
| Audit log | Hash-chain integrity "● Intact", an events table with raw event names ("judge spotcheck", "signoff answer", "fix apply"), targets as raw IDs ("sample-linden-agent/2026-11-09T13-05-28-510Z-1dd1"), IP 127.0.0.1, and the CSV export described as an API path (`GET /v1/orgs/…/audit_events.csv`) rather than a button |
| Evidence pack `evidence.html` | A clean document: title, period, snapshot hash, a "To save as PDF: Print (Ctrl+P…)" line, 4 stat tiles (2 Checks run / 2 Broken rules fixed / 1 Fix approved / **0 Live conversations checked**), 4 tables, 11 sections, 1,237 words, print CSS present. The text written for legal readers includes developer jargon: "its `recheckOf` field", "`fix.apply`, `fix.applied_manually` and `fix.revert`", "`fix.json`", and raw check IDs. Approved fixes row: "Approved and applied by Grapim" while the By column is chromewalk1@example.com |
| Handover `/handover` | A centered, client-facing page: "Northwind Agents' AI agent for **Harbor Bank**", "8 of 8 kept", each rule with a "Kept" pill and the quoted policy text. Browser tab title "Handover · **sample-linden-agent** · Grapim" (a raw slug) |
| Naming | The same rollout calls the client "Harbor Bank" (Home Organization column, Handover, Evidence pack title) and also "Linden & Co. (sample)" (header sub-line, "Ready for Linden & Co. (sample)'s sign-off"). Home also contradicts itself: "All 8 rules kept" in the table, and in the row below it "From the check on 2026-11-09: 2 of 8 policy rules broken" |
| Mobile (static evidence only) | The app stylesheet has 13 different max-width breakpoints (420, 480, 520, 560, 640, 760, 860, 900, 960, 1000, 1100…), plus dark mode and reduced-motion rules. Not rendered at 390, see Limitations |

## Gap tables

### Landing
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| The product is in the first screen or right under it: Linear's full app replica (linear.app), Vanta's animated "S3 is not encrypted · Critical · Generate fix" cards (vanta.com), Stripe's checkout and invoice UI cards (stripe.com) | The board starts at y=559, below a 529px fold. The first screen is headline + subline + CTAs + a dot grid | On a short laptop window the first screen shows no product |
| Hero copy is short: Vercel 2 words, Sierra 5, Vanta 4 + a 14-word subline. Above-fold words: 28–44 (Linear 29, Vercel 28, Sierra 37, Vanta 44). Stripe is the exception at 86 | 16-word h1 in two sentences, a 20-word subline, a banner. 121 words above the fold | About 3x the words of most peers before the product shows |
| Proof sits near the top: logo strips (Stripe, Vercel, Vanta, Sierra), numbers ("50,000 product teams", "450K+", the live GDP counter), named quotes | 3 trust ticks. No logos, numbers or quotes | No social or numeric proof. The design-partner banner signals "early" |
| The recorded demo starts on product (Linear's replicas are live HTML) | The video opens on a logo title card and then a text card before any UI | The first seconds of the video are spent on branding |
| Section rhythm: Linear 7 h2 over 9,600px, all product-dense | 12 h2 over 6,700px, with ~300px blank bands between step sections | Feels sparse between steps rather than dense with product |

### Home / overview
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| Vercel `vercel.com/rushsol`: one overview. Usage meters + alerts + a card per project with its last change, a status ring and a search with a `/` hint | Two different overviews: Home (an "AI agents" table + inbox) and the vendor org page "Clients" (stat tiles + table). Home has no metrics and no search | A deployment lead sees two "homes" with different layouts and counts |
| Status is consistent across the page | Home table "All 8 rules kept" vs the inbox row "2 of 8 policy rules broken" (older check, same screen) | A contradiction on the first screen of a demo |

### Lists
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| Vercel `/~/deployments`: dense rows, a status dot + word + duration, an env pill, filter chips, a tooltip on status, Load More | Home and Clients tables are fine but have no filters, sorting or search. Policies file rows are not clickable. Check-results rule tiles cut off all 8 file names | No filters/search. Cut-off source names that a legal reader cares about |
| Raw IDs are hidden or short (commit hash `e991669`) | Raw slugs shown to the user: "risk-return-window-30-days-1", "sample-linden-agent/2026-11-09T13-05-28-510Z-1dd1", `deliveredAt` | Engineering identifiers leak into the UI |

### Detail
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| Vercel deployment detail: a visual preview of the thing (a site screenshot), a key/value grid, **one primary action (Visit)**, secondary Share/Logs, and a "…" menu | Agent header: a status chip + More + "Run check again" (primary) on most tabs. The Rollout tab has two buttons side by side ("Review 1 draft" filled, "Run the rollout"). No "what the agent looks like" preview (for example one sample conversation) in the header | The primary action changes per tab. No at-a-glance proof card |
| Linear issue replica: a properties side panel + an activity timeline mixing human and agent events | Rollout uses a 6-step grid. Step 1 says "Not started" while later steps are done. Activity lives only in the separate Audit log, which uses raw event names | No human-readable timeline on the agent. The step order reads as broken |
| Check results would be one screen of verdict + evidence | The 8 rules appear twice (top grid, bottom "Kept" list). 2,888px long | Repeated content makes the strongest page long |

### Sign-off / share
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| Vercel Share modal: who can view and comment, people with access, an access-level dropdown, **Copy Link**, all in one place | Rollout card: "Opened 2 h ago · 1 open link", "Create a new link", "Revoke 1 open link". The existing link cannot be copied again. Client Q&A sits underneath | You cannot re-copy or see who the open link went to. There is no "people with access" view |
| A single name for the counterpart | The client is "Harbor Bank" in some places and "Linden & Co. (sample)" in others. The handover tab title shows the slug | The name confusion is exactly what a legal reviewer would question |

### Empty / loading
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| Vercel Web Analytics (not enabled): pitch + Enable + a **populated preview** of the tiles. The Alerts empty state has an icon, one line and one CTA | Live: three big "0" tiles and a one-line message. The evidence pack leads with a "0 Live conversations checked" tile | Zeros instead of a preview of what Live will show |
| Vercel: skeletons that match each page's layout on deployments, logs and analytics | Server-rendered pages appear at once, so no app skeletons were seen. Run progress was not observed in the app (I did not start a run). The landing video shows "Checking…" and "Re-checking 16 messages" states | Not tested in the app. The landing suggests progress UI exists |

### Nav / keyboard
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| Vercel Ctrl+K: a contextual "Find" with recent entities, settings pages and an AI question ("what did we deploy today?"). `F` and `/` hints shown in the inputs | Ctrl+K and `?` did nothing visible. No `<kbd>` hints. No search inputs | No command menu or search at all |
| A stable sidebar | Home sidebar: Home + orgs. Agent pages add "AI agents" and "Audit log". The vendor org adds Clients, Audit log, Billing | The sidebar changes depending on where you are |

### Motion
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| Motion shows the product working: Vanta's cursor clicks "Generate fix", Linear's agent panel "Thinking…", Stripe's ticking counter | The landing has 252 running animations. Most are the decorative pixel-grid hero background plus the board cards animating in. The video shows the real flow but starts with branding | Motion is spent on decoration in the hero rather than on a rule breaking and getting fixed |

### Mobile
| What the unicorns do | What Grapim does | Gap |
|---|---|---|
| Not observed (resize blocked, see Limitations) | Not observed. The app CSS has 13 ad-hoc max-width breakpoints | Unknown. Needs a real 390px pass on a device or a non-maximized window |

## Top 12 changes for Grapim (ranked by what a deployment lead notices in a 3-minute demo)

1. **Home `/`: one honest status per agent.** In the Home table, show what is true now ("Fixed · 8 of 8 kept") and move the "2 of 8 broken on 11-09" history into the draft row's detail, phrased "Found 2 breaks on 11-09, fixed same day". Right now the first screen contradicts itself.
2. **Pick one name for the client.** Across the Rollout header sub-line, Check results' "Ready for … sign-off", Handover, the Evidence pack title and the tab titles, use the single client name ("Harbor Bank"). Show the agent as "Lia (Linden & Co. sample)" only where the sample label matters. Drop `sample-linden-agent` from page titles.
3. **Landing hero: product in the first 529px.** Cut the h1 to the first sentence and the subline to one clause, and move the Client-rollouts board up so its first row (Draft → Check → Fix → Sign-off → Live with the red "1 of 8 rules broken" card) shows on a short laptop screen. Aim for the ~40 above-fold words that Vanta and Linear use.
4. **Landing video: start on the break.** Remove the logo title card and the "Recorded live" card. Open on the Check card turning red ("1 of 8 rules broken"), then the fix and the sign-off. Put the caption under the video, not in it.
5. **One overview, not two.** Merge Home's "AI agents" table and the Northwind "Clients" page into a single Grapim board: client rows with the 5 rollout stages as columns (the same board as the landing), the "Need attention" tile and the inbox above it. Keep the sidebar the same on every page (Home, Clients, Audit log, Billing).
6. **Live tab empty state: show the future, not zeros.** Replace the three "0" tiles with a greyed preview of a week of checked conversations and one flagged example ("Refunds over $500 go to a person"), with "Send sample traffic" as the one action. Do the same for the evidence pack's "0 Live conversations checked" tile ("Live monitoring not connected yet").
7. **Sign-off card: a real share panel.** On Rollout → Client sign-off, show the open link with a **Copy link** button, who it was sent to, when it was opened and its status, plus "Revoke". This makes "Create a new link" the rare path rather than the only one.
8. **Check results: one screen of verdict.** Keep the green "All 8 policy rules kept" + "After the fix 2 → 0" + Evidence pack button, drop the duplicated bottom "Kept" list, and give the rule tiles full source names ("§7 returns-and-support-policy") instead of 8 cut-off file names. Move "Check the judge" behind a tab or a collapsed row.
9. **A Grapim command bar (Ctrl+K).** Search clients, agents, rules and policy files, plus actions ("Run check for Lia", "Copy sign-off link", "Open evidence pack"), and one question field ("which agents broke a rule this week?"). Show the shortcut hint in the sidebar.
10. **Evidence pack written for legal, not engineers.** Replace `recheckOf`, `fix.apply`, `fix.json` and raw check IDs with plain words ("re-ran the same 16 messages", "approved by chromewalk1@… on 9 Nov 13:05"). Add a one-line verdict above the stat tiles, and a "Download PDF" button instead of the "Print (Ctrl+P)" instruction. Fix "Approved and applied by Grapim" so it names the person.
11. **Rollout steps that read in order.** Either mark "Data mapping" as done or optional when the integration works without it, or reorder it. Show one primary button per state ("Review 1 draft"), with "Run the rollout" in More.
12. **Landing proof row.** Under the CTAs, swap the trust ticks for Grapim's own measured numbers from the product (for example "16 messages per rule set · 2 → 0 broken in 3 min · judge miss rate counted"), and add design-partner names or quotes as they come in. Keep the trust ticks next to the evidence-pack section.

Smaller items noticed: the Settings MCP snippets use `YOUR-GRAPIM` / `YOUR_KEY` placeholders where the real host could be filled in; the Policies upload is a native unstyled "Choose files" input; the audit log shows raw event names and offers CSV only as an API path; the tool-call text on Check results is cut mid-word with no ellipsis; the landing body text is 14px (the peers use 16px).
