# Delomu v0

AI forward-deployed engineer, version 0: the test-set and acceptance part of a customer deployment
(steps 3–5 of the plan). An engineer still does steps 1–2 by hand; the tool records how long each step takes,
because gate 1 of the plan needs those hours.

The previous Delomu Verify code was moved, untouched, to `Desktop\delomu-verify-archive`.

## Requirements

Node 20 or later. `npm install` once.
The judge uses Claude (`claude-opus-5-5`) and needs `ANTHROPIC_API_KEY` in the environment.
Without a key, "expected" checks are marked "needs review" instead of failing the run.

## Workflow for one customer

```bash
node bin/delomu.mjs init deployments/acme --customer "Acme"
```

1. Edit `deployments/acme/delomu.json`: point `target` at the customer's AI (an HTTP endpoint or a local command),
   set the agreed pass rate, and record decisions with the reason for each.
2. Fill `cases.csv` from the customer's past tickets: `id, input, expected, must_include, must_not_include, regex, tags`
   (`|` separates several values in one cell).
3. Build the test set: `node bin/delomu.mjs tests deployments/acme`
4. Run it: `node bin/delomu.mjs run deployments/acme` — writes `runs/<time>/report.html` for the customer,
   and exits with code 1 unless the run is accepted.
5. Log your hours after each step: `node bin/delomu.mjs log deployments/acme 2-integration 3 "Zendesk webhook"`,
   and see totals with `node bin/delomu.mjs hours deployments/acme`.

Keep API keys out of `delomu.json`: write `"authorization": "Bearer ${CUSTOMER_API_KEY}"` and set the variable.

## Demo

`npm run demo` runs a fictional support bot (`examples/mock-bot.mjs`) with three planted bugs against
`examples/acme-support`. Tests: `npm test`.

## Layout

| Path | What |
| --- | --- |
| `bin/delomu.mjs` | CLI |
| `src/testset.mjs` | cases.csv → tests.json |
| `src/adapters.mjs` | calls the customer's AI (http or command) |
| `src/grade.mjs`, `src/judge.mjs` | rule checks and the Claude judge |
| `src/run.mjs` | runs a deployment, writes results and report |
| `src/report.mjs` | the customer-facing acceptance report |
| `src/deployment.mjs` | deployment folder, config, hours log |
