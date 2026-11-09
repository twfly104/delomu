# Unicorn product bar: what Linear, Stripe, Vercel, Sierra, Loom do at the moments that matter

Researched 2026-11-09. Each bullet cites a page that was actually fetched. Items marked *(secondary)* come from third-party teardowns or search snippets, not the vendor, so treat them as indicative only. No statistics are invented. Where a source did not answer a question, that is stated.

Moments studied: (1) sign-up to first value, (2) main working screen, (3) empty states, (4) sharing with an external party, (5) speed and polish.

---

## Linear

**1. First value**
- The getting-started guide offers an optional demo workspace to explore before creating your own, an optional live onboarding session, then workspace creation with a work email. https://linear.app/docs/start-guide
- *(secondary)* The flow is sign in, create workspace, pick light or dark theme, a Cmd+K tutorial shown before any content exists, then skippable GitHub and invite steps. You land in the workspace with a "Get familiar with Linear" checklist (create an issue, use the command menu, set a priority). Activation is resolving the first issue, with no celebration screen. https://supademo.com/user-flow-examples/linear
- *(secondary)* A 2025 version was described as seven quick screens with no tour, ending in a blinking cursor inside the first issue. By 2026 the first screen became "Ask Linear..." (the agent). https://www.candu.ai/blog/linear-onboarding-teardown

**2. Main working screen and "what needs me next"**
- The sidebar holds Inbox (updates needing attention), My Issues, Workspace, teams, Triage and Favorites. Cmd/Ctrl+K opens the command menu ("type a page or action"), `/` searches, and an ID like LIN-123 jumps straight to the issue. Two-key shortcuts (G then I, G then M) go to common places, and `?` lists every shortcut. https://linear.app/enablement/guide/navigating-linear
- My Issues sorts assigned work in a fixed focus order: urgent, SLA-bound, blockers, cycle work, other active work, triage, backlog, completed. Within each group, higher priority comes first and started work comes before unstarted. Empty groups are hidden. https://linear.app/docs/my-issues
- The Inbox has a separate **Priority** tab for notifications that need you. J/K moves, U marks read, H snoozes (natural-language times such as "next quarter"), and Backspace deletes. https://linear.app/docs/inbox
- Project health is one of three words: On track, At risk or Off track. If a lead skips a reminder, the project shows "Update Missing", a dashed outline marks a slight delay, and the icon greys out after longer. Completed projects show "No Update expected". https://linear.app/docs/initiative-and-project-updates.md
- Triage is an explicit review step before new work is scheduled. https://linear.app/docs/conceptual-model

**4. External**
- Customer requests quote the original message with the requester's name, a timestamp and a link to the source. A customer page lists every issue they asked for. Notifications go to internal users only. The docs describe no way for the requester to check status, so this is a gap. https://linear.app/docs/customer-requests

**5. Polish**
- The redesign aimed to reduce visual noise while increasing "hierarchy and density of navigation". Each theme is generated from three inputs (base, accent, contrast) instead of 98 variables. Colors use LCH so equal lightness looks equal in light and dark, and a contrast setting provides high-contrast themes. https://linear.app/now/how-we-redesigned-the-linear-ui
- *(secondary)* The instant feel comes from a local store plus optimistic writes, with the server round-trip moved out of the user's path. https://performance.dev/what-makes-linear-feel-instant (via search, not vendor-confirmed)

---

## Stripe (Dashboard + hosted pages)

**1. First value**
- New accounts start in a sandbox. Test API keys appear on the Dashboard home page. Test cards work with any future expiry date and any CVC. You can go live later without rebuilding. https://docs.stripe.com/test-mode
- Sandboxes do not email customers by default. Settings pages show a notice and disable live-only controls in test mode, and the docs say to "assume your changes also affect live mode unless you see a test data banner". https://docs.stripe.com/test-mode
- Onboarding guidance for Stripe Apps: effortless, ask only what is needed, one primary "Continue" per step, deep links that resume at a specific step, and an existing-account sign-in as the shortest path. https://docs.stripe.com/stripe-apps/patterns/onboarding-experience

**2. Main working screen**
- Home shows charts plus important notifications such as unresolved disputes. `?` lists keyboard shortcuts. A Shortcuts section shows recently visited pages, which you can pin. https://docs.stripe.com/dashboard/basics
- Invoice status is a single word (draft, open, paid, void, uncollectible). Open invoices show a more specific badge such as "Past due", "Retrying" or "Pending", with a hover tooltip explaining it. Each status lists only the actions it allows. https://docs.stripe.com/invoicing/overview

**3. Empty states (Stripe Apps pattern, mirrors the Dashboard)**
- Explain why the view is empty: "No transactions yet." beats "No transactions". The title and the action work as call and response ("No customers yet." / "Add customer"), never "Get started". Descriptions stay under 14 words, for example "Payments appear here after your first sale." https://docs.stripe.com/stripe-apps/patterns/empty-state
- If filters return nothing, say "No customers match your filters." with Clear filters, and never offer "create first". Section-level empties are compact, with a dashed border. Render in this order: loading, then error with retry, then empty, then content. https://docs.stripe.com/stripe-apps/patterns/empty-state

**4. External (hosted invoice, Checkout, Connect onboarding)**
- The hosted invoice page is a private URL with a long random identifier. The recipient sees details, amount and status, can pay with any enabled method, and can download the invoice and receipt PDFs. No account is needed. Branding covers brand color, logo and icon, and the page shows the business's public support email, site or phone. https://docs.stripe.com/invoicing/hosted-invoice-page
- Expired links never dead-end. They open a page with the business's contact details, or a recovery form that emails a fresh link. A voided invoice still loads and says it was voided. https://docs.stripe.com/invoicing/hosted-invoice-page, https://docs.stripe.com/invoicing/overview
- Checkout branding covers logo, icon (also used as the favicon), display name, background and button color, font, corner style and an optional custom domain. Stripe warns to use "a business name that is consistent and recognizable" to avoid confusion. https://docs.stripe.com/payments/checkout/customization/appearance.md?ui=full-page
- Connect onboarding shows the platform's name, color and icon (all required). Fields can be prefilled for the person to confirm. A return URL only means the person left the flow, so the platform must check outstanding requirements. Prefetching link previews in chat apps can burn a one-time link, so a refresh URL re-mints it. https://docs.stripe.com/connect/hosted-onboarding
- The sender learns that an invoice was acted on through status changes and events (`invoice.paid`, and so on). I found no documented "viewed" signal for hosted invoices. https://docs.stripe.com/invoicing/overview

**5. Polish**
- Show the loader immediately, but delay it 200–300 ms so fast fetches don't flash. Size it to its scope (page, section or inline). Keep tab bars visible while tabs load. Buttons get a `pending` state that also disables them, which prevents double submits. https://docs.stripe.com/stripe-apps/patterns/loading

---

## Vercel

**1. First value**
- From the dashboard: connect GitHub, GitLab or Bitbucket, pick a repo and click Deploy. Every later push deploys automatically. From the CLI, a bare `vercel` detects the framework, builds and deploys. https://vercel.com/docs/getting-started-with-vercel
- *(search snippet of the template doc)* The template flow clones the code into your Git account, builds, assigns a domain, then celebrates with confetti. https://vercel.com/docs/getting-started-with-vercel/template (the fetch returned the general page)
- The first deployment is always production, so a new project gets a live URL right away. https://vercel.com/docs/deployments/preview-deployments

**2. Main screen and state**
- The Status Dot has six states: QUEUED, BUILDING, READY, ERROR, CANCELED, DELETED. It animates only while in flight, with no separate spinner, and updates only when the state changes, not on every poll. Each state has its own label, so color is never the only signal. https://vercel.com/geist/status-dot
- Every deployment gets an auto URL in two forms: one per branch (always the latest) and one per commit (fixed). The links also appear in the Git provider's PR comments. https://vercel.com/docs/deployments/preview-deployments

**3. Empty states**
- There are distinct variants: blank slate, informational, educational, guide (starter or sample content), no-results, cleared, permission or tier, and error. Use one primary CTA (two at most), never three. Never auto-launch a tour. CTAs follow Verb + Noun and avoid "Get Started", "Continue" or "OK". An error empty state includes a copyable request ID and Try Again. https://vercel.com/geist/empty-state

**4. External**
- Share a deployment from its Share popover by switching it to "Anyone with the link". Switching back to "Only people with access" revokes it. Link holders can also leave comments. A team settings page lists every active link. https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/sharable-links
- Invite people by email from the share menu. The menu shows who currently has access. https://vercel.com/changelog/invite-collaborators-to-view-and-comment-on-your-deployments
- Comments pin to an exact spot on the live page. The PR owner gets an email for each new comment, and thread participants get notified of replies. If a newer deployment exists, a popup offers to refresh. Commenting requires a Vercel account. https://vercel.com/docs/comments
- An optional non-blocking PR check reminds the author about unresolved comments before sharing wider. Threads sync both ways with Slack. https://vercel.com/blog/introducing-commenting-on-preview-deployments

**5. Polish**
- Toasts: "{Noun} {past participle}" in one sentence with no period ("Domain added"). The only action label is "Undo", kept on screen 5–10 s. One toast at the end of an async flow, not a stream of them. Failures the user must act on also need a persistent message with the recovery step. The live region is polite. https://vercel.com/geist/toast
- Relative time ("2m ago", "Yesterday") shows absolute UTC and local time on hover. Dates in body text older than 7 days use a plain date. https://vercel.com/geist/relative-time-card

---

## Sierra (agent platform, closest domain analog)

- Sierra auto-generates tests from the customer's SOPs, knowledge bases, past coaching transcripts and conversation flows when an agent is created. The tests persist and re-run after every change. https://sierra.ai/blog/simulations-the-secret-behind-every-great-agent
- A separate judge agent grades each run on four questions: did the user reach the goal, did the agent follow the SOP, did it stay on brand, and were responses accurate and understandable. Runs repeat. Simulations sit next to the journeys in Agent Studio and should pass before a change is published. They can also run in CI (GitHub Actions or the CLI) to gate releases. Same source.
- Public material does not show how results are laid out. The one screenshot caption is "Evaluate agent performance using complex, real-world scenarios". Same source.

## Loom (share page)

- A view counts after 5 s, or 75% of the video, or a scrub to the end. Logged-out viewers appear as "Anonymous". Paid plans can require, request or skip an email before playback to identify viewers, and track CTA conversion. https://support.atlassian.com/loom/docs/see-who-has-viewed-your-video/
- *(search snippets)* The creator is notified on the first view only. A single "call-to-action" button can be added to the share page. Signed-out viewers cannot see comments or reactions. https://support.loom.com/hc/en-us/articles/360015208237, https://support.atlassian.com/loom/docs/react-to-videos-with-emojis-and-in-video-comments

---

## Patterns Grapim should adopt in its own way

None of these is a visual look. Each describes a behavior to rebuild in Grapim's own voice.

1. **Real work in the first session, from the customer's own documents.** Sierra generates tests from SOPs. Stripe's sandbox and Vercel's first production deploy give a real result immediately. Grapim should draft tests from the first uploaded policy and run a check before asking for anything else. Offer a sample client only as a "guide" option, never a forced tour (Vercel Geist, Linear).
2. **One ask per onboarding screen, with optional steps clearly skippable.** Seen in Linear (secondary) and Stripe Apps onboarding. Each step should be resumable from a link (Stripe's deep-link-to-step).
3. **A single "needs you" list in a fixed, explained order.** Linear's My Issues focus order and Inbox Priority tab. For Grapim, the order could be: broken rules awaiting a drafted fix, fixes awaiting approval, sign-offs awaiting the client, then the rest. Empty groups are hidden.
4. **Status is one word plus a reason on hover, and color is never the only signal.** Stripe's invoice badges with tooltips, Vercel's Status Dot labels, Linear's On track / At risk / Off track. Staleness counts as a state too: Linear's "Update Missing" maps to "Last check 9 days ago, policy changed since".
5. **Every async action shows progress where it was started and lands on the result.** Stripe's pending buttons that block double submits and delayed loaders; Vercel's animate-only-while-in-flight dot and one toast at the end. A check run should end on its result page, not a generic list.
6. **Empty states state the fact, say when the data will appear, and offer exactly one action that echoes the title.** Stripe ("No customers yet." / "Add customer"), Vercel (Verb + Noun, at most one secondary). Filtered-empty and error-empty are distinct, and error carries a request ID and retry.
7. **The external page names the sender and the ask above the fold, and needs no account.** Stripe's hosted invoice (business brand, amount, status, one action, support contact), Vercel's share link. For Grapim: vendor name and logo, client name, "asks you to sign off on N policy checks", one primary action.
8. **External links never dead-end.** Stripe's expired-link recovery page and voided-but-still-loading invoice, plus Connect's re-mintable one-time links that survive chat-app link previews. A Grapim sign-off link that expired or was superseded should explain why and show who to contact.
9. **The sender sees what happened to every shared link, and can revoke it.** Vercel lists every active link plus who has access and revokes with one switch; Loom notifies on first view and admits "Anonymous"; Stripe reports status changes. Grapim should show opened, viewed and signed (with timestamps), honestly labeled when the viewer is unknown.
10. **External feedback anchors to the exact item and flows back into the vendor's queue.** Vercel's pinned comments, notification emails and unresolved-comment PR check, and Linear's quoted customer request with a source link. A client question on rule 4.2 should land on rule 4.2 and in the "needs you" list.
11. **Results are reproducible and gate the release.** Sierra re-runs persistent tests after every change and in CI; Vercel's per-commit immutable URL. Every Grapim check result should have a permanent URL tied to the agent version and policy version it ran against.
12. **Small, consistent polish rules written down once.** These come from Vercel Geist and Linear's LCH themes:
    - toasts as "{Noun} {past participle}", with Undo only when reverting is safe
    - relative time with the absolute time on hover, and a plain date after 7 days
    - `?` opens a shortcut list and Cmd+K opens a command menu that layers over working links and forms (Grapim works without JS)
    - light and dark themes built from a few tokens with checked contrast
