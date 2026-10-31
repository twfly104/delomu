// The fingerprint of a deployment: what, if it changes, means the last test results no longer describe
// production. It hashes tests.json, the target config (as written, so ${ENV} placeholders and not secrets
// are hashed) and the version the customer's AI reports through the optional version probe.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { paths } from '../deployment.mjs';
import { callTarget } from '../adapters.mjs';

const sha = text => crypto.createHash('sha256').update(text).digest('hex');

// JSON with object keys sorted, so key order in delomu.json never changes the hash.
export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

// Returns the version string the probe reports. Throws when the probe fails.
export async function probeVersion(probe, dir) {
  const target = probe.type === 'http'
    ? { type: 'http', method: 'GET', url: probe.url, headers: probe.headers, output: probe.path, timeoutMs: probe.timeoutMs }
    : { type: 'command', command: probe.command, timeoutMs: probe.timeoutMs };
  const version = String(await callTarget(target, '', { cwd: dir })).trim();
  if (!version) throw new Error('version probe returned an empty value');
  return version.slice(0, 200);
}

// parts: { tests, target, version } where tests/target are hashes and version is the probed value
// (or null when there is no probe). A failed probe keeps previousVersion so a flaky probe endpoint
// never looks like a model change; the failure is returned as probeError for the caller to log.
export async function computeFingerprint(dir, { target, probe, previousVersion = null }) {
  const testsFile = paths(dir).tests;
  if (!fs.existsSync(testsFile)) throw new Error(`no tests.json in ${dir}`);
  const parts = { tests: sha(fs.readFileSync(testsFile)), target: sha(stableStringify(target)), version: null };
  let probeError = null;
  if (probe) {
    try {
      parts.version = await probeVersion(probe, dir);
    } catch (e) {
      probeError = e.message;
      parts.version = previousVersion;
    }
  }
  return { hash: sha(stableStringify(parts)), parts, probeError };
}

// Names of the parts that differ, e.g. ["version"]. Empty when there is no previous fingerprint.
export function changedParts(previous, current) {
  if (!previous) return [];
  return Object.keys(current).filter(k => previous[k] !== current[k]);
}
