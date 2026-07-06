# Quota Cycle Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track per-7-day-cycle token usage and project "100% utilization" token/cost estimates, persisting cycle history so users can compare across periods and detect quota changes.

**Architecture:** New `server/quota-cycles.js` module handles snapshot persistence and multi-machine merge. Hooks into existing `/api/quota` fetch flow to update snapshots every ~120s. New `/api/quota-cycles` endpoint serves merged data. Frontend adds projection cards + D3 bar chart + history table below the existing quota gauges.

**Tech Stack:** Node.js (ES modules), Express 5, D3 v7, Mocha + Chai (tests)

**Spec:** `docs/superpowers/specs/2026-03-29-quota-cycle-tracking-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/quota-cycles.js` | Create | Snapshot read/write, cycle detection, multi-machine merge, projection calculation |
| `test/quota-cycles.test.js` | Create | Unit tests for all quota-cycles.js functions |
| `server/routes/api.js` | Modify | Add `/api/quota-cycles` endpoint; hook snapshot update into `/api/quota` handler |
| `public/js/api.js` | Modify | Add `fetchQuotaCycles()` wrapper |
| `public/index.html` | Modify | Add DOM containers for projection cards + history section |
| `public/js/charts/quota-cycles.js` | Create | D3 bar chart + history table rendering |
| `public/js/app.js` | Modify | Import and call quota-cycles chart, integrate into `loadAll()`/`loadQuota()` flow |
| `public/css/style.css` | Modify | Add styles for projection cards and quota-cycles table |

---

### Task 1: Core Module — `server/quota-cycles.js` Tests

**Files:**
- Create: `test/quota-cycles.test.js`

- [ ] **Step 1: Write tests for `computeCycleData` (pure computation)**

```js
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeCycleData, updateQuotaCycleSnapshot, loadQuotaCycles } from '../server/quota-cycles.js';

describe('computeCycleData', () => {
  it('computes overall and per-model token/cost totals with projections', () => {
    const records = [
      { model: 'claude-opus-4-6', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200, cache_creation_tokens: 100 },
      { model: 'claude-sonnet-4-6', input_tokens: 2000, output_tokens: 800, cache_read_tokens: 300, cache_creation_tokens: 150 },
      { model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 400, cache_read_tokens: 100, cache_creation_tokens: 50 },
    ];
    const quotaData = {
      seven_day: { utilization: 50, resets_at: '2026-04-05T00:00:00Z' },
      seven_day_opus: { utilization: 30 },
      seven_day_sonnet: { utilization: 60 },
    };
    const result = computeCycleData(records, quotaData);

    // Overall: 1000+2000+1000=4000 in, 500+800+400=1700 out, 200+300+100=600 cread, 100+150+50=300 ccreate
    // Total tokens = 4000+1700+600+300 = 6600
    expect(result.overall.actualTokens).to.equal(6600);
    expect(result.overall.utilization).to.equal(50);
    // projectedTokensAt100 = 6600 / (50/100) = 13200
    expect(result.overall.projectedTokensAt100).to.equal(13200);
    expect(result.overall.actualCost).to.be.a('number');
    expect(result.overall.projectedCostAt100).to.be.a('number');

    // Opus: 1000+500+200+100 = 1800 tokens
    expect(result.models.opus.actualTokens).to.equal(1800);
    expect(result.models.opus.utilization).to.equal(30);
    expect(result.models.opus.projectedTokensAt100).to.equal(6000); // 1800 / 0.3

    // Sonnet: 3000+1200+400+200 = 4800 tokens
    expect(result.models.sonnet.actualTokens).to.equal(4800);
    expect(result.models.sonnet.utilization).to.equal(60);
    expect(result.models.sonnet.projectedTokensAt100).to.equal(8000); // 4800 / 0.6
  });

  it('sets projections to null when utilization is 0', () => {
    const records = [
      { model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0 },
    ];
    const quotaData = {
      seven_day: { utilization: 0, resets_at: '2026-04-05T00:00:00Z' },
      seven_day_sonnet: { utilization: 0 },
    };
    const result = computeCycleData(records, quotaData);
    expect(result.overall.projectedTokensAt100).to.be.null;
    expect(result.overall.projectedCostAt100).to.be.null;
    expect(result.models.sonnet.projectedTokensAt100).to.be.null;
  });

  it('includes haiku tokens in overall but not in models', () => {
    const records = [
      { model: 'claude-haiku-4-5', input_tokens: 5000, output_tokens: 2000, cache_read_tokens: 500, cache_creation_tokens: 200 },
    ];
    const quotaData = {
      seven_day: { utilization: 40, resets_at: '2026-04-05T00:00:00Z' },
    };
    const result = computeCycleData(records, quotaData);
    expect(result.overall.actualTokens).to.equal(7700);
    expect(result.models.opus.actualTokens).to.equal(0);
    expect(result.models.sonnet.actualTokens).to.equal(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/quota-cycles.test.js --timeout 5000`
Expected: FAIL — `computeCycleData` is not exported / module not found

- [ ] **Step 3: Commit**

```bash
git add test/quota-cycles.test.js
git commit -m "test: add computeCycleData unit tests for quota cycle tracking"
```

---

### Task 2: Core Module — `computeCycleData` Implementation

**Files:**
- Create: `server/quota-cycles.js`

- [ ] **Step 1: Implement `computeCycleData`**

```js
import { calculateRecordCost } from './pricing.js';

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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx mocha test/quota-cycles.test.js --timeout 5000`
Expected: All 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/quota-cycles.js
git commit -m "feat: add computeCycleData for quota cycle token projections"
```

---

### Task 3: Snapshot Persistence — Tests

**Files:**
- Modify: `test/quota-cycles.test.js`

- [ ] **Step 1: Add tests for `updateQuotaCycleSnapshot` and `loadQuotaCycles`**

Append to `test/quota-cycles.test.js`:

```js
describe('updateQuotaCycleSnapshot', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function makeLogDir(records) {
    const projectDir = path.join(tmpDir, 'logs', '-Users-test-Workspace-myproject');
    fs.mkdirSync(projectDir, { recursive: true });
    const lines = records.map(r => JSON.stringify({
      type: 'assistant',
      sessionId: 's1',
      timestamp: r.timestamp,
      message: {
        model: r.model,
        usage: {
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          cache_creation_input_tokens: r.cache_creation_tokens,
          cache_read_input_tokens: r.cache_read_tokens,
        },
      },
    }));
    fs.writeFileSync(path.join(projectDir, 'session.jsonl'), lines.join('\n'));
    return path.join(tmpDir, 'logs');
  }

  it('creates snapshot file on first run', () => {
    const logDir = makeLogDir([
      { timestamp: '2026-03-30T10:00:00Z', model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 100, cache_creation_tokens: 50 },
    ]);
    const quotaData = {
      available: true,
      seven_day: { utilization: 40, resets_at: '2026-04-05T00:00:00Z' },
      seven_day_sonnet: { utilization: 40 },
    };
    updateQuotaCycleSnapshot(quotaData, logDir, 'test-machine', tmpDir);

    const filePath = path.join(tmpDir, 'quota-cycles-test-machine.json');
    expect(fs.existsSync(filePath)).to.be.true;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(data.schemaVersion).to.equal(1);
    expect(data.machineName).to.equal('test-machine');
    expect(data.currentCycle.resets_at).to.equal('2026-04-05T00:00:00Z');
    expect(data.currentCycle.overall.actualTokens).to.equal(1650);
    expect(data.history).to.have.length(0);
  });

  it('detects cycle switch and archives old cycle to history', () => {
    const logDir = makeLogDir([
      { timestamp: '2026-04-06T10:00:00Z', model: 'claude-sonnet-4-6', input_tokens: 500, output_tokens: 200, cache_read_tokens: 50, cache_creation_tokens: 25 },
    ]);

    // First: write a snapshot with old resets_at
    const oldSnapshot = {
      schemaVersion: 1,
      machineName: 'test-machine',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z',
        start: '2026-03-29T00:00:00Z',
        lastUpdated: '2026-04-04T23:00:00Z',
        overall: { utilization: 80, actualTokens: 20000, projectedTokensAt100: 25000, actualCost: 15.00, projectedCostAt100: 18.75 },
        models: {
          opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null },
          sonnet: { utilization: 80, actualTokens: 20000, projectedTokensAt100: 25000, actualCost: 15.00, projectedCostAt100: 18.75 },
        },
      },
      history: [],
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), JSON.stringify(oldSnapshot));

    // Now update with new resets_at (cycle switched)
    const quotaData = {
      available: true,
      seven_day: { utilization: 10, resets_at: '2026-04-12T00:00:00Z' },
      seven_day_sonnet: { utilization: 10 },
    };
    updateQuotaCycleSnapshot(quotaData, logDir, 'test-machine', tmpDir);

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), 'utf-8'));
    expect(data.currentCycle.resets_at).to.equal('2026-04-12T00:00:00Z');
    expect(data.history).to.have.length(1);
    expect(data.history[0].resets_at).to.equal('2026-04-05T00:00:00Z');
    expect(data.history[0].overall.actualTokens).to.equal(20000);
  });

  it('caps history at 52 entries', () => {
    const logDir = makeLogDir([]);
    const oldSnapshot = {
      schemaVersion: 1,
      machineName: 'test-machine',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z',
        start: '2026-03-29T00:00:00Z',
        lastUpdated: '2026-04-04T23:00:00Z',
        overall: { utilization: 50, actualTokens: 1000, projectedTokensAt100: 2000, actualCost: 1.00, projectedCostAt100: 2.00 },
        models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
      },
      history: Array.from({ length: 52 }, (_, i) => ({
        resets_at: `2025-0${(i % 9) + 1}-01T00:00:00Z`,
        start: `2025-0${(i % 9) + 1}-01T00:00:00Z`,
        overall: { utilization: 50, actualTokens: 1000, projectedTokensAt100: 2000, actualCost: 1.00, projectedCostAt100: 2.00 },
        models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
      })),
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), JSON.stringify(oldSnapshot));

    const quotaData = {
      available: true,
      seven_day: { utilization: 5, resets_at: '2026-04-12T00:00:00Z' },
    };
    updateQuotaCycleSnapshot(quotaData, logDir, 'test-machine', tmpDir);

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), 'utf-8'));
    expect(data.history).to.have.length(52);
  });
});

describe('loadQuotaCycles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-load-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty data when no snapshot exists', () => {
    const result = loadQuotaCycles('test-machine', null, tmpDir);
    expect(result.currentCycle).to.be.null;
    expect(result.history).to.have.length(0);
    expect(result.machines).to.have.length(0);
  });

  it('merges multiple machine files by summing tokens', () => {
    const machine1 = {
      schemaVersion: 1, machineName: 'laptop',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T10:00:00Z',
        overall: { utilization: 50, actualTokens: 10000, projectedTokensAt100: 20000, actualCost: 5.00, projectedCostAt100: 10.00 },
        models: {
          opus: { utilization: 30, actualTokens: 3000, projectedTokensAt100: 10000, actualCost: 3.00, projectedCostAt100: 10.00 },
          sonnet: { utilization: 60, actualTokens: 7000, projectedTokensAt100: 11667, actualCost: 2.00, projectedCostAt100: 3.33 },
        },
      },
      history: [],
    };
    const machine2 = {
      schemaVersion: 1, machineName: 'desktop',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T12:00:00Z',
        overall: { utilization: 50, actualTokens: 5000, projectedTokensAt100: 10000, actualCost: 2.50, projectedCostAt100: 5.00 },
        models: {
          opus: { utilization: 30, actualTokens: 1000, projectedTokensAt100: 3333, actualCost: 1.00, projectedCostAt100: 3.33 },
          sonnet: { utilization: 60, actualTokens: 4000, projectedTokensAt100: 6667, actualCost: 1.50, projectedCostAt100: 2.50 },
        },
      },
      history: [],
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-laptop.json'), JSON.stringify(machine1));
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-desktop.json'), JSON.stringify(machine2));

    const result = loadQuotaCycles('laptop', tmpDir, tmpDir);
    expect(result.machines).to.include.members(['laptop', 'desktop']);
    // Summed: 10000 + 5000 = 15000 actual tokens
    expect(result.currentCycle.overall.actualTokens).to.equal(15000);
    // Re-projected: 15000 / 0.5 = 30000
    expect(result.currentCycle.overall.projectedTokensAt100).to.equal(30000);
    // Utilization from most recent machine (desktop, lastUpdated 12:00)
    expect(result.currentCycle.overall.utilization).to.equal(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx mocha test/quota-cycles.test.js --timeout 5000`
Expected: FAIL — `updateQuotaCycleSnapshot` and `loadQuotaCycles` not yet implemented

- [ ] **Step 3: Commit**

```bash
git add test/quota-cycles.test.js
git commit -m "test: add snapshot persistence and multi-machine merge tests"
```

---

### Task 4: Snapshot Persistence — Implementation

**Files:**
- Modify: `server/quota-cycles.js`

- [ ] **Step 1: Implement `updateQuotaCycleSnapshot`**

Add to `server/quota-cycles.js`, after the existing `computeCycleData` function:

```js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseLogDirectory } from './parser.js';
import { filterByDateRange } from './aggregator.js';

const MAX_HISTORY = 52;

/**
 * Update the quota cycle snapshot file for this machine.
 * Called after each successful quota API fetch.
 *
 * @param {object} quotaData - Quota API response (must have available === true)
 * @param {string} logBaseDir - This machine's log directory (~/.claude/projects/)
 * @param {string} machineName - Identifier for this machine
 * @param {string} [snapshotDir] - Directory for snapshot files (defaults to ~/.claude/)
 */
export function updateQuotaCycleSnapshot(quotaData, logBaseDir, machineName, snapshotDir) {
  if (!quotaData?.available || !quotaData.seven_day?.resets_at) return;

  const dir = snapshotDir || path.join(os.homedir(), '.claude');
  const filePath = path.join(dir, `quota-cycles-${machineName}.json`);

  const resetsAt = quotaData.seven_day.resets_at;
  const start = new Date(new Date(resetsAt).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Read existing snapshot
  let snapshot;
  try {
    snapshot = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    snapshot = { schemaVersion: 1, machineName, currentCycle: null, history: [] };
  }

  // Detect cycle switch
  if (snapshot.currentCycle && snapshot.currentCycle.resets_at !== resetsAt) {
    snapshot.history.unshift(snapshot.currentCycle);
    if (snapshot.history.length > MAX_HISTORY) {
      snapshot.history = snapshot.history.slice(0, MAX_HISTORY);
    }
    snapshot.currentCycle = null;
  }

  // Parse this machine's local records only (avoids double-counting with sync)
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
```

- [ ] **Step 2: Implement `loadQuotaCycles`**

Add to `server/quota-cycles.js`:

```js
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
    const s = snapshots[0];
    return { currentCycle: s.currentCycle, history: s.history, machines };
  }

  // Multi-machine merge
  return {
    currentCycle: mergeCycles(snapshots.map(s => s.currentCycle).filter(Boolean)),
    history: mergeHistories(snapshots.map(s => s.history)),
    machines,
  };
}

function mergeCycles(cycles) {
  if (cycles.length === 0) return null;
  if (cycles.length === 1) return cycles[0];

  // Group by resets_at — only merge cycles from the same period
  const byReset = new Map();
  for (const c of cycles) {
    const key = c.resets_at;
    if (!byReset.has(key)) byReset.set(key, []);
    byReset.get(key).push(c);
  }

  // Use the most common (or most recent) resets_at
  let bestKey = null, bestCount = 0;
  for (const [key, arr] of byReset) {
    if (arr.length > bestCount) { bestKey = key; bestCount = arr.length; }
  }

  const sameCycle = byReset.get(bestKey);
  return mergeSamePeriodCycles(sameCycle);
}

function mergeSamePeriodCycles(cycles) {
  // Use utilization from the most recently updated machine
  const mostRecent = cycles.reduce((a, b) =>
    new Date(a.lastUpdated) > new Date(b.lastUpdated) ? a : b
  );

  const merged = {
    resets_at: mostRecent.resets_at,
    start: mostRecent.start,
    lastUpdated: mostRecent.lastUpdated,
    overall: mergeMetrics(cycles.map(c => c.overall), mostRecent.overall.utilization),
    models: {
      opus: mergeMetrics(cycles.map(c => c.models.opus), mostRecent.models?.opus?.utilization || 0),
      sonnet: mergeMetrics(cycles.map(c => c.models.sonnet), mostRecent.models?.sonnet?.utilization || 0),
    },
  };
  return merged;
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
  // Collect all history entries, group by resets_at, merge each group
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

  // Sort newest first
  merged.sort((a, b) => new Date(b.resets_at) - new Date(a.resets_at));
  return merged.slice(0, MAX_HISTORY);
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx mocha test/quota-cycles.test.js --timeout 5000`
Expected: All 7 tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/quota-cycles.js test/quota-cycles.test.js
git commit -m "feat: implement quota cycle snapshot persistence and multi-machine merge"
```

---

### Task 5: API Integration

**Files:**
- Modify: `server/routes/api.js`
- Modify: `test/quota-cycles.test.js` (add API endpoint test)

- [ ] **Step 1: Add API endpoint test**

Add these imports to the top of `test/quota-cycles.test.js` (alongside existing imports):

```js
import express from 'express';
import { createApiRouter } from '../server/routes/api.js';
```

Then append the test:

```js
describe('GET /api/quota-cycles (integration)', () => {
  let apiApp, apiServer, baseUrl, tmpDir, logDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-api-'));
    logDir = path.join(tmpDir, 'logs');
    const projectDir = path.join(logDir, '-Users-test-Workspace-testproject');
    fs.mkdirSync(projectDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 } } }),
    ];
    fs.writeFileSync(path.join(projectDir, 'session.jsonl'), lines.join('\n'));

    // Pre-seed a snapshot
    const snapshot = {
      schemaVersion: 1, machineName: 'test',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T12:00:00Z',
        overall: { utilization: 50, actualTokens: 10000, projectedTokensAt100: 20000, actualCost: 5.00, projectedCostAt100: 10.00 },
        models: {
          opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null },
          sonnet: { utilization: 50, actualTokens: 10000, projectedTokensAt100: 20000, actualCost: 5.00, projectedCostAt100: 10.00 },
        },
      },
      history: [{
        resets_at: '2026-03-29T00:00:00Z', start: '2026-03-22T00:00:00Z',
        overall: { utilization: 80, actualTokens: 30000, projectedTokensAt100: 37500, actualCost: 15.00, projectedCostAt100: 18.75 },
        models: {
          opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null },
          sonnet: { utilization: 80, actualTokens: 30000, projectedTokensAt100: 37500, actualCost: 15.00, projectedCostAt100: 18.75 },
        },
      }],
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-test.json'), JSON.stringify(snapshot));

    apiApp = express();
    apiApp.use('/api', createApiRouter(logDir, {
      cacheTtlMs: 500,
      machineName: 'test',
      snapshotDir: tmpDir,
    }));
    await new Promise((resolve) => {
      apiServer = apiApp.listen(0, () => { baseUrl = `http://localhost:${apiServer.address().port}`; resolve(); });
    });
  });

  after(async () => {
    await new Promise((resolve) => apiServer.close(resolve));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns current cycle and history', async () => {
    const res = await fetch(`${baseUrl}/api/quota-cycles`);
    const data = await res.json();
    expect(res.status).to.equal(200);
    expect(data.currentCycle).to.be.an('object');
    expect(data.currentCycle.resets_at).to.equal('2026-04-05T00:00:00Z');
    expect(data.currentCycle.overall.actualTokens).to.equal(10000);
    expect(data.history).to.have.length(1);
    expect(data.machines).to.include('test');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha test/quota-cycles.test.js --timeout 5000`
Expected: FAIL — `/api/quota-cycles` endpoint does not exist

- [ ] **Step 3: Add `/api/quota-cycles` endpoint and snapshot hook to `server/routes/api.js`**

In `server/routes/api.js`, add import at the top (after existing imports):

```js
import { updateQuotaCycleSnapshot, loadQuotaCycles } from '../quota-cycles.js';
```

Add the `/api/quota-cycles` endpoint before the `return router;` line:

```js
  router.get('/quota-cycles', (req, res) => {
    try {
      const data = loadQuotaCycles(
        options.machineName || os.hostname(),
        options.syncDir || null,
        options.snapshotDir
      );
      // Add daysElapsed/daysTotal to currentCycle for frontend convenience
      if (data.currentCycle) {
        const start = new Date(data.currentCycle.start);
        const now = new Date();
        data.currentCycle.daysElapsed = Math.round(((now - start) / (1000 * 60 * 60 * 24)) * 10) / 10;
        data.currentCycle.daysTotal = 7;
      }
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

Add `import os from 'os';` at the top of the file.

Modify the existing `/api/quota` handler to hook snapshot update. Replace the handler:

```js
  router.get('/quota', async (req, res) => {
    try {
      const data = await quotaFetcher.fetchQuota();
      // Update quota cycle snapshot on successful fetch
      if (data.available) {
        try {
          updateQuotaCycleSnapshot(
            data,
            logBaseDir,
            options.machineName || os.hostname(),
            options.snapshotDir
          );
        } catch (err) {
          console.warn('Failed to update quota cycle snapshot:', err.message);
        }
      }
      res.json(data);
    } catch (err) {
      res.json({ available: false, error: err.message });
    }
  });
```

- [ ] **Step 4: Run all tests**

Run: `npx mocha test/quota-cycles.test.js --timeout 5000`
Expected: All tests PASS

Run: `npm test`
Expected: All existing tests still PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/api.js test/quota-cycles.test.js
git commit -m "feat: add /api/quota-cycles endpoint and snapshot update hook"
```

---

### Task 6: Frontend — API Wrapper + HTML Structure

**Files:**
- Modify: `public/js/api.js`
- Modify: `public/index.html`
- Modify: `public/css/style.css`

- [ ] **Step 1: Add `fetchQuotaCycles` to `public/js/api.js`**

Append to the file:

```js
export async function fetchQuotaCycles() { return (await fetch(`${BASE}/quota-cycles`)).json(); }
```

- [ ] **Step 2: Add DOM containers to `public/index.html`**

Insert after the closing `</section>` of the `#quota-section` (after line 51):

```html
  <section class="chart-section" id="quota-cycles-section">
    <div class="chart-header">
      <h2>Quota Cycle History</h2>
      <div class="granularity-toggle" id="cycle-model-toggle">
        <button data-cycle-model="overall" class="active">Overall</button>
        <button data-cycle-model="opus">Opus</button>
        <button data-cycle-model="sonnet">Sonnet</button>
      </div>
    </div>
    <div class="cycle-projection-cards" id="cycle-projection-cards"></div>
    <div id="chart-quota-cycles" class="chart-container"></div>
    <div id="quota-cycles-table" class="table-container"></div>
  </section>
```

- [ ] **Step 3: Add styles to `public/css/style.css`**

Append:

```css
.cycle-projection-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}
.cycle-projection-cards .card {
  text-align: center;
}
.cycle-projection-cards .card-value {
  color: var(--amber);
}
.cycle-projection-cards .card-sub {
  color: var(--text-muted);
}
.delta-positive { color: var(--green); }
.delta-negative { color: var(--red); }

#quota-cycles-section .chart-container { min-height: 250px; }

@media (max-width: 768px) {
  .cycle-projection-cards { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Commit**

```bash
git add public/js/api.js public/index.html public/css/style.css
git commit -m "feat: add quota cycles frontend structure (API wrapper, HTML, CSS)"
```

---

### Task 7: Frontend — D3 Chart + Table Component

**Files:**
- Create: `public/js/charts/quota-cycles.js`

- [ ] **Step 1: Implement the chart and table renderer**

```js
const fmt = (n) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
};

const fmtCost = (n) => n == null ? '—' : `$${n.toFixed(2)}`;

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function getModelData(cycle, modelKey) {
  if (modelKey === 'overall') return cycle.overall;
  return cycle.models?.[modelKey] || { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null };
}

export function renderQuotaCycles(container, data, { modelKey = 'overall' } = {}) {
  if (!container) return;

  // --- Projection Cards ---
  const cardsEl = document.getElementById('cycle-projection-cards');
  if (cardsEl) {
    cardsEl.innerHTML = '';
    if (data.currentCycle) {
      const items = [
        { label: 'Total at 100%', key: 'overall' },
        { label: 'Opus at 100%', key: 'opus' },
        { label: 'Sonnet at 100%', key: 'sonnet' },
      ];
      for (const item of items) {
        const d = getModelData(data.currentCycle, item.key);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="card-label">${item.label}</div>
          <div class="card-value">${fmt(d.projectedTokensAt100)}</div>
          <div class="card-sub">actual: ${fmt(d.actualTokens)}</div>
        `;
        cardsEl.appendChild(card);
      }
    }
  }

  // --- Bar Chart ---
  container.innerHTML = '';

  const allCycles = [];
  if (data.history) allCycles.push(...[...data.history].reverse());
  if (data.currentCycle) allCycles.push(data.currentCycle);

  if (allCycles.length === 0) {
    container.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px;font-size:13px">No cycle data yet. Data will accumulate as the dashboard runs.</div>';
    return;
  }

  const chartData = allCycles.map(c => {
    const d = getModelData(c, modelKey);
    return {
      label: `${fmtDate(c.start)} – ${fmtDate(c.resets_at)}`,
      actual: d.actualTokens,
      projected: d.projectedTokensAt100,
      isCurrent: c === data.currentCycle,
    };
  });

  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = 220;

  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x0 = d3.scaleBand().domain(chartData.map(d => d.label)).range([0, width]).padding(0.3);
  const maxVal = d3.max(chartData, d => Math.max(d.actual, d.projected || 0)) || 1;
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([height, 0]);

  // Axes
  svg.append('g').attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x0).tickSize(0))
    .selectAll('text').attr('fill', '#94a3b8').style('font-size', '10px');
  svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d => fmt(d)))
    .selectAll('text').attr('fill', '#94a3b8').style('font-size', '10px');
  svg.selectAll('.domain, .tick line').attr('stroke', '#334155');

  const barWidth = x0.bandwidth() / 2.5;

  // Projected bars (behind, semi-transparent)
  svg.selectAll('.bar-projected').data(chartData.filter(d => d.projected != null))
    .join('rect').attr('class', 'bar-projected')
    .attr('x', d => x0(d.label) + x0.bandwidth() / 2 - barWidth)
    .attr('width', barWidth * 2)
    .attr('y', d => y(d.projected))
    .attr('height', d => height - y(d.projected))
    .attr('fill', '#f59e0b').attr('opacity', 0.2)
    .attr('rx', 3);

  // Actual bars (front)
  svg.selectAll('.bar-actual').data(chartData)
    .join('rect').attr('class', 'bar-actual')
    .attr('x', d => x0(d.label) + x0.bandwidth() / 2 - barWidth / 2)
    .attr('width', barWidth)
    .attr('y', d => y(d.actual))
    .attr('height', d => height - y(d.actual))
    .attr('fill', d => d.isCurrent ? '#3b82f6' : '#60a5fa')
    .attr('rx', 3);

  // Legend
  const legend = svg.append('g').attr('transform', `translate(${width - 180}, -5)`);
  legend.append('rect').attr('width', 10).attr('height', 10).attr('fill', '#60a5fa').attr('rx', 2);
  legend.append('text').attr('x', 14).attr('y', 9).text('Actual').attr('fill', '#94a3b8').style('font-size', '10px');
  legend.append('rect').attr('x', 70).attr('width', 10).attr('height', 10).attr('fill', '#f59e0b').attr('opacity', 0.4).attr('rx', 2);
  legend.append('text').attr('x', 84).attr('y', 9).text('Projected').attr('fill', '#94a3b8').style('font-size', '10px');

  // --- History Table ---
  const tableEl = document.getElementById('quota-cycles-table');
  if (!tableEl) return;
  tableEl.innerHTML = '';

  if (allCycles.length === 0) return;

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>Cycle</th>
    <th class="align-right">Utilization</th>
    <th class="align-right">Actual Tokens</th>
    <th class="align-right">Projected at 100%</th>
    <th class="align-right">Actual Cost</th>
    <th class="align-right">Projected Cost</th>
    <th class="align-right">\u0394 vs Prev</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  // Display newest first
  const displayCycles = [...allCycles].reverse();
  for (let i = 0; i < displayCycles.length; i++) {
    const c = displayCycles[i];
    const d = getModelData(c, modelKey);
    const prev = displayCycles[i + 1] ? getModelData(displayCycles[i + 1], modelKey) : null;

    let deltaStr = '—';
    let deltaClass = '';
    if (prev && prev.projectedTokensAt100 != null && d.projectedTokensAt100 != null && prev.projectedTokensAt100 > 0) {
      const delta = ((d.projectedTokensAt100 - prev.projectedTokensAt100) / prev.projectedTokensAt100) * 100;
      deltaStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
      deltaClass = delta >= 0 ? 'delta-positive' : 'delta-negative';
    }

    const isCurrent = c === data.currentCycle;
    const label = `${fmtDate(c.start)} – ${fmtDate(c.resets_at)}${isCurrent ? ' *' : ''}`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td class="align-right">${d.utilization.toFixed(1)}%</td>
      <td class="align-right">${fmt(d.actualTokens)}</td>
      <td class="align-right">${fmt(d.projectedTokensAt100)}</td>
      <td class="align-right">${fmtCost(d.actualCost)}</td>
      <td class="align-right">${fmtCost(d.projectedCostAt100)}</td>
      <td class="align-right ${deltaClass}">${deltaStr}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableEl.appendChild(table);
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/charts/quota-cycles.js
git commit -m "feat: add quota cycles D3 bar chart and history table component"
```

---

### Task 8: Frontend — App Integration

**Files:**
- Modify: `public/js/app.js`

- [ ] **Step 1: Add import and state**

At the top of `app.js`, add to the imports:

```js
import { renderQuotaCycles } from './charts/quota-cycles.js';
```

Add to the imports from `api.js`:

```js
import { fetchUsage, fetchModels, fetchProjects, fetchSessions, fetchCost, fetchCache, fetchStatus, fetchQuota, fetchSubscription, fetchQuotaCycles } from './api.js';
```

Add to the `state` object:

```js
  cycleModel: 'overall',
```

- [ ] **Step 2: Add `loadQuotaCycles` function and integrate into `loadQuota`**

Add after the existing `loadQuota` function:

```js
async function loadQuotaCyclesData() {
  try {
    const data = await fetchQuotaCycles();
    renderQuotaCycles(document.getElementById('chart-quota-cycles'), data, {
      modelKey: state.cycleModel,
    });
  } catch { /* silently degrade */ }
}
```

At the end of the `loadQuota` function, add a call to `loadQuotaCyclesData()`:

After the line `} catch { /* silently degrade */ }` that closes `loadQuota`, this won't work — instead, call it inside `loadQuota` at the very end, before the closing catch:

Add `loadQuotaCyclesData();` as the last line inside the `try` block of `loadQuota()` (after the `renderQuotaGauges` call and the `el.textContent` update).

- [ ] **Step 3: Add model toggle handler in `init()`**

Add inside `init()`, before the `fetchSubscription` call:

```js
  document.getElementById('cycle-model-toggle').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      state.cycleModel = e.target.dataset.cycleModel;
      document.querySelectorAll('#cycle-model-toggle button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cycleModel === state.cycleModel);
      });
      loadQuotaCyclesData();
    }
  });
```

- [ ] **Step 4: Verify manually**

Run: `npm start`
Expected: Dashboard loads. Below the quota gauges, the "Quota Cycle History" section appears with:
- Three projection cards (Total/Opus/Sonnet at 100%)
- Overall/Opus/Sonnet toggle buttons
- Bar chart (empty or with data if quota API is available)
- History table

- [ ] **Step 5: Run all tests to ensure no regressions**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add public/js/app.js
git commit -m "feat: integrate quota cycle tracking into dashboard UI"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS (existing + new quota-cycles tests)

- [ ] **Step 2: Manual end-to-end test**

1. Start server: `npm start`
2. Open http://localhost:3000
3. Verify quota cycle section is visible below quota gauges
4. If quota API is configured: projection cards show numbers, chart/table populate after ~120s
5. Click Opus/Sonnet/Overall toggle — chart and table update
6. Check `~/.claude/quota-cycles-*.json` file is created after quota refresh
7. Verify no console errors

- [ ] **Step 3: Commit any fixes**

If any issues found, fix and commit individually.
