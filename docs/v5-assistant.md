# v5: the Grapim assistant

Every signed-in page has a round **Ask Grapim** button in the bottom-right corner. It opens a
side panel (full screen on a phone). The assistant answers questions about the page you are on and proposes the
next step as a button. Nothing runs until you click that button. The code is in `src/v3/assistant.mjs`, the
routes in `src/v3/web.mjs`, and the panel in `src/v3/html.mjs` (`ASSISTANT_SCRIPT`).

## What it knows

The assistant reads the same records the pages show, trimmed.

**On an agent's page:**

- the six steps and where each stands;
- the drafts waiting for review and the policy files;
- the last check, with up to six broken rules: the clause, what the customer wrote, what the agent said, what
  happened and the suggested fix;
- monitoring, playbook consent and the connector's tools.

**On an org page:** each deployment (for a vendor, each client) with its check result, waiting drafts, sign-off
and next step.

This goes to the model inside a `<workspace>` tag, as data. The system prompt tells the model never to follow
instructions found inside it. A closing tag inside the data is removed, so the data cannot end the tag early.

## What it can do: propose, then you click

The model can only propose actions from a fixed list:

- **Deployment actions:** run the check, run the rollout, draft a fix, create a sign-off link, or check
  monitoring now.
- **Links:** open the results, rollout, drafts, policies, live, settings, clients, metrics or productization
  health pages.

The server turns each proposal into a form or link for an existing route, and drops a proposal when:

- its type is not on the list;
- it points at a deployment that is not in this page's scope;
- it is a write action and the person cannot write.

Clicking the button posts to the same route as the button on the page. Permissions, CSRF checks, plan limits and
the audit log all apply as usual. At worst, a model that someone talked into something produces a button the
person can see and ignore.

## Details

| Topic | Behavior |
| --- | --- |
| History | The last 12 messages per session, kept in server memory. **New chat** clears them. The panel stays open across pages through `sessionStorage`, and pages that auto-refresh while a check runs wait while it is open |
| Limits | 15 questions per session at once, refilling one every 8 seconds; questions up to 1,000 characters |
| Without JavaScript | The button links to `/assistant`, a full page with the same answers and buttons |
| Security headers | The page CSP allows the panel script by hash and `connect-src 'self'` for its requests; nothing else is loaded |
| Motion | The panel slides in, messages and buttons rise in, and the thinking dots bounce. All of it is off under `prefers-reduced-motion` |

## Routes

| Route | Purpose |
| --- | --- |
| `GET /assistant/state?from=PATH` | The page label, three suggested questions and the history |
| `POST /assistant/ask` | Form fields `csrf`, `message` and `from`. Returns `{ reply, actions: [{ label, href, method, fields }] }` |
| `POST /assistant/clear` | Clears the history |
| `GET /assistant?from=PATH` and `POST /assistant` | The page version, for browsers without JavaScript |
