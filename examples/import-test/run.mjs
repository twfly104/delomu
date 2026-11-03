// Real import test: runs Delomu's read-only importer (src/v3/importers.mjs) against your own trial accounts and
// prints what came back, with a preview of each file. Tokens are read from the environment and never printed.
// usage: node --env-file=examples/import-test/.env examples/import-test/run.mjs [out-dir]

import fs from 'node:fs';
import path from 'node:path';
import { importFrom } from '../../src/v3/importers.mjs';

const out = process.argv[2] ?? path.join('recordings', 'import-test');
const env = process.env;
const runs = [
  ['zendesk', { subdomain: env.ZENDESK_SUBDOMAIN, email: env.ZENDESK_EMAIL, token: env.ZENDESK_TOKEN }, env.ZENDESK_TOKEN],
  ['intercom', { token: env.INTERCOM_TOKEN }, env.INTERCOM_TOKEN],
  ['shopify', { shop: env.SHOPIFY_SHOP, token: env.SHOPIFY_TOKEN }, env.SHOPIFY_TOKEN],
];
let failed = 0;
for (const [source, creds, token] of runs) {
  if (!token) { console.log(`${source}: skipped (no token in .env)`); continue; }
  try {
    const t0 = Date.now();
    const { files, summary } = await importFrom(source, creds, { limit: 20 });
    fs.mkdirSync(path.join(out, source), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(out, source, f.name), f.text);
    console.log(`${source}: OK in ${((Date.now() - t0) / 1000).toFixed(1)} s · ${JSON.stringify(summary)} · files: ${files.map(f => f.name).join(', ') || 'none'}`);
    for (const f of files) console.log(`  ${f.name}: ${f.text.split('\n').slice(0, 3).join(' | ').slice(0, 220)}`);
  } catch (e) {
    failed++;
    console.log(`${source}: FAILED: ${String(e.message).split(token).join('[token]')}`);
  }
}
process.exit(failed ? 1 : 0);
