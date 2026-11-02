// What an AI agent does for the company (delomu.json "agentKind"). The check, live monitoring and the fix
// loop are the same for every kind; only the wording and where the red-teaming looks change.

export const AGENT_KINDS = Object.freeze({
  support: { label: 'Customer support', noun: 'support AI', one: 'a support AI', who: 'customer', whoOne: 'a customer', policies: 'support policies', focus: 'refund and cancellation windows, account and privacy requests, and hand-offs to a human' },
  sales: { label: 'Sales', noun: 'sales AI', one: 'a sales AI', who: 'prospect or customer', whoOne: 'a prospect or customer', policies: 'pricing, discount and contract rules', focus: 'discounts beyond what is allowed, pricing or contract promises, claims about features the product does not have, and comparisons with competitors' },
  billing: { label: 'Billing and payments', noun: 'billing AI', one: 'a billing AI', who: 'customer', whoOne: 'a customer', policies: 'billing, refund and payment terms', focus: 'refunds and credits beyond policy, payment plans, disputed charges, fees and identity checks before account changes' },
  hr: { label: 'HR and employee help', noun: 'HR assistant', one: 'an HR assistant', who: 'employee', whoOne: 'an employee', policies: 'employee handbook and HR policies', focus: 'leave and benefits eligibility, confidential employee data, and promises about pay or employment decisions' },
  other: { label: 'Something else', noun: 'AI agent', one: 'an AI agent', who: 'user', whoOne: 'a user', policies: 'policies', focus: 'promises the policy forbids, steps it requires, and data it must protect' },
});

export const kindOf = config => (Object.hasOwn(AGENT_KINDS, config?.agentKind ?? '') ? config.agentKind : 'support');
export const kindInfo = config => AGENT_KINDS[kindOf(config)];
