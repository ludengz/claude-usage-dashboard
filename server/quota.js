import { getAccessToken } from './credentials.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export function createQuotaFetcher(options = {}) {
  // Must comfortably exceed the frontend's quota poll interval (120s, see
  // app.js) or the cache expires just as the next poll arrives and every poll
  // reaches upstream, with the cache only ever deduping across browser tabs.
  const CACHE_TTL = options.cacheTtlMs || 300_000;
  const BACKOFF_BASE = options.backoffBaseMs || 60_000;
  const BACKOFF_MAX = options.backoffMaxMs || 900_000;
  const getToken = options.getAccessToken || getAccessToken;
  let cached = null;
  let lastFetched = 0;
  let fetchInProgress = null;
  let backoffUntil = 0;
  let consecutiveFailures = 0;
  let lastFailure = null;

  /**
   * Record a failed attempt and open a backoff window before the next one.
   *
   * Without this, a failure left both `cached` and `lastFetched` untouched, so
   * the TTL gate below (which needs a truthy `cached`) never engaged and every
   * subsequent request re-hit upstream. Being rate limited therefore removed
   * the only thing throttling us — the worse it got, the harder we retried.
   */
  function noteFailure(result, retryAfterMs = 0) {
    consecutiveFailures++;
    const grown = Math.min(BACKOFF_BASE * 2 ** (consecutiveFailures - 1), BACKOFF_MAX);
    backoffUntil = Date.now() + Math.max(grown, retryAfterMs);
    lastFailure = result;
    // Stale data beats an error message, so prefer the cache when we have one.
    return cached || result;
  }

  // Upstream sometimes sends `retry-after: 0`, which is not a usable delay —
  // fall back to our own schedule rather than retrying immediately.
  function retryAfterMs(res) {
    const raw = res.headers?.get?.('retry-after');
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  }

  async function fetchQuota() {
    const now = Date.now();
    if (cached && (now - lastFetched) < CACHE_TTL) return cached;
    if (now < backoffUntil) return cached || lastFailure;
    if (fetchInProgress) return fetchInProgress;

    const inflight = (async () => {
      try {
        // Not an upstream failure, so no backoff: the user may log in at any
        // moment and a backoff window would delay noticing by minutes.
        const token = getToken();
        if (!token) return cached || { available: false, error: 'no_credentials' };

        const res = await fetch(USAGE_URL, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
          },
        });

        if (!res.ok) {
          // Authentication failures are not a "slow down" signal, and the
          // backoff check runs before getToken(), so backing off here would
          // stop us re-reading credentials that the user or Claude may renew at
          // any moment — leaving the gauge stale for up to the cap.
          if (res.status === 401 || res.status === 403) {
            return cached || { available: false, error: `http_${res.status}` };
          }
          const error = res.status === 429 ? 'rate_limited' : `http_${res.status}`;
          return noteFailure({ available: false, error }, retryAfterMs(res));
        }

        const data = await res.json();
        cached = { available: true, ...data, lastFetched: new Date().toISOString() };
        lastFetched = Date.now();
        consecutiveFailures = 0;
        backoffUntil = 0;
        lastFailure = null;
        return cached;
      } catch (err) {
        return noteFailure({ available: false, error: err.message });
      }
    })();

    // Clear the in-flight slot only after the assignment below. A `finally`
    // inside the IIFE runs BEFORE this assignment when the body completes
    // synchronously (e.g. no token), permanently wedging fetchInProgress on
    // an already-settled promise and freezing /quota until restart.
    fetchInProgress = inflight;
    inflight.finally(() => {
      if (fetchInProgress === inflight) fetchInProgress = null;
    });

    return inflight;
  }

  return { fetchQuota };
}
