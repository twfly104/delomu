#!/usr/bin/env node
// CLI entry. Every file in src/commands/ exports `commands`: [{ name, usage, summary, run(args) => exit code }].
// Adding a version means adding a command file; this file does not change.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const commandsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'commands');

async function loadCommands() {
  const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.mjs')).sort();
  const all = new Map();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, f)).href);
    for (const c of mod.commands ?? []) {
      if (all.has(c.name)) throw new Error(`command "${c.name}" is defined twice (${f})`);
      all.set(c.name, c);
    }
  }
  return all;
}

function help(commands) {
  const width = Math.max(...[...commands.values()].map(c => c.usage.length));
  const lines = [...commands.values()].map(c => `  ${c.usage.padEnd(width)}  ${c.summary}`);
  return `delomu: AI forward-deployed engineer\n\n${lines.join('\n')}`;
}

async function main(argv) {
  const commands = await loadCommands();
  const [cmd, ...args] = argv;
  if (!cmd || ['help', '--help', '-h'].includes(cmd)) { console.log(help(commands)); return 0; }
  const c = commands.get(cmd);
  if (!c) throw new Error(`unknown command "${cmd}"\n\n${help(commands)}`);
  return (await c.run(args)) ?? 0;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => {
  console.error(`error: ${e.message}`);
  process.exitCode = 2;
});
