// Entry point of the v3 multi-tenant server: createServer() wires storage, the /v1 JSON API, the web UI
// and /healthz into a node:http server (not listening); start() also listens. Configuration comes from
// options first, then environment variables, so the same code runs in tests, on a laptop and in a VPC.

import http from 'node:http';
import path from 'node:path';
import { createApiHandler } from './api.mjs';
import { openDb } from './db.mjs';
import { send, sendJson } from './http.mjs';
import { checkPepper } from './keys.mjs';
import { createOidcClient } from './oidc.mjs';
import { createRateLimiter } from './ratelimit.mjs';
import { createWebHandler } from './web.mjs';

export const DEFAULT_MAX_BODY = 1024 * 1024;

function checkPublicUrl(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('DELOMU_PUBLIC_URL must be a URL like https://delomu.example.com'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('DELOMU_PUBLIC_URL must use http or https');
  return url.href.replace(/\/+$/, '');
}

export function createServer({
  env = process.env,
  dataDir = env.DELOMU_DATA,
  deploymentsRoot = env.DELOMU_DEPLOYMENTS ?? (dataDir && path.join(dataDir, 'deployments')),
  pepper = env.DELOMU_KEY_PEPPER,
  publicUrl = env.DELOMU_PUBLIC_URL,
  trustProxy = env.DELOMU_TRUST_PROXY === '1',
  allowCommandTargets = env.DELOMU_ALLOW_COMMAND_TARGETS === '1',
  targetEnvPrefix = env.DELOMU_TARGET_ENV_PREFIX || 'CUSTOMER_',
  maxBodyBytes = DEFAULT_MAX_BODY,
  rateLimit = {},
  judge,
  llm,
  fetch,
  now = () => new Date(),
  log = message => console.error(message),
} = {}) {
  if (!dataDir) throw new Error('createServer needs dataDir (or DELOMU_DATA)');
  checkPepper(pepper);
  const baseUrl = checkPublicUrl(publicUrl);

  const db = openDb(dataDir);
  const ctx = {
    db,
    deploymentsRoot: path.resolve(deploymentsRoot),
    pepper,
    env,
    publicUrl: baseUrl,
    maxBodyBytes,
    policy: { allowCommandTargets, envPrefix: targetEnvPrefix },
    judge,
    llm,
    now,
    log,
    oidc: createOidcClient({ fetch }),
    rateLimit: createRateLimiter(rateLimit),
    secureCookies: req => ctx.publicUrl?.startsWith('https:') || (trustProxy && req.headers['x-forwarded-proto'] === 'https'),
    // The trusted proxy appends the address it saw, so the last entry is the only one a client cannot forge.
    clientIp: req => (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1).trim()) || req.socket.remoteAddress || '',
  };
  const api = createApiHandler(ctx);
  const web = createWebHandler(ctx);

  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://server.invalid');
    } catch {
      sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'Malformed URL.' } });
      return;
    }
    if (url.pathname === '/healthz' && req.method === 'GET') {
      try {
        db.prepare('SELECT 1').get();
        sendJson(res, 200, { ok: true });
      } catch {
        send(res, 503, 'database unavailable\n', { 'content-type': 'text/plain' });
      }
      return;
    }
    if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) await api(req, res, url);
    else await web(req, res, url);
  });
  server.on('close', () => db.close());
  return server;
}

// Listens on port (0 picks a free one) and resolves with the listening server. With no options, the
// data folder, pepper and the rest come from the environment, as in the Docker image.
export function start(port, options = {}) {
  const server = createServer(options);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, options.host ?? '0.0.0.0', () => resolve(server));
  });
}
