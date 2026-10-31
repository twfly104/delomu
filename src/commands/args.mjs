// Tiny argument helpers shared by command files. Not a command file itself (exports no `commands`).

// Removes "--name value" from args and returns value (or undefined).
export function flag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} needs a value`);
  args.splice(i, 2);
  return v;
}

// Removes "--name" from args and returns whether it was present.
export function bool(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

export function need(value, usage) {
  if (value === undefined || value === '') throw new Error(`usage: delomu ${usage}`);
  return value;
}
