// Okapi BM25 ranking over short documents, with no dependencies. Used by the library's search and
// suggest. Tokens are lower-cased Unicode letter/digit runs; a short stop-word list keeps filler words
// from dominating short test-case texts.

const STOP = new Set(('a an and are as at be but by can do does for from has have how i if in is it its me my no not ' +
  'of on or our so that the their them then there they this to was we what when which who will with you your').split(' '));

export function tokenize(text) {
  return (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(t => t.length > 1 && !STOP.has(t));
}

// docs: [{ id, text }]. Returns [{ id, score, terms }] for documents that match at least one query term,
// best first; ties keep the input order so results are deterministic.
export function rank(docs, query, { k1 = 1.2, b = 0.75 } = {}) {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !docs.length) return [];
  const tokenized = docs.map(d => tokenize(d.text));
  const avgLen = tokenized.reduce((s, t) => s + t.length, 0) / docs.length || 1;

  const df = new Map(terms.map(t => [t, 0]));
  const tfs = tokenized.map(tokens => {
    const tf = new Map();
    for (const t of tokens) if (df.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const t of tf.keys()) df.set(t, df.get(t) + 1);
    return tf;
  });

  const n = docs.length;
  const idf = t => Math.log(1 + (n - df.get(t) + 0.5) / (df.get(t) + 0.5));
  const scored = [];
  tfs.forEach((tf, i) => {
    if (!tf.size) return;
    const norm = k1 * (1 - b + b * (tokenized[i].length / avgLen));
    let score = 0;
    for (const [t, f] of tf) score += idf(t) * (f * (k1 + 1)) / (f + norm);
    scored.push({ id: docs[i].id, score, terms: [...tf.keys()], order: i });
  });
  return scored.sort((x, y) => y.score - x.score || x.order - y.order).map(({ order, ...rest }) => rest);
}
