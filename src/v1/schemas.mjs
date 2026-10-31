// Strict JSON schemas for the agent's model calls (structured output). Every object lists all of its
// properties as required and forbids extras, so a parsed answer always has the full shape. Where the
// draft content shape needs a free-form value (an http body template, header maps) the model returns a
// constrained stand-in that the agent converts and validates.

const str = (description = '') => ({ type: 'string', ...(description && { description }) });
const strList = description => ({ type: 'array', items: { type: 'string' }, ...(description && { description }) });
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const RATIONALE = str('Why this draft looks the way it does, citing the input files it is based on. Shown to the reviewing engineer.');

export const mappingSchema = obj({
  systems: { type: 'array', items: obj({ name: str(), purpose: str() }) },
  entities: {
    type: 'array',
    items: obj({
      name: str(),
      system: str('Must equal the name of one of the systems.'),
      fields: { type: 'array', items: obj({ name: str(), meaning: str(), example: str('A realistic but made-up example value; never copy personal data.') }) },
    }),
  },
  openQuestions: strList('Things the material does not answer that the engineer must ask the customer.'),
  rationale: RATIONALE,
});

export const integrationSchema = obj({
  type: { type: 'string', enum: ['http', 'command'] },
  url: str('http only: absolute http(s) URL of the endpoint. Empty for command.'),
  method: { type: 'string', enum: ['POST', 'PUT', 'PATCH', ''], description: 'http only (the message is sent in the body, so no GET); empty for command.' },
  headers: {
    type: 'array',
    description: 'http only. Credential values must be ${ENV_VAR} references such as "Bearer ${ACME_API_KEY}".',
    items: obj({ name: str(), value: str() }),
  },
  bodyTemplate: str('http only: the JSON request body as a JSON string; the user message goes where the string {{input}} appears.'),
  output: str('http only: dot path to the answer text in the JSON response, e.g. "reply" or "choices.0.message.content".'),
  command: str('command only: shell command that reads the message on stdin and prints the answer. Empty for http.'),
  timeoutMs: { type: 'integer', description: 'Request timeout in milliseconds; 0 for the default.' },
  notes: str('What the engineer must set up or verify before this works (env vars, network access, open questions).'),
  rationale: RATIONALE,
});

export const casesSchema = obj({
  rows: {
    type: 'array',
    items: obj({
      id: str('Short slug, unique, letters/digits/-/_ only, e.g. "refund-late-01".'),
      input: str('What the end user wrote, de-identified.'),
      expected: str('What a correct answer must do, in plain words, per the customer policy.'),
      must_include: strList('Short phrases a correct answer must contain.'),
      must_not_include: strList('Short phrases a correct answer must never contain.'),
      regex: str('Optional JavaScript regex the answer must match; empty if none.'),
      tags: strList('Topic labels, e.g. "billing", "policy".'),
      sourceTicket: str('The ticket id this case comes from.'),
    }),
  },
  rationale: RATIONALE,
});

export const fixesSchema = obj({
  groups: {
    type: 'array',
    items: obj({
      cause: str('One root cause shared by the cases in this group.'),
      caseIds: strList('Ids of failed cases this cause explains.'),
      fix: str('The concrete change to make.'),
      owner: { type: 'string', enum: ['ai-product', 'integration', 'customer', 'test-set'], description: 'Who must make the fix; "test-set" when the test case itself is wrong.' },
    }),
  },
  rationale: RATIONALE,
});

export const launchReportSchema = obj({
  summary: str('One or two paragraphs for the customer: what was tested, the result, and whether to launch.'),
  risks: strList('Known risks at launch, each one sentence.'),
  decisions: {
    type: 'array',
    items: obj({ date: str('YYYY-MM-DD'), decision: str(), reason: str('Why, citing the evidence.') }),
  },
  rationale: RATIONALE,
});
