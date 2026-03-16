const BASE = '/api';

function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return entries.length ? '?' + new URLSearchParams(entries).toString() : '';
}

export async function fetchUsage(params = {}) { return (await fetch(`${BASE}/usage${qs(params)}`)).json(); }
export async function fetchModels(params = {}) { return (await fetch(`${BASE}/models${qs(params)}`)).json(); }
export async function fetchProjects(params = {}) { return (await fetch(`${BASE}/projects${qs(params)}`)).json(); }
export async function fetchSessions(params = {}) { return (await fetch(`${BASE}/sessions${qs(params)}`)).json(); }
export async function fetchCost(params = {}) { return (await fetch(`${BASE}/cost${qs(params)}`)).json(); }
export async function fetchCache(params = {}) { return (await fetch(`${BASE}/cache${qs(params)}`)).json(); }
