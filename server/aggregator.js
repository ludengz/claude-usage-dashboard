import { calculateRecordCost, getModelPricing } from './pricing.js';

export function filterByDateRange(records, from, to) {
  if (!from && !to) return records;
  // Support both date-only (YYYY-MM-DD → local time boundaries) and full ISO timestamps
  const start = from
    ? new Date(from.includes('T') ? from : from + 'T00:00:00.000').getTime()
    : -Infinity;
  const end = to
    ? new Date(to.includes('T') ? to : to + 'T23:59:59.999').getTime()
    : Infinity;
  return records.filter(r => {
    const t = new Date(r.timestamp).getTime();
    return t >= start && t <= end;
  });
}

export function autoGranularity(from, to) {
  if (!from || !to) return 'daily';
  const days = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24);
  if (days <= 2) return 'hourly';
  if (days <= 14) return 'daily';
  if (days <= 60) return 'weekly';
  return 'monthly';
}

function pad(n) { return String(n).padStart(2, '0'); }

function localDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function bucketKey(timestamp, granularity) {
  const d = new Date(timestamp);
  switch (granularity) {
    case 'hourly':
      return `${localDateStr(d)}T${pad(d.getHours())}:00`;
    case 'daily':
      return localDateStr(d);
    case 'weekly': {
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      return localDateStr(monday);
    }
    case 'monthly':
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    default:
      return localDateStr(d);
  }
}

export function aggregateByTime(records, granularity) {
  const map = new Map();
  for (const r of records) {
    const key = bucketKey(r.timestamp, granularity);
    if (!map.has(key)) {
      map.set(key, { time: key, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, estimated_cost_usd: 0, models: {} });
    }
    const b = map.get(key);
    b.input_tokens += r.input_tokens;
    b.output_tokens += r.output_tokens;
    b.cache_read_tokens += r.cache_read_tokens;
    b.cache_creation_tokens += r.cache_creation_tokens;
    b.estimated_cost_usd += calculateRecordCost(r);
    if (!b.models[r.model]) b.models[r.model] = { input: 0, output: 0 };
    b.models[r.model].input += r.input_tokens;
    b.models[r.model].output += r.output_tokens;
  }
  return Array.from(map.values()).map(b => {
    b.estimated_cost_usd = Math.round(b.estimated_cost_usd * 100) / 100;
    return b;
  }).sort((a, b) => a.time.localeCompare(b.time));
}

export function aggregateBySession(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.sessionId)) {
      map.set(r.sessionId, { sessionId: r.sessionId, project: r.project, models: new Set(), input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, startTime: r.timestamp, endTime: r.timestamp, cost: 0 });
    }
    const s = map.get(r.sessionId);
    s.models.add(r.model);
    s.input_tokens += r.input_tokens;
    s.output_tokens += r.output_tokens;
    s.cache_read_tokens += r.cache_read_tokens;
    s.cache_creation_tokens += r.cache_creation_tokens;
    s.cost += calculateRecordCost(r);
    if (r.timestamp < s.startTime) s.startTime = r.timestamp;
    if (r.timestamp > s.endTime) s.endTime = r.timestamp;
  }
  return Array.from(map.values()).map(s => ({
    sessionId: s.sessionId, project: s.project, models: Array.from(s.models),
    input_tokens: s.input_tokens, output_tokens: s.output_tokens,
    cache_read_tokens: s.cache_read_tokens, cache_creation_tokens: s.cache_creation_tokens,
    total_tokens: s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_creation_tokens,
    startTime: s.startTime, endTime: s.endTime,
    duration_minutes: Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000),
    estimated_cost_usd: Math.round(s.cost * 100) / 100,
  }));
}

export function aggregateByProject(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.project)) {
      map.set(r.project, { name: r.project, projectDirName: r.projectDirName, total_input_tokens: 0, total_output_tokens: 0, total_cache_read: 0, total_cache_creation: 0, sessions: new Set(), cost: 0 });
    }
    const p = map.get(r.project);
    p.total_input_tokens += r.input_tokens;
    p.total_output_tokens += r.output_tokens;
    p.total_cache_read += r.cache_read_tokens;
    p.total_cache_creation += r.cache_creation_tokens;
    p.sessions.add(r.sessionId);
    p.cost += calculateRecordCost(r);
  }
  return Array.from(map.values()).map(p => {
    const path = p.projectDirName ? '/' + p.projectDirName.replace(/^-/, '').replace(/-/g, '/') : '';
    return { name: p.name, path, total_input_tokens: p.total_input_tokens, total_output_tokens: p.total_output_tokens, cache_read_tokens: p.total_cache_read, cache_creation_tokens: p.total_cache_creation, total_tokens: p.total_input_tokens + p.total_output_tokens + p.total_cache_read + p.total_cache_creation, estimated_cost_usd: Math.round(p.cost * 100) / 100, session_count: p.sessions.size };
  }).sort((a, b) => b.total_tokens - a.total_tokens);
}

export function aggregateByModel(records) {
  const map = new Map();
  for (const r of records) {
    if (!map.has(r.model)) map.set(r.model, { id: r.model, total_tokens: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 });
    const m = map.get(r.model);
    m.input_tokens += r.input_tokens;
    m.output_tokens += r.output_tokens;
    m.cache_read_tokens += r.cache_read_tokens;
    m.cache_creation_tokens += r.cache_creation_tokens;
    m.total_tokens += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens;
  }
  return Array.from(map.values()).map(m => {
    const pricing = getModelPricing(m.id);
    return { id: m.id, total_tokens: m.total_tokens, input_tokens: m.input_tokens, output_tokens: m.output_tokens, ...(pricing || {}) };
  }).sort((a, b) => b.total_tokens - a.total_tokens);
}

export function aggregateCache(records) {
  let nonCached = 0, cacheRead = 0, cacheCreation = 0;
  for (const r of records) { nonCached += r.input_tokens; cacheRead += r.cache_read_tokens; cacheCreation += r.cache_creation_tokens; }
  const allInput = nonCached + cacheRead + cacheCreation;
  return {
    cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreation,
    non_cached_input_tokens: nonCached, total_input_tokens: allInput,
    cache_read_rate: allInput > 0 ? Math.round((cacheRead / allInput) * 100) / 100 : 0,
    cache_creation_rate: allInput > 0 ? Math.round((cacheCreation / allInput) * 100) / 100 : 0,
    no_cache_rate: allInput > 0 ? Math.round((nonCached / allInput) * 100) / 100 : 0,
  };
}
