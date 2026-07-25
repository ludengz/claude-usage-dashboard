import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseLogDirectory } from './parser.js';
import { filterByDateRange } from './aggregator.js';
import { calculateRecordCost } from './pricing.js';
import { sanitizeMachineName } from './sync.js';

const MAX_HISTORY = 52;
const CYCLE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Normalize a cycle's resets_at to hour precision for use as a dedup key.
 * The API returns varying sub-second precision across calls and machines,
 * so raw strings cannot be used for grouping.
 */
function cyclePeriodKey(cycle) {
  // Round to the NEAREST hour, not down to it. Flooring split a cycle in two
  // whenever the API's jitter straddled an hour boundary: 03:59:59 floors to
  // hour 3 and 04:00:00 to hour 4, one second apart but two different keys.
  // Epoch arithmetic rounds in UTC by construction, so this is also immune to
  // the half-hour-offset timezones (UTC+5:30 etc.) that would break dedup
  // between machines if we rounded in local time.
  const HOUR_MS = 60 * 60 * 1000;
  const t = new Date(cycle.resets_at).getTime();
  return new Date(Math.round(t / HOUR_MS) * HOUR_MS).toISOString();
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
 * Strip figures that only the quota API can supply. Backfilled cycles get their
 * tokens and cost from the logs, but utilization is unrecoverable — the API only
 * ever reports the window that is current when you ask — so anything derived
 * from it must be null rather than a plausible-looking zero.
 */
function withUnknownUtilization(cycleData) {
  const blank = d => ({
    ...d,
    utilization: null,
    projectedTokensAt100: null,
    projectedCostAt100: null,
  });
  return {
    overall: blank(cycleData.overall),
    models: {
      opus: blank(cycleData.models.opus),
      sonnet: blank(cycleData.models.sonnet),
    },
  };
}

/**
 * Synthesize the cycles that elapsed between the last observed cycle and the one
 * now current.
 *
 * History is otherwise built purely by observation: each update archives only
 * the single cycle it was tracking, so every cycle that rolled over while the
 * dashboard was down — or while quota fetches were failing — left a permanent
 * hole no later run could fill.
 *
 * Boundaries are walked BACKWARD from the newly observed reset. The reset time
 * drifts (one real gap spanned 50.21 days, or 7.17 nominal cycles), so anchoring
 * on the newest known value keeps recent boundaries exact and pushes the
 * residual onto the oldest synthesized cycle, whose start is clamped to the
 * previous cycle's reset so the two cannot double-count records. A residual
 * shorter than half a cycle is absorbed rather than emitted as its own stub.
 */
function synthesizeGapCycles(previousCycle, newResetsAt, allRecords) {
  const prevEnd = new Date(previousCycle.resets_at).getTime();
  const ends = [];
  let cappedOut = false;

  for (let end = newResetsAt.getTime() - CYCLE_MS; end - prevEnd > CYCLE_MS / 2; end -= CYCLE_MS) {
    if (ends.length >= MAX_HISTORY) {
      cappedOut = true;
      break;
    }
    ends.push(end);
  }

  return ends.map((end, i) => {
    // Start the oldest emitted cycle at the previous reset so the residual — the
    // sub-half-cycle remainder the loop stops before emitting — is absorbed
    // rather than orphaned. A 50.21-day gap walks back to an oldest end 8.21
    // days past prevEnd; without this its start would sit at prevEnd + 1.21
    // days and that window's usage would vanish. Skipped when the cap cut the
    // walk short, since the oldest emitted cycle is then nowhere near prevEnd.
    const absorbsResidual = i === ends.length - 1 && !cappedOut;
    const startIso = new Date(absorbsResidual ? prevEnd : end - CYCLE_MS).toISOString();
    const endIso = new Date(end).toISOString();
    const records = filterByDateRange(allRecords, startIso, endIso);
    return {
      resets_at: endIso,
      start: startIso,
      lastUpdated: new Date().toISOString(),
      backfilled: true,
      ...withUnknownUtilization(computeCycleData(records, {})),
    };
  });
}

/**
 * Fill gaps that already exist between stored history entries.
 *
 * synthesizeGapCycles only covers the span between the cycle being archived and
 * the one becoming current, so holes sitting between two older entries — the
 * ones a long outage already left behind — are never looked at. This walks the
 * stored timeline and repairs them, which is what makes existing snapshots heal
 * rather than merely stop getting worse.
 *
 * Cheap once healed: a gapless timeline reads no records at all.
 */
function backfillHistoryGaps(history, allRecords) {
  const sorted = [...history].sort((a, b) => new Date(b.resets_at) - new Date(a.resets_at));
  const filled = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    filled.push(...synthesizeGapCycles(sorted[i + 1], new Date(sorted[i].resets_at), allRecords));
  }
  return filled;
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
  // Same sanitization as sync.js — raw names with ':' or '/' fail on Windows
  // and would split the snapshot identity from the sync-dir identity.
  const filePath = path.join(dir, `quota-cycles-${sanitizeMachineName(machineName)}.json`);

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

  // Dedupe on every write, not just on a cycle switch, so snapshots already
  // carrying duplicates from the old hour-floored key heal themselves.
  snapshot.history = deduplicateHistory(snapshot.history || []);

  // Compare normalized period keys to detect actual cycle boundary changes.
  // Uses hour-precision keys to tolerate varying sub-second timestamps from the API.
  const allRecords = parseLogDirectory(logBaseDir);

  const storedKey = snapshot.currentCycle ? cyclePeriodKey(snapshot.currentCycle) : null;
  const newKey = cyclePeriodKey({ resets_at: resetsAt });
  if (snapshot.currentCycle && storedKey !== newKey) {
    snapshot.history.unshift(snapshot.currentCycle);
    for (const gap of synthesizeGapCycles(snapshot.currentCycle, rawResetsAt, allRecords)) {
      snapshot.history.unshift(gap);
    }
    snapshot.history = deduplicateHistory(snapshot.history);
    snapshot.currentCycle = null;
  }

  // Repair holes an earlier outage already left between stored entries, then
  // trim. Runs on every write, but costs nothing once the timeline is gapless.
  snapshot.history = deduplicateHistory(
    snapshot.history.concat(backfillHistoryGaps(snapshot.history, allRecords))
  );
  if (snapshot.history.length > MAX_HISTORY) {
    snapshot.history = snapshot.history.slice(0, MAX_HISTORY);
  }

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

  // Write atomically — other machines read this file from the shared mount.
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2));
  fs.renameSync(tmpPath, filePath);
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

  // Utilization exists only in the quota API's answer, and a backfilled entry
  // has none. Its lastUpdated is the moment of synthesis, so it always wins a
  // recency contest and would discard a real observation another machine
  // recorded for the same period. Take API-only metrics from an observed entry
  // whenever one exists, regardless of timestamps.
  const observed = cycles.filter(c => !c.backfilled);
  const utilSource = observed.length
    ? observed.reduce((a, b) => (new Date(a.lastUpdated) > new Date(b.lastUpdated) ? a : b))
    : mostRecent;

  return {
    resets_at: mostRecent.resets_at,
    start: mostRecent.start,
    lastUpdated: mostRecent.lastUpdated,
    ...(observed.length === 0 ? { backfilled: true } : {}),
    overall: mergeMetrics(cycles.map(c => c.overall), utilSource.overall?.utilization ?? null),
    models: {
      opus: mergeMetrics(cycles.map(c => c.models.opus), utilSource.models?.opus?.utilization ?? null),
      sonnet: mergeMetrics(cycles.map(c => c.models.sonnet), utilSource.models?.sonnet?.utilization ?? null),
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
