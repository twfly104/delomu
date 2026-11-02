# Quickstart

Two ways in, a few minutes each. Sign up at https://delomu-production.up.railway.app/signup (Free plan, no card).
Save the sign-in key shown once after sign-up; it also works as an API key.

## If you sell an AI agent to companies (AI vendors)

1. At sign-up choose **We sell an AI agent to companies**. Your home is the Clients page.
2. **Open a sample client** to see a whole rollout first: Linden & Co., a made-up store whose agent acts on a test
   account (refunds, cancellations, codes, hand-offs).
3. On the Rollout page, **Run the rollout**. The agent drafts the data mapping, the integration and a test set from the
   client's material, then the check runs. Approve, edit or reject each draft.
4. On **Check results**, each tile is a policy rule. Open a red one to see the client's message, what your agent said,
   **what it did**, the clause it broke and the fix. **Draft a fix**, approve it, and the same messages run again.
5. **Create a sign-off link** and send it to the client. They read the result and accept without an account.

For a real client: **Add a client**, connect your agent (HTTP endpoint or OpenAI-compatible API; paste its key, it is
stored encrypted), and give the endpoint's **Field holding the actions** if your agent takes actions. Upload the client's
policies, past tickets and a description of the test account your agent will run as.

## If your company runs an AI agent

1. At sign-up choose **We use an AI agent with our customers**.
2. **Try it on a sample support bot**, then **Run check**: about a minute.
3. Connect your own agent: Intercom, Zendesk, an OpenAI-compatible API or your own HTTP endpoint. Choose what it does
   (support, sales, billing, HR) so the check looks where that kind of AI usually breaks policy.
4. Add your policies under **Policies**. When they change, the check runs again.
5. After launch, send conversations to **Live** (API snippet on the page) and set a Slack webhook for alerts.

## Before a reply or an action reaches a customer

`POST /v1/orgs/:org/deployments/:name/guard` checks a reply (`{ message, reply }`) or an action
(`{ action: { tool, input }, context, message }`) against the policy and returns allow, rewrite or block.
See [v5-guard.md](v5-guard.md).

## Getting help

Reply to the email that brought you here, or write to the founder. Every result in Delomu shows the clause it comes
from; if a verdict looks wrong, tell us which one.
