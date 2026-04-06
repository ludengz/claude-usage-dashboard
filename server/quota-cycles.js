import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseLogDirectory } from './parser.js';
import { filterByDateRange } from './aggregator.js';
import { calculateRecordCost } from './pricing.js';

const MAX_HISTORY = 52;

/**
 * Normalize a cycle's resets_at to hour precision for use as a dedup key.
 * The API returns varying sub-second precision across calls and machines,
 * so raw strings cannot be used for grouping.
 */
function cyclePeriodKey(cycle) {
  const d = new Date(cycle.resets_at);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * Deduplicate history entries that represent the same quota cycle period.
 * Keeps the entry with the latest lastUpdated for each period.
 */
function deduplicateHistory(history) {
  const byKey = new Map();
  for (const entry of history) {
    const key = cyclePeriodKey(entry);
    const existing = byKey.get(key);
    if (!existing || new Date(entry.lastUpdated) > new Date(existing.lastUpdated)) {
      byKey.set(key, entry);
    }
  }
  const result = Array.from(byKey.values());
  result.sort((a, b) => new Date(b.resets_at) - new Date(a.resets_at));
  return result;
}

/**
 * Pure computation: given records (already filtered to a cycle) and quota data,
 * compute actual tokens/cost and project at 100% utilization.
 */
export function computeCycleData(records, quotaData) {
  const overallUtil = quotaData.seven_day?.utilization || 0;
  const opusUtil = quotaData.seven_day_opus?.utilization || 0;
  const sonnetUtil = quotaData.seven_day_sonnet?.utilization || 0;

  // Per-type accumulators
  let inTok = 0, outTok = 0, crTok = 0, cwTok = 0, totalCost = 0;
  let opusIn = 0, opusOut = 0, opusCR = 0, opusCW = 0, opusCost = 0;
  let sonIn = 0, sonOut = 0, sonCR = 0, sonCW = 0, sonnetCost = 0;

  for (const r of records) {
    const cost = calculateRecordCost(r);
    inTok += r.input_tokens; outTok += r.output_tokens;
    crTok += r.cache_read_tokens; cwTok += r.cache_creation_tokens;
    totalCost += cost;

    if (r.model?.includes('opus')) {
      opusIn += r.input_tokens; opusOut += r.output_tokens;
      opusCR += r.cache_read_tokens; opusCW += r.cache_creation_tokens;
      opusCost += cost;
    } else if (r.model?.includes('sonnet')) {
      sonIn += r.input_tokens; sonOut += r.output_tokens;
      sonCR += r.cache_read_tokens; sonCW += r.cache_creation_tokens;
      sonnetCost += cost;
    }
  }

  totalCost = Math.round(totalCost * 100) / 100;
  opusCost = Math.round(opusCost * 100) / 100;
  sonnetCost = Math.round(sonnetCost * 100) / 100;

  function buildTokens(inp, out, cr, cw) {
    return { input: inp, output: out, cacheRead: cr, cacheCreation: cw };
  }

  function project(actual, utilization) {
    if (utilization <= 0) return null;
    return Math.round(actual / (utilization / 100));
  }

  function projectCost(actual, utilization) {
    if (utilization <= 0) return null;
    return Math.round((actual / (utilization / 100)) * 100) / 100;
  }

  // actualTokens = total excluding cache reads (in + out + cw) — used for projections
  const totalExclCR = inTok + outTok + cwTok;
  const opusExclCR = opusIn + opusOut + opusCW;
  const sonExclCR = sonIn + sonOut + sonCW;

  return {
    overall: {
      utilization: overallUtil,
      tokens: buildTokens(inTok, outTok, crTok, cwTok),
      actualTokens: totalExclCR,
      projectedTokensAt100: project(totalExclCR, overallUtil),
      actualCost: totalCost,
      projectedCostAt100: projectCost(totalCost, overallUtil),
    },
    models: {
      opus: {
        utilization: opusUtil,
        tokens: buildTokens(opusIn, opusOut, opusCR, opusCW),
        actualTokens: opusExclCR,
        projectedTokensAt100: project(opusExclCR, opusUtil),
        actualCost: opusCost,
        projectedCostAt100: projectCost(opusCost, opusUtil),
      },
      sonnet: {
        utilization: sonnetUtil,
        tokens: buildTokens(sonIn, sonOut, sonCR, sonCW),
        actualTokens: sonExclCR,
        projectedTokensAt100: project(sonExclCR, sonnetUtil),
        actualCost: sonnetCost,
        projectedCostAt100: projectCost(sonnetCost, sonnetUtil),
      },
    },
  };
}

/**
 * Update the quota cycle snapshot file for this machine.
 * Called after each successful quota API fetch.
 *
 * @param {object} quotaData - Quota API response (must have available === true)
 * @param {string} logBaseDir - This machine's log directory (~/.claude/projects/)
 * @param {string} machineName - Identifier for this machine
 * @param {string} [snapshotDir] - Directory for snapshot files (defaults to syncDir or ~/.claude/)
 * @param {string} [syncDir] - Shared sync directory; used as fallback when snapshotDir is not set
 */
export function updateQuotaCycleSnapshot(quotaData, logBaseDir, machineName, snapshotDir, syncDir) {
  if (!quotaData?.available || !quotaData.seven_day?.resets_at) return;

  const dir = snapshotDir || syncDir || path.join(os.homedir(), '.claude');
  const filePath = path.join(dir, `quota-cycles-${machineName}.json`);

  // Normalize resets_at to second precision — the API returns varying microseconds
  // on each call (e.g. .905316 vs .581788) which would cause false cycle switches
  const rawResetsAt = new Date(quotaData.seven_day.resets_at);
  rawResetsAt.setMilliseconds(0);
  const resetsAt = rawResetsAt.toISOString();
  const start = new Date(rawResetsAt.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    snapshot = { schemaVersion: 1, machineName, currentCycle: null, history: [] };
  }

  // Compare normalized period keys to detect actual cycle boundary changes.
  // Uses hour-precision keys to tolerate varying sub-second timestamps from the API.
  const storedKey = snapshot.currentCycle ? cyclePeriodKey(snapshot.currentCycle) : null;
  const newKey = cyclePeriodKey({ resets_at: resetsAt });
  if (snapshot.currentCycle && storedKey !== newKey) {
    snapshot.history.unshift(snapshot.currentCycle);
    snapshot.history = deduplicateHistory(snapshot.history);
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

  // Remove stale history entries for the current cycle's period — these are
  // artifacts from past false cycle-switch detections on this same machine.
  const currentKey = cyclePeriodKey(snapshot.currentCycle);
  snapshot.history = snapshot.history.filter(h => cyclePeriodKey(h) !== currentKey);

  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
}

/**
 * Load and merge quota cycle data from all machines.
 *
 * @param {string} machineName - This machine's name
 * @param {string|null} syncDir - Shared sync directory (null if single-machine)
 * @param {string} [snapshotDir] - Directory for snapshot files (defaults to ~/.claude/)
 * @returns {{ currentCycle: object|null, history: object[], machines: string[] }}
 */
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
    // Single machine: duplicates are time-series snapshots of the same data,
    // so dedup (keep most recent) and filter out current-cycle overlap.
    const s = snapshots[0];
    let history = deduplicateHistory(s.history);
    if (s.currentCycle) {
      const currentKey = cyclePeriodKey(s.currentCycle);
      history = history.filter(h => cyclePeriodKey(h) !== currentKey);
    }
    return { currentCycle: s.currentCycle, history, machines };
  }

  // Multi-machine: dedup within each machine first (removes false-switch
  // duplicates), then merge across machines (sums different machines' data).
  const dedupedHistories = snapshots.map(s => deduplicateHistory(s.history));
  let currentCycle = mergeCycles(snapshots.map(s => s.currentCycle).filter(Boolean));
  let history = mergeHistories(dedupedHistories);

  // If history contains entries for the current cycle's period (e.g. from an
  // offline machine whose cycle was archived), merge them INTO the current
  // cycle instead of dropping them.
  if (currentCycle) {
    const currentKey = cyclePeriodKey(currentCycle);
    const overlapping = history.filter(h => cyclePeriodKey(h) === currentKey);
    history = history.filter(h => cyclePeriodKey(h) !== currentKey);
    if (overlapping.length > 0) {
      currentCycle = mergeSamePeriodCycles([currentCycle, ...overlapping]);
    }
  }

  return { currentCycle, history, machines };
}

function mergeCycles(cycles) {
  if (cycles.length === 0) return null;
  if (cycles.length === 1) return cycles[0];

  const byPeriod = new Map();
  for (const c of cycles) {
    const key = cyclePeriodKey(c);
    if (!byPeriod.has(key)) byPeriod.set(key, []);
    byPeriod.get(key).push(c);
  }

  let bestKey = null, bestCount = 0;
  for (const [key, arr] of byPeriod) {
    if (arr.length > bestCount || (arr.length === bestCount && key > bestKey)) { bestKey = key; bestCount = arr.length; }
  }

  const sameCycle = byPeriod.get(bestKey);
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

  // Merge per-type token breakdown
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const m of metricsArray) {
    if (m?.tokens) {
      tokens.input += m.tokens.input || 0;
      tokens.output += m.tokens.output || 0;
      tokens.cacheRead += m.tokens.cacheRead || 0;
      tokens.cacheCreation += m.tokens.cacheCreation || 0;
    }
  }

  return {
    utilization,
    tokens,
    actualTokens: totalTokens,
    projectedTokensAt100: utilization > 0 ? Math.round(totalTokens / (utilization / 100)) : null,
    actualCost: totalCost,
    projectedCostAt100: utilization > 0 ? Math.round((totalCost / (utilization / 100)) * 100) / 100 : null,
  };
}

function mergeHistories(historyArrays) {
  const byPeriod = new Map();
  for (const history of historyArrays) {
    for (const entry of history) {
      const key = cyclePeriodKey(entry);
      if (!byPeriod.has(key)) byPeriod.set(key, []);
      byPeriod.get(key).push(entry);
    }
  }

  const merged = [];
  for (const [, entries] of byPeriod) {
    merged.push(mergeSamePeriodCycles(entries));
  }

  merged.sort((a, b) => new Date(b.resets_at) - new Date(a.resets_at));
  return merged.slice(0, MAX_HISTORY);
}
