/**
 * Stale-while-revalidate in-memory cache (industry-standard dashboard pattern).
 *
 * - Fresh window: serve cached data, no background work.
 * - Stale window: return cached immediately, refresh in background.
 * - Beyond stale max: block until fresh fetch completes.
 *
 * Writes (PATCH, move, upload) should call invalidate() so the next read is fresh.
 */

/** @typedef {'HIT-FRESH' | 'HIT-STALE' | 'MISS' | 'MISS-WAIT'} CacheStatus */

/**
 * @param {object} [opts]
 * @param {number} [opts.freshMs] — serve without revalidation (default 8s)
 * @param {number} [opts.staleMaxMs] — max age before forced refresh (default 45s)
 * @param {string} [opts.name] — log label
 */
export function createResponseCache(opts = {}) {
  const freshMs = Math.max(0, opts.freshMs ?? 8000);
  const staleMaxMs = Math.max(freshMs, opts.staleMaxMs ?? 45000);
  const name = opts.name || 'cache';
  /** @type {Map<string, { data: unknown, at: number }>} */
  const store = new Map();
  /** @type {Map<string, Promise<unknown>>} */
  const inflight = new Map();

  function invalidate(key) {
    if (key == null || key === '') {
      store.clear();
      return;
    }
    store.delete(String(key));
  }

  function invalidateMatching(prefix) {
    const p = String(prefix);
    for (const key of store.keys()) {
      if (key.startsWith(p)) store.delete(key);
    }
  }

  /**
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fetchFn
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<{ data: T, cacheStatus: CacheStatus }>}
   */
  async function get(key, fetchFn, { force = false } = {}) {
    const now = Date.now();
    const entry = store.get(key);

    if (force) {
      store.delete(key);
    }

    if (!force && entry) {
      const age = now - entry.at;
      if (age < freshMs) {
        return { data: /** @type {T} */ (entry.data), cacheStatus: 'HIT-FRESH' };
      }
      if (age < staleMaxMs) {
        if (!inflight.has(key)) {
          const p = fetchFn()
            .then((data) => {
              store.set(key, { data, at: Date.now() });
              return data;
            })
            .catch((err) => {
              console.warn(`[${name}] background revalidate failed for ${key}:`, err.message || err);
              throw err;
            })
            .finally(() => inflight.delete(key));
          inflight.set(key, p);
        }
        return { data: /** @type {T} */ (entry.data), cacheStatus: 'HIT-STALE' };
      }
    }

    if (inflight.has(key)) {
      const data = await /** @type {Promise<T>} */ (inflight.get(key));
      return { data, cacheStatus: 'MISS-WAIT' };
    }

    const p = fetchFn()
      .then((data) => {
        store.set(key, { data, at: Date.now() });
        return data;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    const data = await p;
    return { data, cacheStatus: 'MISS' };
  }

  function snapshot() {
    return { name, size: store.size, freshMs, staleMaxMs };
  }

  return { get, invalidate, invalidateMatching, snapshot };
}

export function parseCacheMs(envValue, fallback) {
  const n = parseInt(String(envValue ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/** Express helper — SWR-friendly HTTP cache headers for JSON APIs. */
export function setApiCacheHeaders(res, cacheStatus, freshMs) {
  const swr = Math.max(1, Math.ceil(freshMs / 1000));
  res.setHeader('X-Cache-Status', cacheStatus);
  res.setHeader('Cache-Control', `private, max-age=0, stale-while-revalidate=${swr}`);
}
