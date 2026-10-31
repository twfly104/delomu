// v3 commands: run the multi-tenant server (API + web UI), and bootstrap the first org on a new install.

import path from 'node:path';
import { flag, need } from './args.mjs';
import { start } from '../v3/server.mjs';
import { bootstrap } from '../v3/bootstrap.mjs';

const dataDirFrom = value => path.resolve(value ?? process.env.DELOMU_DATA ?? 'data');

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a number from 0 to 65535');
  return port;
}

export const commands = [
  {
    name: 'serve',
    usage: 'serve [--port N] [--data DIR] [--deployments DIR]',
    summary: 'run the enterprise server: /v1 API, web review UI, SSO (needs DELOMU_KEY_PEPPER)',
    async run(args) {
      const port = parsePort(flag(args, '--port') ?? process.env.PORT ?? 8080);
      const dataDir = dataDirFrom(flag(args, '--data'));
      const deploymentsRoot = path.resolve(flag(args, '--deployments') ?? process.env.DELOMU_DEPLOYMENTS ?? path.join(dataDir, 'deployments'));
      const host = process.env.DELOMU_HOST ?? '127.0.0.1';
      const server = await start(port, { dataDir, deploymentsRoot, host });
      console.log(`Delomu server listening on http://${host}:${server.address().port} (data ${dataDir}, deployments ${deploymentsRoot}).`);
      await new Promise(resolve => {
        const stop = () => { server.close(resolve); server.closeAllConnections(); };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
      return 0;
    },
  },
  {
    name: 'admin',
    usage: 'admin bootstrap --org NAME --email EMAIL [--kind customer|partner] [--data DIR]',
    summary: 'create the first org, its owner and an API key (printed once)',
    run(args) {
      const usage = 'admin bootstrap --org NAME --email EMAIL [--kind customer|partner] [--data DIR]';
      const org = flag(args, '--org');
      const email = flag(args, '--email');
      const kind = flag(args, '--kind') ?? 'customer';
      const dataDir = dataDirFrom(flag(args, '--data'));
      if (args[0] !== 'bootstrap') need(undefined, usage);
      need(org && email, usage);
      const r = bootstrap({ dataDir, org, email, kind, pepper: process.env.DELOMU_KEY_PEPPER });
      console.log(`Created ${r.org.kind} org "${r.org.name}" (${r.org.id}, slug ${r.org.slug}) with owner ${r.member.email}.`);
      console.log(`API key (shown once, store it in a secret manager now):\n  ${r.secret}`);
      return 0;
    },
  },
];
