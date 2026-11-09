// Calls the customer's AI product with one test input and returns its answer as text.
//
// target.type "http":    { url, method?, headers?, body?, output?, timeoutMs? }
//   body is a JSON template; any string equal to or containing {{input}} gets the input.
//   headers values may use ${ENV_VAR} so keys never live in the config file.
//   output is a dot path into the JSON response (e.g. "choices.0.message.content"); empty = whole body.
//   actions, optional, is a dot path to what the agent did (tool calls such as refunds), judged with the words.
//   history, optional, is a body field that takes earlier turns as [{ role: "user" | "assistant", content }]; a body
//   with an OpenAI-style "messages" array gets earlier turns inserted before the {{input}} message automatically.
// target.type "command": { command, timeoutMs? }
//   the input is written to stdin; stdout is the answer. Runs in the deployment folder.
// target.type "intercom": { token, contactExternalId?, pollMs?, timeoutMs?, baseUrl? }  see connectors/intercom.mjs
// target.type "zendesk":  { appId, keyId, secret, subdomain | baseUrl, pollMs?, timeoutMs? }  see connectors/zendesk.mjs
//   both start a conversation in the help desk and wait for the AI agent's reply; secrets are ${ENV_VAR} references.

import { spawn } from 'node:child_process';
import { callIntercom } from './connectors/intercom.mjs';
import { callZendesk } from './connectors/zendesk.mjs';
import { assertPublicUrl, redirectMode } from './core/netguard.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

export function fillTemplate(value, input) {
  if (typeof value === 'string') return value.split('{{input}}').join(input);
  if (Array.isArray(value)) return value.map(v => fillTemplate(v, input));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplate(v, input)]));
  }
  return value;
}

export function expandEnv(text, env = process.env) {
  return String(text).replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
    if (env[name] === undefined) throw new Error(`environment variable ${name} is not set`);
    return env[name];
  });
}

export function pickPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null || !Object.hasOwn(Object(cur), key)) throw new Error(`response has no "${path}"`);
    cur = cur[key];
  }
  return cur;
}

// The request body with earlier turns in it, or null when this target has no place for them.
export function historyBody(target, input, turns) {
  const tpl = target.body ?? {};
  const filled = fillTemplate(tpl, input);
  const msgs = turns.map(t => ({ role: t.role, content: t.content }));
  const at = Array.isArray(tpl.messages) ? tpl.messages.findIndex(m => m?.content === '{{input}}') : -1;
  if (at >= 0) return { ...filled, messages: [...filled.messages.slice(0, at), ...msgs, ...filled.messages.slice(at)] };
  if (typeof target.history === 'string' && target.history) return { ...filled, [target.history]: msgs };
  return null;
}

// Earlier turns written into one message, for a target that takes a single message only.
export function replayText(turns, input) {
  const lines = turns.map(t => `${t.role === 'user' ? 'Customer' : 'You'}: ${t.content}`).join('\n');
  return `(This continues a conversation you are already having with this customer. What was said so far:)
${lines}

(The customer's new message:)
${input}`;
}

async function callHttp(target, input, bodyOverride) {
  const headers = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(target.headers ?? {})) headers[k] = expandEnv(v);
  const method = (target.method ?? 'POST').toUpperCase();
  await assertPublicUrl(target.url);
  const res = await fetch(target.url, {
    method,
    headers,
    redirect: redirectMode(),
    body: method === 'GET' ? undefined : JSON.stringify(bodyOverride ?? fillTemplate(target.body ?? { input: '{{input}}' }, input)),
    signal: AbortSignal.timeout(target.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (!target.output && !target.actions) return { answer: text };
  const json = JSON.parse(text);
  const value = target.output ? pickPath(json, target.output) : json;
  const out = { answer: typeof value === 'string' ? value : JSON.stringify(value) };
  if (target.actions) {
    let actions;
    try { actions = pickPath(json, target.actions); } catch { actions = []; }
    out.actions = (Array.isArray(actions) ? actions : actions == null ? [] : [actions]).slice(0, 20);
  }
  return out;
}

function callCommand(target, input, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(target.command, { cwd, shell: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('command timed out')); }, target.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`command exited ${code}: ${err.trim().slice(0, 200)}`));
    });
    child.stdin.end(input);
  });
}

// A target may refer to a key the customer saved in Grapim as ${secret:NAME}. Only the server can read those
// (src/v3/secrets.mjs registers the resolver); the values replace the references just before the call.
let secretResolver = null;
export const setSecretResolver = fn => { secretResolver = fn; };
const SECRET_REF = /\$\{secret:([A-Z][A-Z0-9_]*)\}/g;

function withSecrets(target, cwd) {
  const json = JSON.stringify(target ?? {});
  if (!json.includes('${secret:')) return target;
  if (!secretResolver) throw new Error('this AI agent uses a key saved in Grapim, which only the Grapim server can read');
  return JSON.parse(json.replace(SECRET_REF, (_, name) => JSON.stringify(secretResolver(name, cwd)).slice(1, -1)));
}

export async function callTarget(rawTarget, input, { cwd } = {}) {
  return (await callTargetFull(rawTarget, input, { cwd })).answer;
}

// The answer and, when the target reports them, the actions the agent took ({ answer, actions? }).
// history: earlier turns of the same conversation, [{ role: 'user' | 'assistant', content }]. Sent as real turns when
// the target can take them (historyMode 'native'); otherwise written into the message as a transcript ('replayed').
export async function callTargetFull(rawTarget, input, { cwd, history } = {}) {
  const target = withSecrets(rawTarget, cwd);
  const turns = (Array.isArray(history) ? history : []).filter(t => (t?.role === 'user' || t?.role === 'assistant') && typeof t.content === 'string');
  if (turns.length) {
    const body = target?.type === 'http' ? historyBody(target, input, turns) : null;
    if (body) return { ...(await callHttp(target, input, body)), historyMode: 'native' };
    const text = replayText(turns, input);
    const out = target?.type === 'http' ? await callHttp(target, text) : { answer: await callOther(target, text, cwd) };
    return { ...out, historyMode: 'replayed' };
  }
  if (target?.type === 'http') return callHttp(target, input);
  return { answer: await callOther(target, input, cwd) };
}

async function callOther(target, input, cwd) {
  if (target?.type === 'command') return callCommand(target, input, cwd);
  if (target?.type === 'intercom') return callIntercom(target, input);
  if (target?.type === 'zendesk') return callZendesk(target, input);
  throw new Error(`unknown target type "${target?.type}" (use "http", "command", "intercom" or "zendesk")`);
}
