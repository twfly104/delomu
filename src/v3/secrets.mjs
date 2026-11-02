// Keys a customer pastes for their own AI (an API key, a help desk token), so connecting needs no server
// environment variable. Each is encrypted with AES-256-GCM under a key derived from the server's pepper and kept
// in the deployment folder (secrets.json). Targets refer to one as ${secret:NAME}; only this server can read it
// back, it is never shown again, and only its name appears in the audit log.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SECRET_NAME = /^[A-Z][A-Z0-9_]{0,40}$/;
const file = dir => path.join(dir, 'secrets.json');
const keyOf = pepper => crypto.createHash('sha256').update(`delomu-deployment-secrets\n${pepper}`).digest();

const readAll = dir => { try { return JSON.parse(fs.readFileSync(file(dir), 'utf8')); } catch { return {}; } };

export function saveSecret(dir, name, value, pepper, now = new Date()) {
  if (!SECRET_NAME.test(name)) throw new Error(`bad secret name ${name}`);
  const text = String(value ?? '').trim();
  if (!text) throw new Error('the key is empty');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyOf(pepper), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const all = readAll(dir);
  all[name] = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64'), savedAt: now.toISOString() };
  fs.writeFileSync(file(dir), JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
}

export function readSecret(dir, name, pepper) {
  const entry = readAll(dir)[name];
  if (!entry) throw new Error(`no saved key named ${name} for this AI agent; add it again in Settings`);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyOf(pepper), Buffer.from(entry.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(entry.data, 'base64')), decipher.final()]).toString('utf8');
}

// Names and when each was saved, never the values.
export const savedSecrets = dir => Object.entries(readAll(dir)).map(([name, e]) => ({ name, savedAt: e.savedAt }));
