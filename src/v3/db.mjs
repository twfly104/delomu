// SQLite storage for the v3 server (dataDir/delomu.db): connection setup, forward-only migrations,
// transactions and id generation. Every other v3 module receives the handle opened here.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Append only: never edit a migration that has shipped, add a new one.
const MIGRATIONS = [
  `CREATE TABLE orgs (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     slug TEXT NOT NULL UNIQUE,
     kind TEXT NOT NULL CHECK (kind IN ('customer', 'partner')),
     partner_org_id TEXT REFERENCES orgs(id),
     created_at TEXT NOT NULL,
     CHECK (partner_org_id IS NULL OR kind = 'customer')
   );
   CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL
   );
   CREATE TABLE memberships (
     org_id TEXT NOT NULL REFERENCES orgs(id),
     user_id TEXT NOT NULL REFERENCES users(id),
     role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'engineer', 'reviewer', 'viewer')),
     created_at TEXT NOT NULL,
     PRIMARY KEY (org_id, user_id)
   );
   CREATE TABLE api_keys (
     id TEXT PRIMARY KEY,
     org_id TEXT NOT NULL REFERENCES orgs(id),
     user_id TEXT NOT NULL REFERENCES users(id),
     name TEXT NOT NULL,
     prefix TEXT NOT NULL,
     hash TEXT NOT NULL UNIQUE,
     scopes TEXT,
     created_at TEXT NOT NULL,
     last_used_at TEXT,
     revoked_at TEXT
   );
   CREATE TABLE sessions (
     id TEXT PRIMARY KEY,
     token_hash TEXT NOT NULL UNIQUE,
     user_id TEXT NOT NULL REFERENCES users(id),
     org_id TEXT NOT NULL REFERENCES orgs(id),
     csrf_token TEXT NOT NULL,
     scopes TEXT,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE TABLE oidc_configs (
     org_id TEXT PRIMARY KEY REFERENCES orgs(id),
     issuer TEXT NOT NULL,
     client_id TEXT NOT NULL,
     client_secret_env TEXT,
     allowed_domains TEXT NOT NULL,
     default_role TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE oidc_logins (
     state_hash TEXT PRIMARY KEY,
     org_id TEXT NOT NULL REFERENCES orgs(id),
     nonce TEXT NOT NULL,
     code_verifier TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE TABLE audit_events (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,
     org_id TEXT NOT NULL REFERENCES orgs(id),
     ts TEXT NOT NULL,
     actor TEXT NOT NULL,
     action TEXT NOT NULL,
     target TEXT NOT NULL DEFAULT '',
     detail TEXT NOT NULL DEFAULT '{}',
     ip TEXT NOT NULL DEFAULT ''
   );
   CREATE INDEX audit_events_org ON audit_events (org_id, seq);
   CREATE TABLE idempotency_keys (
     scope TEXT NOT NULL,
     key TEXT NOT NULL,
     request_hash TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('pending', 'done')),
     status_code INTEGER,
     response_body TEXT,
     created_at TEXT NOT NULL,
     PRIMARY KEY (scope, key)
   );
   CREATE TABLE deployments (
     org_id TEXT NOT NULL REFERENCES orgs(id),
     name TEXT NOT NULL,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     PRIMARY KEY (org_id, name)
   );`,
  // A web session opened with an API key ends when that key is revoked.
  `ALTER TABLE sessions ADD COLUMN api_key_id TEXT REFERENCES api_keys(id);
   CREATE INDEX sessions_api_key ON sessions (api_key_id);`,
  // Billing (src/v3/billing.mjs): each org's plan and Stripe subscription, the Stripe events already
  // applied (webhooks can arrive twice), and one meter event per extra active deployment per month.
  `CREATE TABLE billing_accounts (
     org_id TEXT PRIMARY KEY REFERENCES orgs(id),
     plan TEXT NOT NULL CHECK (plan IN ('free', 'team', 'enterprise')),
     status TEXT NOT NULL DEFAULT 'none',
     stripe_customer_id TEXT UNIQUE,
     stripe_subscription_id TEXT UNIQUE,
     current_period_end TEXT,
     cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
     payment_failed_at TEXT,
     stripe_event_created INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE stripe_events (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     created INTEGER NOT NULL,
     received_at TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT ''
   );
   CREATE TABLE billing_usage_reports (
     org_id TEXT NOT NULL REFERENCES orgs(id),
     month TEXT NOT NULL,
     deployment TEXT NOT NULL,
     identifier TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL,
     reported_at TEXT,
     error TEXT,
     PRIMARY KEY (org_id, month, deployment)
   );`,
  // The Vendor plan (AI vendors, priced per client). SQLite cannot change a CHECK in place, so the table is
  // rebuilt with the same columns and its rows copied over.
  `CREATE TABLE billing_accounts_v2 (
     org_id TEXT PRIMARY KEY REFERENCES orgs(id),
     plan TEXT NOT NULL CHECK (plan IN ('free', 'team', 'vendor', 'enterprise')),
     status TEXT NOT NULL DEFAULT 'none',
     stripe_customer_id TEXT UNIQUE,
     stripe_subscription_id TEXT UNIQUE,
     current_period_end TEXT,
     cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
     payment_failed_at TEXT,
     stripe_event_created INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL
   );
   INSERT INTO billing_accounts_v2 SELECT org_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_end,
     cancel_at_period_end, payment_failed_at, stripe_event_created, updated_at FROM billing_accounts;
   DROP TABLE billing_accounts;
   ALTER TABLE billing_accounts_v2 RENAME TO billing_accounts;`,
  // Links opened without signing in (src/v3/shares.mjs): a client's sign-off page, an agent's public page.
  `CREATE TABLE share_links (
     id TEXT PRIMARY KEY,
     org_id TEXT NOT NULL REFERENCES orgs(id),
     deployment TEXT NOT NULL,
     purpose TEXT NOT NULL CHECK (purpose IN ('signoff', 'verified')),
     subject TEXT NOT NULL DEFAULT '',
     token_hash TEXT NOT NULL UNIQUE,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT,
     revoked_at TEXT
   );
   CREATE INDEX share_links_deployment ON share_links (org_id, deployment, purpose);`,
];

export function openDb(dataDir) {
  if (!dataDir) throw new Error('dataDir is required');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'delomu.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
  if (done > MIGRATIONS.length) throw new Error(`database schema v${done} is newer than this server (v${MIGRATIONS.length})`);
  for (let v = done + 1; v <= MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v - 1]);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, new Date().toISOString());
    });
  }
  return MIGRATIONS.length;
}

// Runs fn inside one transaction; rolls back if it throws. Not re-entrant (SQLite has no nested BEGIN).
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const newId = prefix => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;

export const parseJson = (text, fallback) => (text == null ? fallback : JSON.parse(text));
