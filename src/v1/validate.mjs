// Checks the content of the five shared draft kinds. The agent runs these on model output before it
// creates a draft, and the appliers run them again on approval, because a reviewer may have edited it.
// Each validator returns a list of problems (empty = valid); none of them change the content.

const isText = v => typeof v === 'string' && v.trim() !== '';
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Header names whose values are credentials and therefore must come from the environment.
const SENSITIVE_HEADER = /auth|token|key|secret|cookie|session|password|signature/i;
// Literal values that look like real credentials anywhere in a target.
const SECRET_LITERAL = /\b(sk-[A-Za-z0-9_-]{8,}|sk_live_[A-Za-z0-9]{8,}|xox[abprs]-[A-Za-z0-9-]{8,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;
// RFC 9110 token characters; anything else is rejected by fetch at run time.
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SENSITIVE_QUERY = /[?&](api[_-]?key|key|token|access[_-]?token|secret|password|sig|signature)=/i;

const containsInput = v => {
  if (typeof v === 'string') return v.includes('{{input}}');
  if (Array.isArray(v)) return v.some(containsInput);
  if (isObject(v)) return Object.values(v).some(containsInput);
  return false;
};

// A credential header value is acceptable only if, once ${ENV} references and an auth scheme word are
// removed, nothing literal is left: "Bearer ${ACME_KEY}" passes, "Bearer abc123" does not.
const usesEnvOnly = value => /\$\{[A-Z0-9_]+\}/i.test(value)
  && value.replace(/\$\{[A-Z0-9_]+\}/gi, '').replace(/^\s*(bearer|basic|token|apikey|api-key)\s*/i, '').trim() === '';

const ENV_ONLY = /^\$\{[A-Z0-9_]+\}$/i;

export function validateTarget(target) {
  const p = [];
  if (!isObject(target)) return ['target must be an object'];
  if (SECRET_LITERAL.test(JSON.stringify(target))) p.push('target contains what looks like a literal secret; use ${ENV_VAR} instead');
  if (target.timeoutMs !== undefined && !(Number.isInteger(target.timeoutMs) && target.timeoutMs > 0)) p.push('timeoutMs must be a positive integer');

  if (target.type === 'http') {
    let url = null;
    try { url = new URL(target.url); } catch { p.push('http target needs a valid absolute url'); }
    if (url && !['http:', 'https:'].includes(url.protocol)) p.push('http target url must start with http:// or https://');
    if (url && (url.username || url.password)) p.push('url must not contain credentials');
    if (url && SENSITIVE_QUERY.test(url.search)) p.push('url must not carry a key or token in its query string; send it in a header with ${ENV_VAR}');
    // The adapter sends the test input only through the body template, so GET (no body) cannot work.
    if (target.method !== undefined && !['POST', 'PUT', 'PATCH'].includes(String(target.method).toUpperCase())) p.push('method must be POST, PUT or PATCH (the test input is sent in the body)');
    if (!containsInput(target.body)) p.push('http body must contain {{input}} so each test input is sent');
    if (target.headers !== undefined && !isObject(target.headers)) p.push('headers must be an object of name: value');
    for (const [name, value] of Object.entries(isObject(target.headers) ? target.headers : {})) {
      if (!HEADER_NAME.test(name)) p.push(`header name "${name}" is not a valid HTTP header name`);
      else if (typeof value !== 'string') p.push(`header ${name} must be a string`);
      else if (SENSITIVE_HEADER.test(name) && !usesEnvOnly(value)) p.push(`header ${name} must take its value from \${ENV_VAR}, not a literal`);
    }
    if (target.output !== undefined && typeof target.output !== 'string') p.push('output must be a dot path string');
    if (target.actions !== undefined && typeof target.actions !== 'string') p.push('actions must be a dot path string');
  } else if (target.type === 'command') {
    if (!isText(target.command)) p.push('command target needs a non-empty command');
    else if (/[\r\n]/.test(target.command)) p.push('command must be a single line');
  } else if (target.type === 'intercom' || target.type === 'zendesk') {
    const secrets = target.type === 'intercom' ? ['token'] : ['keyId', 'secret'];
    for (const k of secrets) if (typeof target[k] !== 'string' || !ENV_ONLY.test(target[k])) p.push(`${target.type} ${k} must be one \${ENV_VAR} reference`);
    if (target.type === 'zendesk' && !isText(target.appId)) p.push('zendesk target needs an appId');
    if (target.type === 'zendesk' && !isText(target.subdomain) && !isText(target.baseUrl)) p.push('zendesk target needs a subdomain');
  } else {
    p.push('target type must be "http", "command", "intercom" or "zendesk"');
  }
  return p;
}

export function validateIntegration(content) {
  if (!isObject(content)) return ['integration content must be an object'];
  const p = validateTarget(content.target);
  if (typeof content.notes !== 'string') p.push('notes must be a string');
  return p;
}

export function validateMapping(content) {
  if (!isObject(content)) return ['mapping content must be an object'];
  const p = [];
  const systems = Array.isArray(content.systems) ? content.systems : (p.push('systems must be a list'), []);
  const entities = Array.isArray(content.entities) ? content.entities : (p.push('entities must be a list'), []);
  if (!Array.isArray(content.openQuestions) || !content.openQuestions.every(q => typeof q === 'string')) p.push('openQuestions must be a list of strings');
  if (!systems.length) p.push('mapping names no systems');

  const names = new Set();
  systems.forEach((s, i) => {
    if (!isText(s?.name) || typeof s?.purpose !== 'string') p.push(`system ${i + 1} needs a name and a purpose`);
    else if (names.has(s.name)) p.push(`system "${s.name}" is listed twice`);
    else names.add(s.name);
  });
  entities.forEach((e, i) => {
    const label = isText(e?.name) ? `entity "${e.name}"` : `entity ${i + 1}`;
    if (!isText(e?.name)) p.push(`${label} needs a name`);
    if (!names.has(e?.system)) p.push(`${label} refers to unknown system "${e?.system}"`);
    if (!Array.isArray(e?.fields) || !e.fields.length) p.push(`${label} needs at least one field`);
    else e.fields.forEach((f, j) => {
      if (!isText(f?.name) || typeof f?.meaning !== 'string' || typeof f?.example !== 'string') p.push(`${label} field ${j + 1} needs name, meaning and example strings`);
    });
  });
  return p;
}

const CASE_FIELDS = ['id', 'input', 'expected', 'must_include', 'must_not_include', 'regex', 'tags'];

// Checks one cases row; returns problems for it. `ids` is the set of ids already taken.
export function validateCaseRow(row, ids = new Set()) {
  if (!isObject(row)) return ['row must be an object'];
  const p = [];
  for (const f of CASE_FIELDS) if (row[f] !== undefined && typeof row[f] !== 'string') p.push(`${f} must be a string`);
  if (!/^[A-Za-z0-9][\w.-]{0,63}$/.test(row.id ?? '')) p.push(`id "${row.id ?? ''}" must be 1-64 letters, digits, ".", "_" or "-"`);
  else if (ids.has(row.id)) p.push(`id "${row.id}" is already used`);
  if (!isText(row.input)) p.push('input is empty');
  if (row.regex) { try { new RegExp(row.regex, 'i'); } catch { p.push('regex does not compile'); } }
  if (![row.expected, row.must_include, row.must_not_include, row.regex].some(isText)) p.push('needs at least one check (expected, must_include, must_not_include or regex)');
  return p;
}

export function validateCases(content, existingIds = new Set()) {
  if (!isObject(content) || !Array.isArray(content.rows)) return ['cases content must be { rows: [...] }'];
  if (!content.rows.length) return ['cases draft has no rows'];
  const ids = new Set(existingIds);
  const p = [];
  content.rows.forEach((r, i) => {
    for (const msg of validateCaseRow(r, ids)) p.push(`row ${i + 1}${r?.id ? ` (${r.id})` : ''}: ${msg}`);
    if (isText(r?.id)) ids.add(r.id);
  });
  return p;
}

export function validateFixes(content, failedIds) {
  if (!isObject(content) || !Array.isArray(content.groups)) return ['fixes content must be { groups: [...] }'];
  if (!content.groups.length) return ['fixes draft has no groups'];
  const p = [];
  content.groups.forEach((g, i) => {
    const label = `group ${i + 1}`;
    if (!isText(g?.cause) || !isText(g?.fix) || !isText(g?.owner)) p.push(`${label} needs cause, fix and owner`);
    if (!Array.isArray(g?.caseIds) || !g.caseIds.length || !g.caseIds.every(isText)) p.push(`${label} needs at least one case id`);
    else if (failedIds) for (const id of g.caseIds) if (!failedIds.has(id)) p.push(`${label} cites "${id}", which did not fail in the latest run`);
  });
  return p;
}

export function validateLaunchReport(content) {
  if (!isObject(content)) return ['launch-report content must be an object'];
  const p = [];
  if (!isText(content.summary)) p.push('summary is empty');
  if (!Array.isArray(content.risks) || !content.risks.every(isText)) p.push('risks must be a list of non-empty strings');
  if (!Array.isArray(content.decisions) || !content.decisions.length) p.push('decisions must list at least one decision');
  else content.decisions.forEach((d, i) => {
    if (!DATE.test(d?.date ?? '') || Number.isNaN(Date.parse(d.date))) p.push(`decision ${i + 1} needs a date as YYYY-MM-DD`);
    if (!isText(d?.decision) || !isText(d?.reason)) p.push(`decision ${i + 1} needs a decision and the reason for it`);
  });
  return p;
}
