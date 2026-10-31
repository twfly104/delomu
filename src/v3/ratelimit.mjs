// Per-credential token bucket, in memory. Good enough for one server process; a multi-replica install
// would put this in a shared store. capacity requests burst, refilled at refillPerSec.

export function createRateLimiter({ capacity = 120, refillPerSec = 2, now = () => Date.now() } = {}) {
  if (!(capacity > 0) || !(refillPerSec > 0)) throw new Error('rate limit capacity and refillPerSec must be positive');
  const buckets = new Map();

  // Returns { ok: true } or { ok: false, retryAfterSec }.
  return function take(id) {
    const t = now();
    const b = buckets.get(id) ?? { tokens: capacity, at: t };
    b.tokens = Math.min(capacity, b.tokens + ((t - b.at) / 1000) * refillPerSec);
    b.at = t;
    buckets.set(id, b);
    if (b.tokens < 1) return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / refillPerSec) };
    b.tokens -= 1;
    return { ok: true };
  };
}
