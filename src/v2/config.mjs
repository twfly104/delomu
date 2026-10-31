// Reads and validates the "monitor" section of delomu.json. Everything v2 needs from the config
// goes through here so a bad value fails once, with a message that names the field.
//
// "monitor": {
//   "intervalHours": 24,                       re-run at least this often (default 24)
//   "webhookEnv": "ACME_SLACK_WEBHOOK",        name of the env var holding the Slack-compatible webhook URL
//   "versionProbe": { "type": "http", "url": "...", "path": "model.version", "headers"?: {...} }
//                 | { "type": "command", "command": "..." }
// }

import fs from 'node:fs';
import { paths } from '../deployment.mjs';

export const DEFAULT_INTERVAL_HOURS = 24;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function readRawConfig(dir) {
  const file = paths(dir).config;
  if (!fs.existsSync(file)) throw new Error(`no delomu.json in ${dir}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
}

function timeout(probe) {
  const ms = probe.timeoutMs ?? 10_000;
  if (!Number.isInteger(ms) || ms <= 0) throw new Error('monitor.versionProbe.timeoutMs must be a positive whole number of milliseconds');
  return ms;
}

function validateProbe(probe) {
  if (probe === undefined || probe === null) return null;
  if (typeof probe !== 'object') throw new Error('monitor.versionProbe must be an object');
  if (probe.type === 'http') {
    if (typeof probe.url !== 'string' || !/^https?:\/\//i.test(probe.url)) throw new Error('monitor.versionProbe.url must be an http(s) URL');
    if (probe.path !== undefined && typeof probe.path !== 'string') throw new Error('monitor.versionProbe.path must be a string');
    const headers = probe.headers ?? {};
    if (typeof headers !== 'object' || Array.isArray(headers) || Object.values(headers).some(v => typeof v !== 'string')) {
      throw new Error('monitor.versionProbe.headers must be an object of strings (values may use ${ENV_VAR})');
    }
    return { type: 'http', url: probe.url, path: probe.path ?? '', headers, timeoutMs: timeout(probe) };
  }
  if (probe.type === 'command') {
    if (typeof probe.command !== 'string' || !probe.command.trim()) throw new Error('monitor.versionProbe.command must be a non-empty string');
    return { type: 'command', command: probe.command, timeoutMs: timeout(probe) };
  }
  throw new Error(`monitor.versionProbe.type must be "http" or "command" (got "${probe.type}")`);
}

export function monitorConfig(raw) {
  const m = raw.monitor ?? {};
  if (typeof m !== 'object' || Array.isArray(m)) throw new Error('delomu.json "monitor" must be an object');
  const intervalHours = m.intervalHours ?? DEFAULT_INTERVAL_HOURS;
  if (typeof intervalHours !== 'number' || !(intervalHours > 0)) throw new Error('monitor.intervalHours must be a positive number');
  if (m.webhookEnv !== undefined && (typeof m.webhookEnv !== 'string' || !ENV_NAME.test(m.webhookEnv))) {
    throw new Error('monitor.webhookEnv must be the name of an environment variable (letters, digits, underscore)');
  }
  return { intervalHours, webhookEnv: m.webhookEnv ?? null, versionProbe: validateProbe(m.versionProbe) };
}
