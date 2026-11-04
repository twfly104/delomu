// Entry point of the v3 multi-tenant server: createServer() wires storage, the /v1 JSON API, the web UI
// and /healthz into a node:http server (not listening); start() also listens. Configuration comes from
// options first, then environment variables, so the same code runs in tests, on a laptop and in a VPC.

import { blockPrivateTargets } from '../core/netguard.mjs';
import { setSecretResolver } from '../adapters.mjs';
import { readSecret } from './secrets.mjs';
import http from 'node:http';
import path from 'node:path';
import { createApiHandler } from './api.mjs';
import { createBilling } from './billing.mjs';
import { openDb } from './db.mjs';
import { send, sendJson } from './http.mjs';
import { checkPepper } from './keys.mjs';
import { createOidcClient } from './oidc.mjs';
import { createRateLimiter } from './ratelimit.mjs';
import { createWebHandler } from './web.mjs';
import { createMcpHandler } from './mcp.mjs';
import { authenticate } from './api.mjs';
import { monitorTick } from './monitoring.mjs';
import { deploymentDir } from './workspace.mjs';
import { recordEvent } from './events.mjs';

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
  publicUrl = env.DELOMU_PUBLIC_URL ?? (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined),
  trustProxy = env.DELOMU_TRUST_PROXY === '1',
  allowCommandTargets = env.DELOMU_ALLOW_COMMAND_TARGETS === '1',
  targetEnvPrefix = env.DELOMU_TARGET_ENV_PREFIX || 'CUSTOMER_',
  maxBodyBytes = DEFAULT_MAX_BODY,
  // How often the server checks monitored deployments (step 6). 0 turns the timer off.
  monitorMinutes = Number(env.DELOMU_MONITOR_MINUTES ?? 15),
  rateLimit = {},
  judge,
  llm,
  demoBotClient,
  // Replaces the JSON request used by read-only imports (src/v3/importers.mjs); tests inject a fake.
  importJson,
  fetch,
  now = () => new Date(),
  log = message => console.error(message),
} = {}) {
  if (!dataDir) throw new Error('createServer needs dataDir (or DELOMU_DATA)');
  checkPepper(pepper);
  const baseUrl = checkPublicUrl(publicUrl);
  // An internet-facing server (it has a public URL) never lets a tenant aim it at its own network: localhost,
  // the cloud metadata address, private ranges. DELOMU_ALLOW_PRIVATE_TARGETS=1 or 0 overrides that either way.
  const privateEnv = env.DELOMU_ALLOW_PRIVATE_TARGETS;
  // Keys customers saved for their own AI are read here only, from the deployment folder of the call.
  setSecretResolver((name, cwd) => {
    if (!cwd) throw new Error('a saved key needs the AI agent it belongs to');
    return readSecret(cwd, name, pepper);
  });
  blockPrivateTargets(privateEnv === '0' || (privateEnv !== '1' && Boolean(baseUrl)));

  const db = openDb(dataDir);
  let billing;
  try {
    billing = createBilling({ db, env, deploymentsRoot: path.resolve(deploymentsRoot), now, log, fetch });
  } catch (e) {
    db.close();
    throw e;
  }
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
    demoBotClient,
    importJson,
    now,
    log,
    oidc: createOidcClient({ fetch }),
    billing,
    rateLimit: createRateLimiter(rateLimit),
    secureCookies: req => ctx.publicUrl?.startsWith('https:') || (trustProxy && req.headers['x-forwarded-proto'] === 'https'),
    // The trusted proxy appends the address it saw, so the last entry is the only one a client cannot forge.
    clientIp: req => (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1).trim()) || req.socket.remoteAddress || '',
  };
  const api = createApiHandler(ctx);
  const web = createWebHandler(ctx);
  const mcp = createMcpHandler(ctx, authenticate);

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
    if (url.pathname === '/webhooks/stripe') await billing.handleWebhook(req, res, { maxBodyBytes });
    else if (url.pathname === '/mcp') await mcp(req, res);
    else if (url.pathname === '/v1' || url.pathname.startsWith('/v1/')) await api(req, res, url);
    else await web(req, res, url);
  });
  // Regression monitoring for the deployments that turned it on (src/v3/monitoring.mjs). One pass at a time.
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const list = db.prepare('SELECT org_id, name FROM deployments ORDER BY org_id, name').all()
        .map(r => ({ orgId: r.org_id, name: r.name, dir: deploymentDir(ctx.deploymentsRoot, r.org_id, r.name) }));
      for (const r of await monitorTick(ctx, list)) {
        if (r.ran) recordEvent(db, { orgId: r.orgId, actor: 'system', action: 'monitor.run', target: r.name, detail: { reason: r.reason } }, ctx.now());
        if (r.error) log(`monitor: ${r.name}: ${r.error}`);
      }
    } catch (e) {
      log(`monitor pass failed: ${e.message}`);
    } finally {
      ticking = false;
    }
  };
  ctx.monitorTick = tick;
  const timer = monitorMinutes > 0 ? setInterval(tick, monitorMinutes * 60_000) : null;
  timer?.unref();
  server.on('close', () => { if (timer) clearInterval(timer); db.close(); });
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
