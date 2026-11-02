// Calls the customer's AI product with one test input and returns its answer as text.
//
// target.type "http":    { url, method?, headers?, body?, output?, timeoutMs? }
//   body is a JSON template; any string equal to or containing {{input}} gets the input.
//   headers values may use ${ENV_VAR} so keys never live in the config file.
//   output is a dot path into the JSON response (e.g. "choices.0.message.content"); empty = whole body.
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

async function callHttp(target, input) {
  const headers = { 'content-type': 'application/json' };
  for (const [k, v] of Object.entries(target.headers ?? {})) headers[k] = expandEnv(v);
  const method = (target.method ?? 'POST').toUpperCase();
  await assertPublicUrl(target.url);
  const res = await fetch(target.url, {
    method,
    headers,
    redirect: redirectMode(),
    body: method === 'GET' ? undefined : JSON.stringify(fillTemplate(target.body ?? { input: '{{input}}' }, input)),
    signal: AbortSignal.timeout(target.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (!target.output) return text;
  const value = pickPath(JSON.parse(text), target.output);
  return typeof value === 'string' ? value : JSON.stringify(value);
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

export async function callTarget(target, input, { cwd } = {}) {
  if (target?.type === 'http') return callHttp(target, input);
  if (target?.type === 'command') return callCommand(target, input, cwd);
  if (target?.type === 'intercom') return callIntercom(target, input);
  if (target?.type === 'zendesk') return callZendesk(target, input);
  throw new Error(`unknown target type "${target?.type}" (use "http", "command", "intercom" or "zendesk")`);
}
