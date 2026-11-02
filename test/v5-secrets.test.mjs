import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readSecret, saveSecret, savedSecrets } from '../src/v3/secrets.mjs';
import { tmp } from './v3-support.test.mjs';

test('a saved key is encrypted at rest, reads back only with the same pepper, and lists by name only', () => {
  const dir = tmp('secrets');
  saveSecret(dir, 'API_KEY', 'sk-test-value-123', 'pepper-one-long-enough', new Date('2026-11-03T00:00:00Z'));
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.doesNotMatch(raw, /sk-test-value-123/);
  assert.equal(readSecret(dir, 'API_KEY', 'pepper-one-long-enough'), 'sk-test-value-123');
  assert.throws(() => readSecret(dir, 'API_KEY', 'another-pepper-entirely'));
  assert.throws(() => readSecret(dir, 'MISSING', 'pepper-one-long-enough'), /no saved key named MISSING/);
  assert.deepEqual(savedSecrets(dir), [{ name: 'API_KEY', savedAt: '2026-11-03T00:00:00.000Z' }]);
  assert.throws(() => saveSecret(dir, 'bad name', 'x', 'p'), /bad secret name/);
  assert.throws(() => saveSecret(dir, 'EMPTY', '  ', 'p'), /empty/);
});
