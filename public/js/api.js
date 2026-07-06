const BASE = '/api';

function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return entries.length ? '?' + new URLSearchParams(entries).toString() : '';
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

export async function fetchUsage(params = {}) { return getJSON(`${BASE}/usage${qs(params)}`); }
export async function fetchModels(params = {}) { return getJSON(`${BASE}/models${qs(params)}`); }
export async function fetchProjects(params = {}) { return getJSON(`${BASE}/projects${qs(params)}`); }
export async function fetchSessions(params = {}) { return getJSON(`${BASE}/sessions${qs(params)}`); }
export async function fetchCost(params = {}) { return getJSON(`${BASE}/cost${qs(params)}`); }
export async function fetchCache(params = {}) { return getJSON(`${BASE}/cache${qs(params)}`); }
export async function fetchStatus() { return getJSON(`${BASE}/status`); }
export async function fetchQuota() { return getJSON(`${BASE}/quota`); }
export async function fetchSubscription() { return getJSON(`${BASE}/subscription`); }
export async function fetchQuotaCycles() { return getJSON(`${BASE}/quota-cycles`); }
