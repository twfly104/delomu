# Subprocessors

The third parties that can receive customer data when Delomu runs. A self-hosted install uses only the ones its
operator configures.

| Subprocessor | What it receives | Why | When |
| --- | --- | --- | --- |
| Meta (Meta Model API) | Customer policies and docs, test messages, the customer AI's answers | Writes probes, judges answers, drafts rollout steps | When `MODEL_API_KEY` is set |
| Anthropic (Claude API) | Same as above | Same as above | When `ANTHROPIC_API_KEY` is set |
| Stripe | Billing contact, plan, usage counts. No customer material | Subscriptions and invoices | When billing is configured |
| The customer's own AI and help desk (their endpoint, Intercom or Zendesk) | Test messages | The tests themselves | Every run and scan |
| The hosting provider | Everything in the data volume | Runs the server | Hosted (not self-hosted) installs |

Meta "contributor" models, which allow training on the data sent, are refused in code.

We will update this page before adding a subprocessor.
