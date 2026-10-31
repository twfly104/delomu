// v4 command: "library" with subcommands harvest, search, suggest, forget and stats, for the
// de-identified, consented deployment knowledge library.

import { flag, need } from './args.mjs';
import { harvest, search, suggest, forget, stats } from '../v4/library.mjs';

const USAGE = {
  harvest: 'library harvest <dir> --library DIR [--by NAME]',
  search: 'library search <query> --library DIR [--kind case|integration|failure] [--tag T] [--limit N]',
  suggest: 'library suggest <dir> --library DIR [--limit N]',
  forget: 'library forget <sourceHash> --library DIR',
  stats: 'library stats --library DIR',
};

const fmtCounts = obj => Object.entries(obj).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

function preview(e) {
  if (e.kind === 'case') return e.input;
  if (e.kind === 'integration') return e.summary;
  return `${e.pattern} (${e.cases} case(s))`;
}

const sub = {
  harvest(args, libraryDir) {
    const by = flag(args, '--by');
    const dir = need(args[0], USAGE.harvest);
    const r = harvest(dir, { libraryDir, by });
    console.log(`Harvested ${r.added} entries (${fmtCounts(r.byKind)}) into ${libraryDir}; replaced ${r.removed} earlier entries.`);
    console.log(`  redactions: ${fmtCounts(r.redactions)}`);
    console.log(`  source: ${r.source} (keep this to delete the entries later with "delomu library forget")`);
    return 0;
  },
  search(args, libraryDir) {
    const kind = flag(args, '--kind');
    const limit = flag(args, '--limit');
    const tags = [];
    for (let t = flag(args, '--tag'); t !== undefined; t = flag(args, '--tag')) tags.push(t);
    const query = need(args.join(' ').trim(), USAGE.search);
    const hits = search(libraryDir, query, { kind, limit, tags });
    if (!hits.length) console.log('No matching entries.');
    for (const h of hits) console.log(`${h.score.toFixed(2).padStart(6)}  ${h.kind.padEnd(11)}  ${h.id}  ${preview(h).slice(0, 100)}`);
    return 0;
  },
  suggest(args, libraryDir) {
    const limit = flag(args, '--limit');
    const dir = need(args[0], USAGE.suggest);
    const draft = suggest(dir, { libraryDir, limit });
    if (!draft) { console.log('No new library cases match this deployment.'); return 0; }
    console.log(`Created draft ${draft.id} with ${draft.content.rows.length} suggested case(s).`);
    console.log(`Review it with "delomu drafts ${dir} --show ${draft.id}" and "delomu review ${dir} ${draft.id} approve|reject --by NAME".`);
    return 0;
  },
  forget(args, libraryDir) {
    const source = need(args[0], USAGE.forget);
    const { removed } = forget(libraryDir, source);
    console.log(`Removed ${removed} entries from source ${source}.`);
    return 0;
  },
  stats(args, libraryDir) {
    const s = stats(libraryDir);
    console.log(`${s.entries} entries from ${s.sources} deployment(s)`);
    console.log(`  by kind: ${fmtCounts(s.byKind)}`);
    console.log(`  by industry: ${fmtCounts(s.byIndustry)}`);
    console.log(`  last harvest: ${s.lastHarvestAt ?? 'never'}`);
    return 0;
  },
};

export const commands = [
  {
    name: 'library',
    usage: 'library harvest|search|suggest|forget|stats ... --library DIR',
    summary: 'de-identified deployment knowledge library: harvest (with consent), search, suggest cases, forget, stats',
    run(args) {
      const [action, ...rest] = args;
      const usage = Object.values(USAGE).join('\n       delomu ');
      if (!Object.hasOwn(sub, action ?? '')) throw new Error(`usage: delomu ${usage}`);
      const libraryDir = need(flag(rest, '--library'), USAGE[action]);
      return sub[action](rest, libraryDir);
    },
  },
];
