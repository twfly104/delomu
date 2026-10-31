// v4 deployment knowledge library: the public interface from CONTRACT.md. Every consented deployment
// adds de-identified test cases, integration templates and failure patterns; later deployments search
// them and receive suggestions as drafts an engineer reviews.

import { rank } from './bm25.mjs';
import { readEntries, entryText, KINDS } from './store.mjs';
import { checkLimit } from './suggest.mjs';

export { scrub } from './scrub.mjs';
export { harvest } from './harvest.mjs';
export { suggest } from './suggest.mjs';
export { forget, stats } from './store.mjs';

// search(libraryDir, query, { limit, kind, tags, industry }) -> entries with a `score`, best first.
export function search(libraryDir, query, { limit, kind, tags = [], industry } = {}) {
  if (typeof query !== 'string' || !query.trim()) throw new Error('search needs a query');
  if (kind !== undefined && !KINDS.includes(kind)) throw new Error(`kind must be one of: ${KINDS.join(', ')}`);
  if (!Array.isArray(tags)) throw new Error('tags must be an array');
  const max = checkLimit(limit);
  const wanted = tags.map(t => String(t).toLowerCase());
  const pool = readEntries(libraryDir).filter(e =>
    (!kind || e.kind === kind)
    && (!industry || e.industry === String(industry).toLowerCase())
    && wanted.every(t => (e.tags ?? []).includes(t)));
  const byId = new Map(pool.map(e => [e.id, e]));
  return rank(pool.map(e => ({ id: e.id, text: entryText(e) })), query)
    .slice(0, max)
    .map(hit => ({ ...byId.get(hit.id), score: hit.score }));
}
