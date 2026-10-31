// Shared fixtures for the v3 suites (this file has no tests of its own): a server on port 0 in temp
// folders, org seeding straight into SQLite, a JSON client, and a fake AI target to run against.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer } from '../src/v3/server.mjs';
import { openDb } from '../src/v3/db.mjs';
import { addMember, createOrg } from '../src/v3/accounts.mjs';
import { createApiKey } from '../src/v3/keys.mjs';

export const PEPPER = 'test-pepper-not-a-secret-123';

export const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), `delomu-v3-${prefix}-`));

export function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

export function close(server) {
  server.closeAllConnections?.();
  return new Promise(resolve => server.close(() => resolve()));
}

export async function startServer(options = {}) {
  const dataDir = tmp('data');
  const deploymentsRoot = tmp('deps');
  const server = createServer({ dataDir, deploymentsRoot, pepper: PEPPER, log: () => {}, env: {}, ...options });
  const base = await listen(server);
  return { server, base, dataDir, deploymentsRoot, close: () => close(server) };
}

// Creates an org with members; returns { org, keys: { [email]: secret }, users: { [email]: userId } }.
export function seedOrg(dataDir, { name, kind = 'customer', partnerOrgId = null, members }) {
  const db = openDb(dataDir);
  try {
    const org = createOrg(db, { name, kind, partnerOrgId });
    const keys = {};
    const users = {};
    for (const { email, role, scopes } of members) {
      const m = addMember(db, org.id, { email, role }, null);
      users[email] = m.user_id;
      keys[email] = createApiKey(db, { orgId: org.id, userId: m.user_id, name: `${role} key`, scopes }, PEPPER).secret;
    }
    return { org, keys, users };
  } finally {
    db.close();
  }
}

export async function api(base, method, url, { key, body, headers = {}, raw } = {}) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (key) init.headers.authorization = `Bearer ${key}`;
  if (raw !== undefined) init.body = raw;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + url, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

// A stand-in for the customer's AI: answers every message with a refund confirmation.
export async function fakeTarget() {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ reply: 'Your refund was issued.' }));
    });
  });
  const base = await listen(server);
  return { url: `${base}/chat`, close: () => close(server) };
}

export const CASES_CSV = 'id,input,expected,must_include,must_not_include,tags\nr1,Refund please,,refund,,billing\nr2,Where is my order?,,tracking,,shipping\n';

export const targetConfig = url => ({ customer: 'Test Co', name: 'bot', target: { type: 'http', url, body: { message: '{{input}}' }, output: 'reply' }, acceptance: { minPassRate: 0.5 } });
