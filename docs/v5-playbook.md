# v5: the playbook

Each new client rollout starts from the work an AI vendor already did for earlier clients. The playbook is the
v4 knowledge library ([v4.md](v4.md)) inside the web app, kept separately for each paying org.

## What goes in

When a client agrees, Grapim adds that client's rollout to the vendor's playbook:

- the test set (`cases.csv`);
- the test messages from the latest policy check, each with the behaviour its rule expects, tagged
  `policy-check`, the rule's severity and `broke-a-rule` when the AI broke it;
- the integration shape: method, body template, output path and header names. The host becomes `[HOST]` and
  header values become `[VALUE]`;
- recurring failure patterns from test runs.

Every string passes through v4's `scrub` first. Emails, phone numbers, card numbers, IBANs, secrets, IPs and
URL credentials are removed. So are:

- the client's org name and the customer name, both with and without a legal suffix such as "& Co." or "Inc.";
- the name of the person who signed off;
- order and ticket ids such as `L-1006` or `#48211`, which become `[ORDER]`;
- domains such as `lindenandco.example`, which become `[DOMAIN]`.

Prices, dates and version numbers stay. In a real run on the sample store, 20 order ids, 2 domains and 1 name
were removed, and nothing personal was left.

## Consent

Nothing is added without the client's agreement. The agreement can be recorded in two ways:

- **On the sign-off page.** The checkbox "Let *vendor* reuse what it learned here" is off by default and only
  counts with Accept. The agreement is recorded as `<name> (sign-off)`.
- **On the Rollout page.** For an agreement made elsewhere, such as a contract or an email, the vendor enters
  who agreed and how, and confirms it.

Grapim stores the agreement in the rollout's `delomu.json` as `library.consent`, `consentedBy`, `consentedAt`
and `sourceId`. It writes `library.consent` and `library.harvest` to the rollout's audit log.

**Remove from playbook** withdraws the agreement and deletes every entry that rollout added. **Refresh from this
rollout** replaces its entries with the current state.

## Where it is used

**Run the rollout** uses the playbook in two steps:

1. **Draft the integration.** Up to two integration shapes from the vendor's other rollouts are shown to the
   model as shapes to start from. The client's own docs still decide every endpoint and field. The draft's
   rationale ends with "Started from your playbook".
2. **Add test messages from your playbook.** Up to 15 test messages that this client does not have yet. They
   are ranked by BM25 against the client's cases, mapping and inputs. They arrive as a pending `cases` draft
   with `lib-` ids. A person approves, edits or rejects them like any other draft.

## Isolation

- **One library per paying org.** It lives at `<deployments root>/<owner org id>/.library`. The owner is the
  vendor for a client workspace, or the org itself otherwise. Another vendor's rollouts never read it.
- **No shared salt to manage.** The salt for source hashes comes from the server pepper and the owner's id, so
  no `DELOMU_LIBRARY_SALT` is needed.

## Measuring it

On **Deployment metrics**:

- the Playbook column marks each rollout that approved a draft the playbook helped with, with the number of
  playbook test messages;
- once both kinds have logged hours, a line compares average engineer hours per rollout with the playbook and
  without it.
