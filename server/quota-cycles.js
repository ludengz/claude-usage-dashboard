import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseLogDirectory } from './parser.js';
import { filterByDateRange } from './aggregator.js';
import { calculateRecordCost } from './pricing.js';

const MAX_HISTORY = 52;

/**
 * Pure computation: given records (already filtered to a cycle) and quota data,
 * compute actual tokens/cost and project at 100% utilization.
 */
export function computeCycleData(records, quotaData) {
  const overallUtil = quotaData.seven_day?.utilization || 0;
  const opusUtil = quotaData.seven_day_opus?.utilization || 0;
  const sonnetUtil = quotaData.seven_day_sonnet?.utilization || 0;

  let totalTokens = 0, totalCost = 0;
  let opusTokens = 0, opusCost = 0;
  let sonnetTokens = 0, sonnetCost = 0;

  for (const r of records) {
    const tokens = r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_creation_tokens;
    const cost = calculateRecordCost(r);
    totalTokens += tokens;
    totalCost += cost;

    if (r.model?.includes('opus')) {
      opusTokens += tokens;
      opusCost += cost;
    } else if (r.model?.includes('sonnet')) {
      sonnetTokens += tokens;
      sonnetCost += cost;
    }
  }

  totalCost = Math.round(totalCost * 100) / 100;
  opusCost = Math.round(opusCost * 100) / 100;
  sonnetCost = Math.round(sonnetCost * 100) / 100;

  function project(actual, utilization) {
    if (utilization <= 0) return null;
    return Math.round(actual / (utilization / 100));
  }

  function projectCost(actual, utilization) {
    if (utilization <= 0) return null;
    return Math.round((actual / (utilization / 100)) * 100) / 100;
  }

  return {
    overall: {
      utilization: overallUtil,
      actualTokens: totalTokens,
      projectedTokensAt100: project(totalTokens, overallUtil),
      actualCost: totalCost,
      projectedCostAt100: projectCost(totalCost, overallUtil),
    },
    models: {
      opus: {
        utilization: opusUtil,
        actualTokens: opusTokens,
        projectedTokensAt100: project(opusTokens, opusUtil),
        actualCost: opusCost,
        projectedCostAt100: projectCost(opusCost, opusUtil),
      },
      sonnet: {
        utilization: sonnetUtil,
        actualTokens: sonnetTokens,
        projectedTokensAt100: project(sonnetTokens, sonnetUtil),
        actualCost: sonnetCost,
        projectedCostAt100: projectCost(sonnetCost, sonnetUtil),
      },
    },
  };
}

export function updateQuotaCycleSnapshot(quotaData, logBaseDir, machineName, snapshotDir) {
  if (!quotaData?.available || !quotaData.seven_day?.resets_at) return;

  const dir = snapshotDir || path.join(os.homedir(), '.claude');
  const filePath = path.join(dir, `quota-cycles-${machineName}.json`);

  const resetsAt = quotaData.seven_day.resets_at;
  const start = new Date(new Date(resetsAt).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    snapshot = { schemaVersion: 1, machineName, currentCycle: null, history: [] };
  }

  if (snapshot.currentCycle && snapshot.currentCycle.resets_at !== resetsAt) {
    snapshot.history.unshift(snapshot.currentCycle);
    if (snapshot.history.length > MAX_HISTORY) {
      snapshot.history = snapshot.history.slice(0, MAX_HISTORY);
    }
    snapshot.currentCycle = null;
  }

  const allRecords = parseLogDirectory(logBaseDir);
  const cycleRecords = filterByDateRange(allRecords, start, resetsAt);
  const cycleData = computeCycleData(cycleRecords, quotaData);

  snapshot.currentCycle = {
    resets_at: resetsAt,
    start,
    lastUpdated: new Date().toISOString(),
    ...cycleData,
  };

  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
}

export function loadQuotaCycles(machineName, syncDir, snapshotDir) {
  const dir = snapshotDir || syncDir || path.join(os.homedir(), '.claude');
  const empty = { currentCycle: null, history: [], machines: [] };

  let files;
  try {
    files = fs.readdirSync(dir).filter(f => f.startsWith('quota-cycles-') && f.endsWith('.json'));
  } catch {
    return empty;
  }

  if (files.length === 0) return empty;

  const snapshots = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      if (data.schemaVersion === 1) snapshots.push(data);
    } catch { /* skip corrupt files */ }
  }

  if (snapshots.length === 0) return empty;

  const machines = snapshots.map(s => s.machineName);

  if (snapshots.length === 1) {
    const s = snapshots[0];
    return { currentCycle: s.currentCycle, history: s.history, machines };
  }

  return {
    currentCycle: mergeCycles(snapshots.map(s => s.currentCycle).filter(Boolean)),
    history: mergeHistories(snapshots.map(s => s.history)),
    machines,
  };
}

function mergeCycles(cycles) {
  if (cycles.length === 0) return null;
  if (cycles.length === 1) return cycles[0];

  const byReset = new Map();
  for (const c of cycles) {
    const key = c.resets_at;
    if (!byReset.has(key)) byReset.set(key, []);
    byReset.get(key).push(c);
  }

  let bestKey = null, bestCount = 0;
  for (const [key, arr] of byReset) {
    if (arr.length > bestCount) { bestKey = key; bestCount = arr.length; }
  }

  const sameCycle = byReset.get(bestKey);
  return mergeSamePeriodCycles(sameCycle);
}

function mergeSamePeriodCycles(cycles) {
  const mostRecent = cycles.reduce((a, b) =>
    new Date(a.lastUpdated) > new Date(b.lastUpdated) ? a : b
  );

  return {
    resets_at: mostRecent.resets_at,
    start: mostRecent.start,
    lastUpdated: mostRecent.lastUpdated,
    overall: mergeMetrics(cycles.map(c => c.overall), mostRecent.overall.utilization),
    models: {
      opus: mergeMetrics(cycles.map(c => c.models.opus), mostRecent.models?.opus?.utilization || 0),
      sonnet: mergeMetrics(cycles.map(c => c.models.sonnet), mostRecent.models?.sonnet?.utilization || 0),
    },
  };
}

function mergeMetrics(metricsArray, utilization) {
  const totalTokens = metricsArray.reduce((sum, m) => sum + (m?.actualTokens || 0), 0);
  const totalCost = Math.round(metricsArray.reduce((sum, m) => sum + (m?.actualCost || 0), 0) * 100) / 100;

  return {
    utilization,
    actualTokens: totalTokens,
    projectedTokensAt100: utilization > 0 ? Math.round(totalTokens / (utilization / 100)) : null,
    actualCost: totalCost,
    projectedCostAt100: utilization > 0 ? Math.round((totalCost / (utilization / 100)) * 100) / 100 : null,
  };
}

function mergeHistories(historyArrays) {
  const byReset = new Map();
  for (const history of historyArrays) {
    for (const entry of history) {
      const key = entry.resets_at;
      if (!byReset.has(key)) byReset.set(key, []);
      byReset.get(key).push(entry);
    }
  }

  const merged = [];
  for (const [, entries] of byReset) {
    merged.push(mergeSamePeriodCycles(entries));
  }

  merged.sort((a, b) => new Date(b.resets_at) - new Date(a.resets_at));
  return merged.slice(0, MAX_HISTORY);
}
