# Design

Delomu's product UI (the v3 web app in `src/v3/html.mjs` and `src/v3/drafts-view.mjs`) and the customer acceptance
report (`src/report.mjs`) share one system, defined in `src/theme.mjs`. The bar is Linear, Vercel and Stripe: calm,
precise, familiar controls, no themed world (see PRODUCT.md, Brand Commitments).

## Principles

- One obvious next action per screen; the "Next step" panel names it.
- The agent's work is always shown as a proposal: what it proposes, rendered as the thing itself (tables, lists,
  summaries), its reasoning collapsed to one sentence, and one decision bar (note, Reject, Approve and apply).
- Colour carries state only: green kept or done, red broken, blue for links and focus. Primary buttons are ink (near-black on light, near-white on dark). No decorative colour.
- Works without JavaScript; one hashed script only marks a pressed button busy during long actions.

## Tokens (`src/theme.mjs`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | #fbfbfb | #0a0a0a | page background |
| `--surface` | #ffffff | #111111 | panels, inputs |
| `--rail` / `--sunken` | #f7f7f7 / #f5f5f5 | #0d0d0d / #181818 | sidebar; reasoning, code, footers |
| `--line` / `--line-strong` | #ebebeb / #dadada | #232323 / #333333 | hairlines; control borders |
| `--text` / `--text-2` / `--text-3` | #111111 / #555555 / #737373 | #ededed / #a1a1a1 / #8a8a8a | primary, secondary, tertiary text |
| `--ink` / `--on-ink` | #111111 / #ffffff | #ededed / #0a0a0a | primary buttons |
| `--accent` | #2f5bea | #5c85ff | links, focus |
| `--good` / `--warn` / `--bad` | #13804b / #a15c00 / #d1291f | #3fc584 / #f0b35b / #ff6b61 | state, each with a `-weak` background |
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
- **Panel**: surface, 1px line, 10px radius, head row with title and a quiet aside. No nested cards.
- **Buttons**: 32px, 6px radius; primary is accent-filled, secondary is outlined. Busy text via `data-busy`.
- **Badges**: pill with a dot, coloured by state; `.plain` without the dot.
- **Draft review card**: head, collapsible reasoning, structured content per draft kind, "Edit before approving"
  (JSON) and the decision bar.
- **Icons**: authored 16px set in `src/v3/icons.mjs`, 1.6 stroke, currentColor.

## Logo

The Delomu mark (a "D" cut by one diagonal slash) with the "Delomu" wordmark (capital D, confirmed 2026-11-01), drawn in the text colour.
Source files in `assets/brand/`; the favicon is served at `/favicon.svg` and adapts to dark tabs.
