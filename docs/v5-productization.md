# v5: productization health and hosted monitoring

## Productization health (`/orgs/:org/productization`)

This is the plan's guard against becoming a services company, as a page. An AI vendor sees itself and every
client workspace; any other org sees its own deployments. Code: `src/v3/productization.mjs`.

### What it reads

| Source | Where it comes from |
| --- | --- |
| Manual work | **Log engineer hours** on the Rollout page takes an optional tag, "What needed a person". A tagged entry is written to the deployment's `interventions.jsonl`. Drafts a person rewrote or rejected count too, without anyone tagging them (`rewrote-mapping-draft`, `rejected-integration-draft`) |
| Hours | `hours.csv`, as on Deployment metrics |
| Revenue | **Revenue from this client** on the Rollout page: a one-time onboarding fee (service revenue) and a monthly fee since a month (software revenue), in the vendor's own numbers. Stored in `revenue.json` |
| Focus and team | **Focus and team** on the page itself (org admins only): the kinds of AI agent the vendor rolls out, an optional industry, the systems it supports, and its team size. Stored in `<deployments root>/<org id>/.productization.json` |

### What it shows

**Four numbers:**

- Rollout 5 under half the hours of rollout 1.
- The share of finished steps the agent drafted.
- Service share of revenue in the latest quarter.
- Revenue per person over the last 12 months.

**A verdict** once three rollouts have logged hours:

| Verdict | When |
| --- | --- |
| Becoming software | Later rollouts average at least 15% fewer hours than the first ones |
| Watch | Hours are falling, but the service share rose last quarter |
| Becoming a services company | Hours are not falling |

The reasons are listed under the verdict, with the advice that applies.

**Make it a feature:** manual work tagged three times or more, with how many clients, hours and steps it took.
This is rule 4 of the plan, and the threshold is `REPEAT_THRESHOLD`.

**Outside your focus:** clients with another kind of agent or another industry. Also clients on a connection
outside the supported systems, which are flagged as one-off work. A custom command integration is always
one-off work.

**Service and software revenue:** a bar per quarter for the last four quarters, and monthly recurring revenue.

## Hosted regression monitoring (step 6)

The **Monitoring** panel on the Rollout page turns v2's monitor (`src/v2/monitor.mjs`) on for one deployment.
Code: `src/v3/monitoring.mjs`. The settings are:

- how often to re-run at least: 6, 12, 24 or 72 hours;
- an optional https URL and field that report the client's model version.

The server checks monitored deployments every `DELOMU_MONITOR_MINUTES` (default 15; 0 turns it off). A
deployment's saved test set runs again when:

- the interval has passed;
- the tests or the connection changed;
- the reported model version changed.

**Check now** runs the same check at once.

### Rules for monitored runs

- They use the same connection rules as a run a person starts, and private addresses stay blocked.
- They count toward plan limits and are metered.
- A regression posts to the alert webhook set on the Live page.
- Every check is written to the deployment's audit log by v2, and every run is recorded as an event.
