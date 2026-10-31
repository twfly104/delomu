// Finds deployment folders (any folder holding delomu.json) under a root, so one watcher or one
// invoice run covers every customer. Skips dependency, output and customer-material folders.

import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', 'runs', 'drafts', 'inputs']);

export function findDeployments(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`${root} is not a folder`);
  const found = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    if (fs.existsSync(path.join(dir, 'delomu.json'))) found.push(dir);
    // Dirent.isDirectory() is false for symlinks, so links are never followed (no cycles, no escaping root).
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(path.join(dir, e.name));
    }
  }
  return found.sort();
}
