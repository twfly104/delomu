# Design

Delomu's product UI (the v3 web app in `src/v3/html.mjs` and `src/v3/drafts-view.mjs`) and the customer acceptance
report (`src/report.mjs`) share one system, defined in `src/theme.mjs`. The bar is Linear, Vercel and Stripe: calm,
precise, familiar controls, no themed world (see PRODUCT.md, Brand Commitments).

## Principles

- One obvious next action per screen; the "Next step" panel names it.
- The agent's work is always shown as a proposal: what it proposes, rendered as the thing itself (tables, lists,
  summaries), its reasoning collapsed to one sentence, and one decision bar (note, Reject, Approve and apply).
- Colour carries state only: green done or passing, blue waiting for a person, red failing. No decorative colour.
- Works without JavaScript; one hashed script only marks a pressed button busy during long actions.

## Tokens (`src/theme.mjs`)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | #fafafb | #0f0f12 | page background |
| `--surface` | #ffffff | #16161a | panels, inputs |
| `--rail` / `--sunken` | #f4f4f6 | #121215 / #1c1c21 | sidebar; reasoning, code, footers |
| `--line` / `--line-strong` | #e4e4e9 / #d1d1d9 | #26262d / #34343d | hairlines; control borders |
| `--text` / `--text-2` / `--text-3` | #18181b / #4f4f58 / #6b6b75 | #ececf0 / #a8a8b3 / #8b8b96 | primary, secondary, tertiary text |
| `--accent` | #3e63dd | #6d8cff | primary buttons, focus, "waiting for review" |
| `--good` / `--warn` / `--bad` | #18794e / #9a5300 / #c4302b | #4cc38a / #f0b35b / #ff7a70 | state, each with a `-weak` background |
| `--r-sm` / `--r` | 6px / 10px | | controls / panels |

Type: the platform UI stack (`--font`), 14px base, 1.5 line height; headings 22 / 15 / 14px at weight 600 with
-0.015em tracking; `--mono` only for ids, code and data. Numbers in tables use tabular figures.

## Components

- **Shell**: 240px sidebar (logo, Home with review count, Deployments, Audit log, organizations, user and sign out),
  52px top bar with breadcrumbs, content up to 1160px. Below 860px the sidebar becomes a top row.
- **Rollout track** (the product's signature): six steps (Data mapping, Integration, Test set, Test and fix, Launch
  report, Monitoring) with done, review, attention and todo states; a compact six-bar version in tables.
- **Panel**: surface, 1px line, 10px radius, head row with title and a quiet aside. No nested cards.
- **Buttons**: 32px, 6px radius; primary is accent-filled, secondary is outlined. Busy text via `data-busy`.
- **Badges**: pill with a dot, coloured by state; `.plain` without the dot.
- **Draft review card**: head, collapsible reasoning, structured content per draft kind, "Edit before approving"
  (JSON) and the decision bar.
- **Icons**: authored 16px set in `src/v3/icons.mjs`, 1.6 stroke, currentColor.

## Logo

The Delomu mark (a "D" cut by one diagonal slash) with the "Delomu" wordmark (capital D, confirmed 2026-11-01), drawn in the text colour.
Source files in `assets/brand/`; the favicon is served at `/favicon.svg` and adapts to dark tabs.
