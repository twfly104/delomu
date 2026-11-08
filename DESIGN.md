# Design

Grapim's product UI (the v3 web app in `src/v3/html.mjs` and `src/v3/drafts-view.mjs`) and the customer acceptance
report (`src/report.mjs`) share one system, defined in `src/theme.mjs`. The bar is Linear, Vercel and Stripe: calm,
precise, familiar controls, no themed world (see PRODUCT.md, Brand Commitments).

## Principles

- One obvious next action per screen; the "Next step" panel names it.
- The agent's work is always shown as a proposal: what it proposes, rendered as the thing itself (tables, lists,
  summaries), its reasoning collapsed to one sentence, and one decision bar (note, Reject, Approve and apply).
- Palette (2026-11-03): slate and cobalt. Neutrals are tinted cool, primary buttons are deep navy ink, one cobalt
  for links and focus; dark mode is deep navy, not pure black.
- Colour carries state only: green kept or done, red broken, blue for links and focus. Primary buttons are ink (near-black on light, near-white on dark). No decorative colour.
- Works without JavaScript; one hashed script only marks a pressed button busy during long actions.

## Tokens (`src/theme.mjs`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | #f6f7f9 | #0a0d14 | page background |
| `--surface` | #ffffff | #10141e | panels, inputs |
| `--rail` / `--sunken` | #f1f3f6 / #f1f3f6 | #0c1018 / #161b27 | sidebar; reasoning, code, footers |
| `--line` / `--line-strong` | #e3e7ee / #cfd5df | #212837 / #313a4d | hairlines; control borders |
| `--text` / `--text-2` / `--text-3` | #0b1324 / #4a5568 / #646e83 | #e8ecf3 / #a3adc0 / #808ba1 | primary, secondary, tertiary text |
| `--ink` / `--on-ink` | #0b1324 / #ffffff | #e8ecf3 / #0a0d14 | primary buttons |
| `--accent` | #2b59ff | #6b8cff | links, focus |
| `--good` / `--warn` / `--bad` | #0f7a57 / #a15c00 / #cc2a1e | #3fc58f / #f0b35b / #ff6b61 | state, each with a `-weak` background |
| `--r-sm` / `--r` | 8px / 12px | | controls / panels |

Type: Geist and Geist Mono (OFL, self-hosted from `src/v3/fonts/`, served at `/fonts/`), 14px base, 1.5 line height;
h1 24px at -0.03em, h2 15px, weight 600; `--mono` only for ids, code and data. Numbers in tables use tabular figures.

## Components

- **Shell**: 240px sidebar (logo, Home with review count, Deployments, Audit log, organizations, user and sign out),
  52px top bar with breadcrumbs, content up to 1160px. Below 860px the sidebar becomes a top row.
- **Stages** (every agent page): three linked cells, Policies, Pre-launch check, Live monitoring, each done (green
  check), broken (red "!") or todo (number), with a one-line detail.
- **Check results** (the product's signature): a verdict line ("4 of 8 policy rules broken"), then each broken rule
  with its clause quoted, the risk, and every breaking exchange as Customer wrote / Your AI replied with the verdict
  and fix; messages handled correctly fold away; kept rules end the page as one list.
- **Rule map** (top of check results): one tile per policy rule in the policy's order, tinted red when broken,
  amber when it needs a person, plain when kept, with one pip per test message; each tile links to its findings.
- **Check in progress**: one tile per test message, lit red or green as its answer is judged (newly lit tiles land
  with a short scale-in; the next one breathes in accent). Step 1 keeps the plain meter.
- **How it works**: a four-node diagram (your policy, hardest messages, your AI, a verdict per clause) that draws
  itself once on the first-run and empty check pages; static under reduced motion.
- **Client dots**: one dot per AI agent under each client's name, coloured by that agent's state.
- **Daily bars** (Live): the last 7 days, height is conversations checked, the red cap those that broke a rule.
- **Copy**: one line under a section heading; the picture carries the rest.
- **Panel**: surface, 1px line, 10px radius, head row with title and a quiet aside. No nested cards.
- **Buttons**: 32px, 6px radius; primary is accent-filled, secondary is outlined. Busy text via `data-busy`.
- **Badges**: pill with a dot, coloured by state; `.plain` without the dot.
- **Draft review card**: head, collapsible reasoning, structured content per draft kind, "Edit before approving"
  (JSON) and the decision bar.
- **Icons**: authored 16px set in `src/v3/icons.mjs`, 1.6 stroke, currentColor.

## Public landing (/)

- **Rollout board** (first screen): the product's own board in a 16px-radius window, five stage columns (Draft,
  Check, Fix, Sign-off, Live) on the canvas tint, one sample client card per column showing that stage's output.
  Column heads link to the stage sections. The Fix card is lit (accent ring), the one card that needs the user.
  Cards land column by column, Check pips and Live bars fill in; static without JS or with reduced motion. Below
  1100px the columns scroll sideways with the next one peeking.
- **Stage sections**: one per board column, same order and numbers, copy on one side and a product scene on the
  other, alternating. The numbered chip (`.lb-n`) is shared with the board so the two read as one system.
- **Film**: the real recording, muted autoplay with no controls; a "Sound on" pill (shown only when JS runs)
  unmutes and restarts it.
- Every client on the page is a labelled sample; no customer logos, quotes or metrics.

## Logo

The Grapim mark (a "D" cut by one diagonal slash) with the "Grapim" wordmark (capital D, confirmed 2026-11-01), drawn in the text colour.
Source files in `assets/brand/`; the favicon is served at `/favicon.svg` and adapts to dark tabs.
