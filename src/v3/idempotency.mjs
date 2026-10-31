// Idempotency-Key support for POST requests, as payment APIs do it: the first request with a key runs
// and its response is stored; a retry with the same key and body replays that response; the same key
// with a different body, or while the first is still running, is an error. Keys expire after 24 hours.

import crypto from 'node:crypto';
import { ApiError, invalid } from './http.mjs';

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const requestHash = (method, path, body) => crypto.createHash('sha256').update(`${method}\n${path}\n${body}`).digest('hex');

export function checkIdempotencyKey(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(value)) {
    throw invalid('Idempotency-Key must be 1 to 255 printable ASCII characters.', 'Idempotency-Key');
  }
  return value;
}

// Returns { replay: { status, body } } for a completed earlier request, or { finish(status, body) } to store this one.
export function beginIdempotent(db, { scope, key, method, path, body }, now = new Date()) {
  const hash = requestHash(method, path, body);
  db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(new Date(now.getTime() - IDEMPOTENCY_TTL_MS).toISOString());
  const found = db.prepare('SELECT * FROM idempotency_keys WHERE scope = ? AND key = ?').get(scope, key);
  if (found) {
    if (found.request_hash !== hash) {
      throw new ApiError('idempotency_error', 'This Idempotency-Key was already used with a different request.', { status: 422 });
    }
    if (found.state === 'pending') throw new ApiError('idempotency_error', 'A request with this Idempotency-Key is still in progress.');
    return { replay: { status: found.status_code, body: found.response_body } };
  }
  db.prepare("INSERT INTO idempotency_keys (scope, key, request_hash, state, created_at) VALUES (?, ?, ?, 'pending', ?)")
    .run(scope, key, hash, now.toISOString());
  return {
    // Server errors are not stored, so the client can retry them with the same key.
    finish(status, responseBody) {
      if (status >= 500) db.prepare('DELETE FROM idempotency_keys WHERE scope = ? AND key = ?').run(scope, key);
      else db.prepare("UPDATE idempotency_keys SET state = 'done', status_code = ?, response_body = ? WHERE scope = ? AND key = ?").run(status, responseBody, scope, key);
    },
  };
}
