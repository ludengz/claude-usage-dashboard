import { getAccessToken } from './credentials.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

export function createQuotaFetcher(options = {}) {
  const CACHE_TTL = options.cacheTtlMs || 120_000;
  const getToken = options.getAccessToken || getAccessToken;
  let cached = null;
  let lastFetched = 0;
  let fetchInProgress = null;

  async function fetchQuota() {
    const now = Date.now();
    if (cached && (now - lastFetched) < CACHE_TTL) return cached;
    if (fetchInProgress) return fetchInProgress;

    const inflight = (async () => {
      try {
        const token = getToken();
        if (!token) return cached || { available: false, error: 'no_credentials' };

        const res = await fetch(USAGE_URL, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
          },
        });

        if (!res.ok) {
          if (res.status === 429) return cached || { available: false, error: 'rate_limited' };
          return cached || { available: false, error: `http_${res.status}` };
        }

        const data = await res.json();
        cached = { available: true, ...data, lastFetched: new Date().toISOString() };
        lastFetched = Date.now();
        return cached;
      } catch (err) {
        return cached || { available: false, error: err.message };
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
