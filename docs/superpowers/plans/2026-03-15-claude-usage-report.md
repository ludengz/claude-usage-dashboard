# Claude Usage Report Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app that parses Claude Code session logs and visualizes token usage + cost estimation via interactive D3 charts.

**Architecture:** Express.js backend parses `~/.claude/projects/*/*.jsonl` log files, exposes REST API endpoints for aggregated data. Vanilla JS frontend with D3.js renders an interactive dark-theme dashboard with charts, summary cards, and a session cost table.

**Tech Stack:** Node.js, Express.js, D3.js v7, Vanilla JS (ES modules)

**Spec:** `docs/superpowers/specs/2026-03-15-claude-usage-report-design.md`

---

## File Structure

```
claudeUsageDashboard/
├── package.json
├── server/
│   ├── index.js              # Express entry, static middleware, starts server
│   ├── parser.js             # Scans ~/.claude/projects/*/*.jsonl, extracts records
│   ├── aggregator.js         # Groups/aggregates token data by time granularity
│   ├── pricing.js            # Model pricing table, cost calculation, plan defaults
│   └── routes/
│       └── api.js            # All REST API route handlers
├── public/
│   ├── index.html            # SPA shell with dashboard layout
│   ├── css/
│   │   └── style.css         # Dark theme styles
│   └── js/
│       ├── app.js            # Main controller: init, state, event wiring
│       ├── api.js            # Fetch wrapper for backend API
│       ├── charts/
│       │   ├── token-trend.js
│       │   ├── cost-comparison.js
│       │   ├── model-distribution.js
│       │   ├── project-distribution.js
│       │   ├── session-stats.js
│       │   └── cache-efficiency.js
│       └── components/
│           ├── date-picker.js
│           └── plan-selector.js
└── test/
    ├── parser.test.js
    ├── aggregator.test.js
    ├── pricing.test.js
    └── api.test.js
```

---

## Chunk 1: Project Setup + Log Parser + Pricing

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`

- [ ] **Step 1: Initialize npm project and install dependencies**

```bash
cd /Users/ludengzhao/Workspace/claudeUsageDashboard
npm init -y
npm install express d3
npm install --save-dev mocha chai
```

- [ ] **Step 2: Configure package.json scripts**

Edit `package.json` to add:
```json
{
  "type": "module",
  "scripts": {
    "start": "node server/index.js",
    "test": "mocha test/**/*.test.js --timeout 5000"
  }
}
```

- [ ] **Step 3: Create directory structure**

```bash
mkdir -p server/routes public/css public/js/charts public/js/components test
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: scaffold project with express and d3 dependencies"
```

---

### Task 2: Log parser (`server/parser.js`)

**Files:**
- Create: `server/parser.js`
- Create: `test/parser.test.js`

- [ ] **Step 1: Write failing tests for parser**

Create `test/parser.test.js`:

```js
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseLogDirectory, parseLogFile, deriveProjectName } from '../server/parser.js';

describe('deriveProjectName', () => {
  it('extracts last segment from encoded directory name', () => {
    expect(deriveProjectName('-Users-ludengzhao-Workspace-passionfruit')).to.equal('passionfruit');
  });

  it('handles project names with hyphens', () => {
    expect(deriveProjectName('-Users-foo-Workspace-my-project')).to.equal('my-project');
  });

  it('handles worktree directory names', () => {
    expect(deriveProjectName('-Users-foo-Workspace-proj--claude-worktrees-branch')).to.equal('proj--claude-worktrees-branch');
  });
});

describe('parseLogFile', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('extracts assistant records with usage data', () => {
    const logFile = path.join(tmpDir, 'test.jsonl');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: '2026-03-10T10:00:00.000Z',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 }
        }
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-1',
        timestamp: '2026-03-10T10:01:00.000Z',
        message: { role: 'user', content: 'hello' }
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: '2026-03-10T10:02:00.000Z',
        message: {
          model: '<synthetic>',
          usage: { input_tokens: 10, output_tokens: 5 }
        }
      })
    ];
    fs.writeFileSync(logFile, lines.join('\n'));

    const records = parseLogFile(logFile);
    expect(records).to.have.length(1);
    expect(records[0].model).to.equal('claude-sonnet-4-6');
    expect(records[0].input_tokens).to.equal(100);
    expect(records[0].output_tokens).to.equal(50);
    expect(records[0].cache_creation_tokens).to.equal(20);
    expect(records[0].cache_read_tokens).to.equal(30);
    expect(records[0].sessionId).to.equal('sess-1');
  });

  it('skips malformed lines without crashing', () => {
    const logFile = path.join(tmpDir, 'bad.jsonl');
    fs.writeFileSync(logFile, 'not json\n{"type":"user"}\n');
    const records = parseLogFile(logFile);
    expect(records).to.have.length(0);
  });
});

describe('parseLogDirectory', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-dir-test-'));
    const projectDir = path.join(tmpDir, '-Users-test-Workspace-myproject');
    fs.mkdirSync(projectDir);
    const logFile = path.join(projectDir, 'session1.jsonl');
    fs.writeFileSync(logFile, JSON.stringify({
      type: 'assistant',
      sessionId: 'sess-1',
      timestamp: '2026-03-10T10:00:00.000Z',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }
    }));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('scans all project directories and returns records with project name', () => {
    const records = parseLogDirectory(tmpDir);
    expect(records).to.have.length(1);
    expect(records[0].project).to.equal('myproject');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: FAIL — `parser.js` does not exist yet.

- [ ] **Step 3: Implement parser**

Create `server/parser.js`:

```js
import fs from 'fs';
import path from 'path';

/**
 * Derive project name from encoded directory name.
 * The directory name encodes the full path with hyphens replacing slashes.
 * e.g. "-Users-ludengzhao-Workspace-passionfruit" → "passionfruit"
 * e.g. "-Users-foo-Workspace-my-project" → "my-project"
 *
 * Strategy: the directory name starts with a pattern like "-Users-<user>-Workspace-"
 * so we find the "Workspace" segment and take everything after it as the project name.
 * Fallback: if "Workspace" is not found, take the last path-like segment.
 */
export function deriveProjectName(dirName) {
  // Remove leading hyphen, split into path segments by looking for
  // uppercase-starting segments as path boundaries
  const clean = dirName.startsWith('-') ? dirName.slice(1) : dirName;

  // Try to find "Workspace" or similar common parent dirs and take the rest
  const workspaceIdx = clean.indexOf('-Workspace-');
  if (workspaceIdx !== -1) {
    return clean.slice(workspaceIdx + '-Workspace-'.length);
  }

  const homeIdx = clean.indexOf('-Home-');
  if (homeIdx !== -1) {
    const rest = clean.slice(homeIdx + '-Home-'.length);
    const slashIdx = rest.indexOf('-');
    return slashIdx === -1 ? rest : rest;
  }

  // Fallback: return everything after the last recognized path separator pattern
  // Look for segments that start with uppercase as directory boundaries
  const parts = clean.split('-');
  return parts[parts.length - 1];
}

/**
 * Parse a single .jsonl log file and return extracted records.
 * Only extracts type:"assistant" records, skips model:"<synthetic>".
 */
export function parseLogFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const records = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // skip malformed lines
    }

    if (entry.type !== 'assistant') continue;

    const model = entry.message?.model;
    if (!model || model === '<synthetic>') continue;

    const usage = entry.message?.usage;
    if (!usage) continue;

    records.push({
      sessionId: entry.sessionId,
      timestamp: entry.timestamp,
      model,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_creation_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_tokens: usage.cache_read_input_tokens || 0,
    });
  }

  return records;
}

/**
 * Parse all .jsonl files in all project subdirectories under baseDir.
 * Returns records with project name attached.
 */
export function parseLogDirectory(baseDir) {
  const allRecords = [];

  let projectDirs;
  try {
    projectDirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
  } catch {
    return allRecords;
  }

  for (const dir of projectDirs) {
    const projectName = deriveProjectName(dir.name);
    const projectPath = path.join(baseDir, dir.name);

    let files;
    try {
      files = fs.readdirSync(projectPath)
        .filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(projectPath, file);
      const records = parseLogFile(filePath);
      for (const record of records) {
        record.project = projectName;
        record.projectDirName = dir.name;
      }
      allRecords.push(...records);
    }
  }

  return allRecords;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/parser.js test/parser.test.js
git commit -m "feat: add log parser for Claude Code session JSONL files"
```

---

### Task 3: Pricing module (`server/pricing.js`)

**Files:**
- Create: `server/pricing.js`
- Create: `test/pricing.test.js`

- [ ] **Step 1: Write failing tests for pricing**

Create `test/pricing.test.js`:

```js
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { MODEL_PRICING, PLAN_DEFAULTS, calculateRecordCost, getModelPricing } from '../server/pricing.js';

describe('MODEL_PRICING', () => {
  it('has pricing for known models', () => {
    expect(MODEL_PRICING['claude-opus-4-6']).to.exist;
    expect(MODEL_PRICING['claude-sonnet-4-6']).to.exist;
    expect(MODEL_PRICING['claude-haiku-4-5']).to.exist;
  });
});

describe('PLAN_DEFAULTS', () => {
  it('has correct subscription prices', () => {
    expect(PLAN_DEFAULTS.pro).to.equal(20);
    expect(PLAN_DEFAULTS.max5x).to.equal(100);
    expect(PLAN_DEFAULTS.max20x).to.equal(200);
  });
});

describe('calculateRecordCost', () => {
  it('calculates cost for a known model', () => {
    const record = {
      model: 'claude-sonnet-4-6',
      input_tokens: 1000000,  // 1M input
      output_tokens: 1000000, // 1M output
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    };
    const cost = calculateRecordCost(record);
    // Sonnet: $3/M input + $15/M output = $18
    expect(cost).to.equal(18);
  });

  it('accounts for cache token pricing', () => {
    const record = {
      model: 'claude-sonnet-4-6',
      input_tokens: 1000000,
      output_tokens: 0,
      cache_read_tokens: 500000,
      cache_creation_tokens: 200000,
    };
    const cost = calculateRecordCost(record);
    // Non-cached input: 1M - 500K - 200K = 300K → 300K * $3/M = $0.90
    // Cache read: 500K * $0.30/M = $0.15
    // Cache creation: 200K * $3.75/M = $0.75
    // Output: 0
    // Total = $1.80
    expect(cost).to.be.closeTo(1.80, 0.01);
  });

  it('returns 0 for unknown model', () => {
    const record = {
      model: 'unknown-model',
      input_tokens: 1000000,
      output_tokens: 1000000,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    };
    const cost = calculateRecordCost(record);
    expect(cost).to.equal(0);
  });
});

describe('getModelPricing', () => {
  it('returns pricing for known model', () => {
    const pricing = getModelPricing('claude-opus-4-6');
    expect(pricing.input_price_per_mtok).to.equal(15);
    expect(pricing.output_price_per_mtok).to.equal(75);
  });

  it('returns null for unknown model', () => {
    expect(getModelPricing('unknown')).to.be.null;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: FAIL — `pricing.js` does not exist yet.

- [ ] **Step 3: Implement pricing module**

Create `server/pricing.js`:

```js
/**
 * Model pricing per million tokens (USD).
 * Source: Anthropic API pricing page.
 */
export const MODEL_PRICING = {
  'claude-opus-4-6': {
    input_price_per_mtok: 15,
    output_price_per_mtok: 75,
    cache_read_price_per_mtok: 1.5,
    cache_creation_price_per_mtok: 18.75,
  },
  'claude-sonnet-4-6': {
    input_price_per_mtok: 3,
    output_price_per_mtok: 15,
    cache_read_price_per_mtok: 0.30,
    cache_creation_price_per_mtok: 3.75,
  },
  'claude-haiku-4-5': {
    input_price_per_mtok: 0.80,
    output_price_per_mtok: 4,
    cache_read_price_per_mtok: 0.08,
    cache_creation_price_per_mtok: 1.0,
  },
};

/** Default subscription plan prices (USD/month). */
export const PLAN_DEFAULTS = {
  pro: 20,
  max5x: 100,
  max20x: 200,
};

/**
 * Get pricing info for a model. Returns null if unknown.
 */
export function getModelPricing(modelId) {
  return MODEL_PRICING[modelId] || null;
}

/**
 * Calculate the API cost for a single usage record.
 * Returns 0 for unknown models.
 *
 * input_tokens already includes cache tokens. To price correctly:
 *   non_cached_input = input_tokens - cache_read_tokens - cache_creation_tokens
 *   cost = non_cached * input_rate + cache_read * read_rate + cache_creation * write_rate + output * output_rate
 */
export function calculateRecordCost(record) {
  const pricing = MODEL_PRICING[record.model];
  if (!pricing) return 0;

  const nonCachedInput = record.input_tokens - record.cache_read_tokens - record.cache_creation_tokens;
  const M = 1_000_000;

  return (
    (nonCachedInput / M) * pricing.input_price_per_mtok +
    (record.cache_read_tokens / M) * pricing.cache_read_price_per_mtok +
    (record.cache_creation_tokens / M) * pricing.cache_creation_price_per_mtok +
    (record.output_tokens / M) * pricing.output_price_per_mtok
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/pricing.js test/pricing.test.js
git commit -m "feat: add model pricing table and cost calculation"
```

---

## Chunk 2: Aggregator + API Routes + Express Server

### Task 4: Aggregator (`server/aggregator.js`)

**Files:**
- Create: `server/aggregator.js`
- Create: `test/aggregator.test.js`

- [ ] **Step 1: Write failing tests for aggregator**

Create `test/aggregator.test.js`:

```js
import { describe, it } from 'mocha';
import { expect } from 'chai';
import {
  filterByDateRange,
  autoGranularity,
  aggregateByTime,
  aggregateBySession,
  aggregateByProject,
  aggregateByModel,
  aggregateCache,
} from '../server/aggregator.js';

const sampleRecords = [
  { sessionId: 's1', timestamp: '2026-03-10T10:00:00.000Z', model: 'claude-sonnet-4-6', project: 'proj-a', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200, cache_creation_tokens: 100 },
  { sessionId: 's1', timestamp: '2026-03-10T11:00:00.000Z', model: 'claude-sonnet-4-6', project: 'proj-a', input_tokens: 2000, output_tokens: 800, cache_read_tokens: 500, cache_creation_tokens: 200 },
  { sessionId: 's2', timestamp: '2026-03-11T14:00:00.000Z', model: 'claude-opus-4-6', project: 'proj-b', input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 1000, cache_creation_tokens: 500 },
];

describe('filterByDateRange', () => {
  it('filters records within date range (inclusive)', () => {
    const filtered = filterByDateRange(sampleRecords, '2026-03-10', '2026-03-10');
    expect(filtered).to.have.length(2);
  });

  it('returns all records if no dates specified', () => {
    const filtered = filterByDateRange(sampleRecords);
    expect(filtered).to.have.length(3);
  });
});

describe('autoGranularity', () => {
  it('returns hourly for ≤2 day range', () => {
    expect(autoGranularity('2026-03-10', '2026-03-11')).to.equal('hourly');
  });

  it('returns daily for ≤14 day range', () => {
    expect(autoGranularity('2026-03-01', '2026-03-10')).to.equal('daily');
  });

  it('returns weekly for ≤60 day range', () => {
    expect(autoGranularity('2026-01-01', '2026-02-15')).to.equal('weekly');
  });

  it('returns monthly for >60 day range', () => {
    expect(autoGranularity('2025-01-01', '2026-03-10')).to.equal('monthly');
  });
});

describe('aggregateByTime', () => {
  it('aggregates records into daily buckets', () => {
    const buckets = aggregateByTime(sampleRecords, 'daily');
    expect(buckets).to.have.length(2);
    expect(buckets[0].time).to.equal('2026-03-10');
    expect(buckets[0].input_tokens).to.equal(3000);
    expect(buckets[0].output_tokens).to.equal(1300);
  });
});

describe('aggregateBySession', () => {
  it('groups records by sessionId with totals', () => {
    const sessions = aggregateBySession(sampleRecords);
    expect(sessions).to.have.length(2);
    const s1 = sessions.find(s => s.sessionId === 's1');
    expect(s1.input_tokens).to.equal(3000);
    expect(s1.models).to.include('claude-sonnet-4-6');
    expect(s1.project).to.equal('proj-a');
  });
});

describe('aggregateByProject', () => {
  it('groups records by project', () => {
    const projects = aggregateByProject(sampleRecords);
    expect(projects).to.have.length(2);
    const projA = projects.find(p => p.name === 'proj-a');
    expect(projA.total_tokens).to.equal(4300); // 3000 + 1300
  });
});

describe('aggregateByModel', () => {
  it('groups records by model', () => {
    const models = aggregateByModel(sampleRecords);
    expect(models).to.have.length(2);
  });
});

describe('aggregateCache', () => {
  it('computes cache efficiency rates', () => {
    const cache = aggregateCache(sampleRecords);
    expect(cache.total_input_tokens).to.equal(8000);
    expect(cache.cache_read_tokens).to.equal(1700);
    expect(cache.cache_read_rate).to.be.a('number');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: FAIL — `aggregator.js` does not exist.

- [ ] **Step 3: Implement aggregator**

Create `server/aggregator.js`:

```js
import { calculateRecordCost, getModelPricing } from './pricing.js';

/**
 * Filter records by date range (inclusive, UTC day boundaries).
 */
export function filterByDateRange(records, from, to) {
  if (!from && !to) return records;
  const start = from ? new Date(from + 'T00:00:00.000Z').getTime() : -Infinity;
  const end = to ? new Date(to + 'T23:59:59.999Z').getTime() : Infinity;
  return records.filter(r => {
    const t = new Date(r.timestamp).getTime();
    return t >= start && t <= end;
  });
}

/**
 * Auto-select granularity based on date range span.
 */
export function autoGranularity(from, to) {
  if (!from || !to) return 'daily';
  const days = (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24);
  if (days <= 2) return 'hourly';
  if (days <= 14) return 'daily';
  if (days <= 60) return 'weekly';
  return 'monthly';
}

/**
 * Get the bucket key for a timestamp at the given granularity.
 */
function bucketKey(timestamp, granularity) {
  const d = new Date(timestamp);
  switch (granularity) {
    case 'hourly':
      return d.toISOString().slice(0, 13) + ':00'; // "2026-03-10T10:00"
    case 'daily':
      return d.toISOString().slice(0, 10); // "2026-03-10"
    case 'weekly': {
      // ISO week: Monday-based, use the Monday date
      const day = d.getUTCDay();
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
      return monday.toISOString().slice(0, 10);
    }
    case 'monthly':
      return d.toISOString().slice(0, 7); // "2026-03"
    default:
      return d.toISOString().slice(0, 10);
  }
}

/**
 * Aggregate records into time buckets.
 */
export function aggregateByTime(records, granularity) {
  const map = new Map();

  for (const r of records) {
    const key = bucketKey(r.timestamp, granularity);
    if (!map.has(key)) {
      map.set(key, {
        time: key,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        models: {},
      });
    }
    const b = map.get(key);
    b.input_tokens += r.input_tokens;
    b.output_tokens += r.output_tokens;
    b.cache_read_tokens += r.cache_read_tokens;
    b.cache_creation_tokens += r.cache_creation_tokens;

    if (!b.models[r.model]) {
      b.models[r.model] = { input: 0, output: 0 };
    }
    b.models[r.model].input += r.input_tokens;
    b.models[r.model].output += r.output_tokens;
  }

  return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Aggregate records by sessionId.
 */
export function aggregateBySession(records) {
  const map = new Map();

  for (const r of records) {
    if (!map.has(r.sessionId)) {
      map.set(r.sessionId, {
        sessionId: r.sessionId,
        project: r.project,
        models: new Set(),
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        startTime: r.timestamp,
        endTime: r.timestamp,
        cost: 0,
      });
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
    sessionId: s.sessionId,
    project: s.project,
    models: Array.from(s.models),
    input_tokens: s.input_tokens,
    output_tokens: s.output_tokens,
    cache_read_tokens: s.cache_read_tokens,
    cache_creation_tokens: s.cache_creation_tokens,
    total_tokens: s.input_tokens + s.output_tokens,
    startTime: s.startTime,
    endTime: s.endTime,
    duration_minutes: Math.round((new Date(s.endTime) - new Date(s.startTime)) / 60000),
    estimated_cost_usd: Math.round(s.cost * 100) / 100,
  }));
}

/**
 * Aggregate records by project.
 */
export function aggregateByProject(records) {
  const map = new Map();

  for (const r of records) {
    if (!map.has(r.project)) {
      map.set(r.project, {
        name: r.project,
        projectDirName: r.projectDirName,
        total_input_tokens: 0,
        total_output_tokens: 0,
        sessions: new Set(),
        cost: 0,
      });
    }
    const p = map.get(r.project);
    p.total_input_tokens += r.input_tokens;
    p.total_output_tokens += r.output_tokens;
    p.sessions.add(r.sessionId);
    p.cost += calculateRecordCost(r);
  }

  return Array.from(map.values()).map(p => {
    // Reconstruct path from encoded dir name: replace hyphens back to slashes
    const path = p.projectDirName ? '/' + p.projectDirName.replace(/^-/, '').replace(/-/g, '/') : '';
    return {
      name: p.name,
      path,
      total_input_tokens: p.total_input_tokens,
      total_output_tokens: p.total_output_tokens,
      total_tokens: p.total_input_tokens + p.total_output_tokens,
      estimated_cost_usd: Math.round(p.cost * 100) / 100,
      session_count: p.sessions.size,
    };
  }).sort((a, b) => b.total_tokens - a.total_tokens);
}

/**
 * Aggregate records by model.
 */
export function aggregateByModel(records) {
  const map = new Map();

  for (const r of records) {
    if (!map.has(r.model)) {
      map.set(r.model, { id: r.model, total_tokens: 0, input_tokens: 0, output_tokens: 0 });
    }
    const m = map.get(r.model);
    m.input_tokens += r.input_tokens;
    m.output_tokens += r.output_tokens;
    m.total_tokens += r.input_tokens + r.output_tokens;
  }

  return Array.from(map.values()).map(m => {
    const pricing = getModelPricing(m.id);
    return {
      id: m.id,
      total_tokens: m.total_tokens,
      input_tokens: m.input_tokens,
      output_tokens: m.output_tokens,
      ...(pricing || {}),
    };
  }).sort((a, b) => b.total_tokens - a.total_tokens);
}

/**
 * Aggregate cache efficiency stats.
 */
export function aggregateCache(records) {
  let totalInput = 0, cacheRead = 0, cacheCreation = 0;

  for (const r of records) {
    totalInput += r.input_tokens;
    cacheRead += r.cache_read_tokens;
    cacheCreation += r.cache_creation_tokens;
  }

  const nonCached = totalInput - cacheRead - cacheCreation;
  return {
    cache_read_tokens: cacheRead,
    cache_creation_tokens: cacheCreation,
    non_cached_input_tokens: Math.max(0, nonCached),
    total_input_tokens: totalInput,
    cache_read_rate: totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) / 100 : 0,
    cache_creation_rate: totalInput > 0 ? Math.round((cacheCreation / totalInput) * 100) / 100 : 0,
    no_cache_rate: totalInput > 0 ? Math.round((nonCached / totalInput) * 100) / 100 : 0,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/aggregator.js test/aggregator.test.js
git commit -m "feat: add token data aggregator with time, session, project, model, and cache grouping"
```

---

### Task 5: API routes (`server/routes/api.js`)

**Files:**
- Create: `server/routes/api.js`
- Create: `test/api.test.js`

- [ ] **Step 1: Write failing tests for API routes**

Create `test/api.test.js`. Tests use a helper that creates a test Express app with mock data:

```js
import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createApiRouter } from '../server/routes/api.js';

let app, server, baseUrl, tmpDir;

before((done) => {
  // Create test log data
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
  const projectDir = path.join(tmpDir, '-Users-test-Workspace-testproject');
  fs.mkdirSync(projectDir);
  const logFile = path.join(projectDir, 'sess.jsonl');

  const lines = [
    JSON.stringify({
      type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T10:00:00.000Z',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 } }
    }),
    JSON.stringify({
      type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T11:00:00.000Z',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 2000, output_tokens: 800, cache_creation_input_tokens: 300, cache_read_input_tokens: 400 } }
    }),
  ];
  fs.writeFileSync(logFile, lines.join('\n'));

  app = express();
  app.use('/api', createApiRouter(tmpDir));

  server = app.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    done();
  });
});

after((done) => {
  server.close(() => {
    fs.rmSync(tmpDir, { recursive: true });
    done();
  });
});

async function fetchJson(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, data: await res.json() };
}

describe('GET /api/usage', () => {
  it('returns aggregated buckets', async () => {
    const { status, data } = await fetchJson('/api/usage?from=2026-03-10&to=2026-03-10&granularity=daily');
    expect(status).to.equal(200);
    expect(data.granularity).to.equal('daily');
    expect(data.buckets).to.have.length(1);
    expect(data.buckets[0].input_tokens).to.equal(3000);
    expect(data.total.input_tokens).to.equal(3000);
    expect(data.total.estimated_api_cost_usd).to.be.a('number');
  });
});

describe('GET /api/models', () => {
  it('returns detected models with pricing', async () => {
    const { data } = await fetchJson('/api/models');
    expect(data.models).to.have.length(1);
    expect(data.models[0].id).to.equal('claude-sonnet-4-6');
    expect(data.models[0].input_price_per_mtok).to.equal(3);
  });
});

describe('GET /api/projects', () => {
  it('returns projects with totals', async () => {
    const { data } = await fetchJson('/api/projects');
    expect(data.projects).to.have.length(1);
    expect(data.projects[0].name).to.equal('testproject');
    expect(data.projects[0].total_tokens).to.equal(4300);
  });
});

describe('GET /api/sessions', () => {
  it('returns session list with pagination', async () => {
    const { data } = await fetchJson('/api/sessions?from=2026-03-10&to=2026-03-10');
    expect(data.sessions).to.have.length(1);
    expect(data.sessions[0].sessionId).to.equal('s1');
    expect(data.sessions[0].total_tokens).to.equal(4300);
    expect(data.pagination.total_sessions).to.equal(1);
  });
});

describe('GET /api/cost', () => {
  it('returns cost comparison', async () => {
    const { data } = await fetchJson('/api/cost?from=2026-03-10&to=2026-03-10&plan=max5x');
    expect(data.plan).to.equal('max5x');
    expect(data.subscription_cost_usd).to.equal(100);
    expect(data.api_equivalent_cost_usd).to.be.a('number');
    expect(data.savings_usd).to.be.a('number');
  });
});

describe('GET /api/cache', () => {
  it('returns cache stats', async () => {
    const { data } = await fetchJson('/api/cache?from=2026-03-10&to=2026-03-10');
    expect(data.total_input_tokens).to.equal(3000);
    expect(data.cache_read_tokens).to.equal(600);
    expect(data.cache_read_rate).to.be.a('number');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```
Expected: FAIL — `api.js` does not exist.

- [ ] **Step 3: Implement API routes**

Create `server/routes/api.js`:

```js
import { Router } from 'express';
import { parseLogDirectory } from '../parser.js';
import {
  filterByDateRange,
  autoGranularity,
  aggregateByTime,
  aggregateBySession,
  aggregateByProject,
  aggregateByModel,
  aggregateCache,
} from '../aggregator.js';
import { calculateRecordCost, PLAN_DEFAULTS } from '../pricing.js';

/**
 * Create API router. Accepts logBaseDir to allow test injection.
 */
export function createApiRouter(logBaseDir) {
  const router = Router();

  // Parse all logs once at startup, cache in memory
  let allRecords = [];
  try {
    allRecords = parseLogDirectory(logBaseDir);
    console.log(`Parsed ${allRecords.length} records from ${logBaseDir}`);
  } catch (err) {
    console.error('Failed to parse log directory:', err.message);
  }

  /** Helper: apply common filters (date range, project, model) */
  function applyFilters(query) {
    let records = filterByDateRange(allRecords, query.from, query.to);
    if (query.project) {
      records = records.filter(r => r.project === query.project);
    }
    if (query.model) {
      records = records.filter(r => r.model === query.model);
    }
    return records;
  }

  // GET /api/usage
  router.get('/usage', (req, res) => {
    try {
      const records = applyFilters(req.query);
      const granularity = req.query.granularity || autoGranularity(req.query.from, req.query.to);
      const buckets = aggregateByTime(records, granularity);

      const total = {
        input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, estimated_api_cost_usd: 0,
      };
      for (const r of records) {
        total.input_tokens += r.input_tokens;
        total.output_tokens += r.output_tokens;
        total.cache_read_tokens += r.cache_read_tokens;
        total.cache_creation_tokens += r.cache_creation_tokens;
        total.estimated_api_cost_usd += calculateRecordCost(r);
      }
      total.estimated_api_cost_usd = Math.round(total.estimated_api_cost_usd * 100) / 100;

      res.json({ granularity, buckets, total });
    } catch (err) {
      res.status(500).json({ error: err.message, code: 'PARSE_ERROR' });
    }
  });

  // GET /api/models
  router.get('/models', (req, res) => {
    const records = applyFilters(req.query);
    res.json({ models: aggregateByModel(records) });
  });

  // GET /api/projects
  router.get('/projects', (req, res) => {
    const records = applyFilters(req.query);
    res.json({ projects: aggregateByProject(records) });
  });

  // GET /api/sessions
  router.get('/sessions', (req, res) => {
    const records = applyFilters(req.query);
    let sessions = aggregateBySession(records);

    // Sort
    const sort = req.query.sort || 'date';
    const order = req.query.order || 'desc';
    const sortFn = {
      date: (a, b) => new Date(b.startTime) - new Date(a.startTime),
      cost: (a, b) => b.estimated_cost_usd - a.estimated_cost_usd,
      tokens: (a, b) => b.total_tokens - a.total_tokens,
    }[sort] || ((a, b) => new Date(b.startTime) - new Date(a.startTime));

    sessions.sort(sortFn);
    if (order === 'asc') sessions.reverse();

    // Totals (before pagination)
    const totalTokens = sessions.reduce((sum, s) => sum + s.total_tokens, 0);
    const totalCost = sessions.reduce((sum, s) => sum + s.estimated_cost_usd, 0);

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const totalSessions = sessions.length;
    const totalPages = Math.ceil(totalSessions / limit);
    sessions = sessions.slice((page - 1) * limit, page * limit);

    res.json({
      sessions,
      pagination: { page, limit, total_sessions: totalSessions, total_pages: totalPages },
      totals: { total_tokens: totalTokens, estimated_cost_usd: Math.round(totalCost * 100) / 100 },
    });
  });

  // GET /api/cost
  router.get('/cost', (req, res) => {
    const records = applyFilters(req.query);
    const plan = req.query.plan || 'max5x';
    const customPrice = req.query.customPrice ? parseFloat(req.query.customPrice) : null;
    const subscriptionCost = customPrice || PLAN_DEFAULTS[plan] || 100;

    let apiCost = 0;
    for (const r of records) {
      apiCost += calculateRecordCost(r);
    }
    apiCost = Math.round(apiCost * 100) / 100;

    // Cost per day
    const dayMap = new Map();
    for (const r of records) {
      const day = r.timestamp.slice(0, 10);
      dayMap.set(day, (dayMap.get(day) || 0) + calculateRecordCost(r));
    }

    const costPerDay = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cost]) => {
        const d = new Date(date);
        const daysInMonth = new Date(d.getUTCFullYear(), d.getUTCMonth() + 1, 0).getUTCDate();
        return {
          date,
          api_cost: Math.round(cost * 100) / 100,
          subscription_daily: Math.round((subscriptionCost / daysInMonth) * 100) / 100,
        };
      });

    const savings = apiCost - subscriptionCost;
    res.json({
      plan,
      subscription_cost_usd: subscriptionCost,
      api_equivalent_cost_usd: apiCost,
      savings_usd: Math.round(savings * 100) / 100,
      savings_percent: apiCost > 0 ? Math.round((savings / apiCost) * 1000) / 10 : 0,
      cost_per_day: costPerDay,
    });
  });

  // GET /api/cache
  router.get('/cache', (req, res) => {
    const records = applyFilters(req.query);
    res.json(aggregateCache(records));
  });

  return router;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/api.js test/api.test.js
git commit -m "feat: add REST API routes for usage, models, projects, sessions, cost, and cache"
```

---

### Task 6: Express server (`server/index.js`)

**Files:**
- Create: `server/index.js`

- [ ] **Step 1: Implement Express server**

Create `server/index.js`:

```js
import express from 'express';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createApiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const LOG_DIR = path.join(os.homedir(), '.claude', 'projects');

const app = express();

// Serve D3 from node_modules
app.use('/lib/d3', express.static(path.join(__dirname, '..', 'node_modules', 'd3', 'dist')));

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api', createApiRouter(LOG_DIR));

app.listen(PORT, () => {
  console.log(`Claude Usage Report running at http://localhost:${PORT}`);
});
```

- [ ] **Step 2: Smoke test — start the server**

```bash
node server/index.js &
curl -s http://localhost:3000/api/models | head -c 200
kill %1
```
Expected: JSON response with models array.

- [ ] **Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: add Express server entry point with static file serving"
```

---

## Chunk 3: Frontend — HTML Shell + CSS + API Client + Components

### Task 7: HTML shell and CSS

**Files:**
- Create: `public/index.html`
- Create: `public/css/style.css`

- [ ] **Step 1: Create the HTML shell**

Create `public/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Usage Report</title>
  <link rel="stylesheet" href="/css/style.css">
  <script src="/lib/d3/d3.min.js"></script>
</head>
<body>
  <!-- Top Bar -->
  <header class="top-bar">
    <h1 class="logo">⚡ Claude Usage Report</h1>
    <div class="controls">
      <div id="date-picker" class="date-picker"></div>
      <div id="plan-selector" class="plan-selector"></div>
    </div>
  </header>

  <!-- Summary Cards -->
  <section class="summary-cards" id="summary-cards">
    <div class="card" id="card-total-tokens">
      <div class="card-label">Total Tokens</div>
      <div class="card-value" id="val-total-tokens">—</div>
      <div class="card-sub" id="sub-total-tokens"></div>
    </div>
    <div class="card" id="card-api-cost">
      <div class="card-label">API Cost Equivalent</div>
      <div class="card-value" id="val-api-cost">—</div>
      <div class="card-sub" id="sub-api-cost">at standard API pricing</div>
    </div>
    <div class="card" id="card-savings">
      <div class="card-label">You Saved</div>
      <div class="card-value" id="val-savings">—</div>
      <div class="card-sub" id="sub-savings"></div>
    </div>
    <div class="card" id="card-cache">
      <div class="card-label">Cache Hit Rate</div>
      <div class="card-value" id="val-cache-rate">—</div>
      <div class="card-sub" id="sub-cache-rate">cache_read / total input</div>
    </div>
  </section>

  <!-- Token Trend Chart -->
  <section class="chart-section">
    <div class="chart-header">
      <h2>Token Consumption Trend</h2>
      <div class="granularity-toggle" id="granularity-toggle">
        <button data-granularity="hourly">Hourly</button>
        <button data-granularity="daily" class="active">Daily</button>
        <button data-granularity="weekly">Weekly</button>
        <button data-granularity="monthly">Monthly</button>
      </div>
    </div>
    <div id="chart-token-trend" class="chart-container"></div>
  </section>

  <!-- Second Row: 3 charts -->
  <section class="chart-row-3">
    <div class="chart-section">
      <h2>Cost: Subscription vs API</h2>
      <div id="chart-cost-comparison" class="chart-container"></div>
    </div>
    <div class="chart-section">
      <h2>Model Distribution</h2>
      <div id="chart-model-distribution" class="chart-container"></div>
    </div>
    <div class="chart-section">
      <h2>Cache Efficiency</h2>
      <div id="chart-cache-efficiency" class="chart-container"></div>
    </div>
  </section>

  <!-- Project Distribution -->
  <section class="chart-section">
    <h2>Project Distribution</h2>
    <div id="chart-project-distribution" class="chart-container"></div>
  </section>

  <!-- Session Table -->
  <section class="chart-section">
    <div class="chart-header">
      <h2>Session Details</h2>
      <div class="table-controls">
        <input type="text" id="session-filter" placeholder="Filter by project..." class="filter-input">
        <select id="session-sort" class="sort-select">
          <option value="date">Sort by: Date</option>
          <option value="cost">Sort by: Cost</option>
          <option value="tokens">Sort by: Tokens</option>
        </select>
      </div>
    </div>
    <div id="session-table" class="table-container"></div>
    <div id="session-pagination" class="pagination"></div>
  </section>

  <script type="module" src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the CSS**

Create `public/css/style.css`:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg-primary: #0f172a;
  --bg-card: #1e293b;
  --bg-input: #334155;
  --border: #475569;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-muted: #64748b;
  --blue: #3b82f6;
  --blue-light: #60a5fa;
  --purple: #8b5cf6;
  --orange: #f97316;
  --amber: #f59e0b;
  --green: #4ade80;
  --red: #ef4444;
}

body {
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, sans-serif;
  padding: 0 24px 40px;
}

/* Top Bar */
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
  border-bottom: 1px solid var(--bg-card);
  margin-bottom: 20px;
}
.logo { font-size: 18px; font-weight: 700; }
.controls { display: flex; gap: 12px; align-items: center; }

/* Summary Cards */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}
.card {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 16px;
}
.card-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
}
.card-value {
  font-size: 24px;
  font-weight: 700;
  margin-top: 4px;
}
.card-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
#val-api-cost { color: var(--amber); }
#val-savings { color: var(--green); }
#val-cache-rate { color: var(--blue-light); }

/* Chart sections */
.chart-section {
  background: var(--bg-card);
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 12px;
}
.chart-section h2 {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 16px;
}
.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.chart-header h2 { margin-bottom: 0; }
.chart-container { min-height: 200px; }

/* 3-column row */
.chart-row-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 12px;
}

/* Granularity toggle */
.granularity-toggle { display: flex; gap: 4px; }
.granularity-toggle button {
  padding: 4px 12px;
  background: var(--bg-input);
  border: none;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.granularity-toggle button.active {
  background: var(--blue);
  color: white;
}

/* Table controls */
.table-controls { display: flex; gap: 8px; }
.filter-input, .sort-select {
  padding: 6px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
}
.filter-input { width: 180px; }

/* Session table */
.table-container { overflow-x: auto; }
.table-container table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.table-container th {
  text-align: left;
  padding: 10px 8px;
  border-bottom: 2px solid var(--bg-input);
  color: var(--text-muted);
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 1px;
  cursor: pointer;
}
.table-container th.align-right,
.table-container td.align-right { text-align: right; }
.table-container td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--bg-primary);
  color: var(--text-secondary);
}
.table-container tfoot td {
  border-top: 2px solid var(--bg-input);
  font-weight: 600;
  color: var(--text-primary);
}

/* Tags */
.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.tag-project { background: #1e3a5f; color: var(--blue-light); }
.tag-model-sonnet { background: #1e3a5f; color: var(--blue-light); }
.tag-model-opus { background: #3b1764; color: #c084fc; }
.tag-model-haiku { background: #1a2e1a; color: var(--green); }

/* Pagination */
.pagination {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-top: 12px;
}
.pagination button {
  padding: 4px 10px;
  background: var(--bg-input);
  border: none;
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
}
.pagination button.active {
  background: var(--blue);
  color: white;
}

/* Date picker */
.date-picker {
  display: flex;
  align-items: center;
  gap: 8px;
}
.date-picker input {
  padding: 6px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
}
.date-picker span { color: var(--text-secondary); font-size: 12px; }

/* Plan selector */
.plan-selector select, .plan-selector input {
  padding: 6px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 12px;
}

/* D3 tooltip */
.d3-tooltip {
  position: absolute;
  padding: 8px 12px;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  pointer-events: none;
  z-index: 100;
}

/* Responsive */
@media (max-width: 768px) {
  .summary-cards { grid-template-columns: repeat(2, 1fr); }
  .chart-row-3 { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Smoke test — start server and check page loads**

```bash
node server/index.js &
curl -s http://localhost:3000/ | head -5
kill %1
```
Expected: HTML response starting with `<!DOCTYPE html>`.

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/css/style.css
git commit -m "feat: add dashboard HTML shell and dark theme CSS"
```

---

### Task 8: API client + components

**Files:**
- Create: `public/js/api.js`
- Create: `public/js/components/date-picker.js`
- Create: `public/js/components/plan-selector.js`

- [ ] **Step 1: Create API client**

Create `public/js/api.js`:

```js
const BASE = '/api';

function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  return entries.length ? '?' + new URLSearchParams(entries).toString() : '';
}

export async function fetchUsage(params = {}) {
  const res = await fetch(`${BASE}/usage${qs(params)}`);
  return res.json();
}

export async function fetchModels(params = {}) {
  const res = await fetch(`${BASE}/models${qs(params)}`);
  return res.json();
}

export async function fetchProjects(params = {}) {
  const res = await fetch(`${BASE}/projects${qs(params)}`);
  return res.json();
}

export async function fetchSessions(params = {}) {
  const res = await fetch(`${BASE}/sessions${qs(params)}`);
  return res.json();
}

export async function fetchCost(params = {}) {
  const res = await fetch(`${BASE}/cost${qs(params)}`);
  return res.json();
}

export async function fetchCache(params = {}) {
  const res = await fetch(`${BASE}/cache${qs(params)}`);
  return res.json();
}
```

- [ ] **Step 2: Create date picker component**

Create `public/js/components/date-picker.js`:

```js
export function initDatePicker(container, onChange) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const fmt = d => d.toISOString().slice(0, 10);

  container.innerHTML = `
    <span>📅</span>
    <input type="date" id="date-from" value="${fmt(thirtyDaysAgo)}">
    <span>–</span>
    <input type="date" id="date-to" value="${fmt(today)}">
  `;

  const fromInput = container.querySelector('#date-from');
  const toInput = container.querySelector('#date-to');

  const emitChange = () => onChange({ from: fromInput.value, to: toInput.value });
  fromInput.addEventListener('change', emitChange);
  toInput.addEventListener('change', emitChange);

  return { getRange: () => ({ from: fromInput.value, to: toInput.value }) };
}
```

- [ ] **Step 3: Create plan selector component**

Create `public/js/components/plan-selector.js`:

```js
const PLANS = {
  pro: { label: 'Pro', price: 20 },
  max5x: { label: 'Max 5x', price: 100 },
  max20x: { label: 'Max 20x', price: 200 },
};

export function initPlanSelector(container, onChange) {
  container.innerHTML = `
    <select id="plan-select">
      ${Object.entries(PLANS).map(([key, p]) =>
        `<option value="${key}" ${key === 'max5x' ? 'selected' : ''}>${p.label} ($${p.price}/mo)</option>`
      ).join('')}
    </select>
    <input type="number" id="custom-price" placeholder="Custom $" style="width:80px;display:none;">
  `;

  const select = container.querySelector('#plan-select');
  const customInput = container.querySelector('#custom-price');

  const emitChange = () => {
    const plan = select.value;
    const customPrice = customInput.value ? parseFloat(customInput.value) : null;
    onChange({ plan, customPrice });
  };

  select.addEventListener('change', emitChange);
  customInput.addEventListener('input', emitChange);

  // Double-click select to show custom price input
  select.addEventListener('dblclick', () => {
    customInput.style.display = customInput.style.display === 'none' ? 'inline-block' : 'none';
  });

  return {
    getPlan: () => ({
      plan: select.value,
      customPrice: customInput.value ? parseFloat(customInput.value) : null,
    }),
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add public/js/api.js public/js/components/
git commit -m "feat: add API client and date-picker/plan-selector components"
```

---

## Chunk 4: D3 Charts

### Task 9: Token trend area chart

**Files:**
- Create: `public/js/charts/token-trend.js`

- [ ] **Step 1: Implement token trend chart**

Create `public/js/charts/token-trend.js`:

```js
// d3 is loaded as a global via <script> tag in index.html

export function renderTokenTrend(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  if (!data.buckets || data.buckets.length === 0) {
    el.append('p').style('color', '#64748b').text('No data for selected range');
    return;
  }

  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = 250 - margin.top - margin.bottom;

  const svg = el.append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const buckets = data.buckets;
  const x = d3.scaleBand()
    .domain(buckets.map(d => d.time))
    .range([0, width])
    .padding(0.1);

  const maxVal = d3.max(buckets, d => d.input_tokens + d.output_tokens);
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([height, 0]);

  // Axes
  const xAxis = svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % Math.ceil(buckets.length / 10) === 0)));
  xAxis.selectAll('text').style('fill', '#64748b').style('font-size', '10px')
    .attr('transform', 'rotate(-45)').attr('text-anchor', 'end');
  xAxis.selectAll('line, path').style('stroke', '#334155');

  const yAxis = svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.2s')));
  yAxis.selectAll('text').style('fill', '#64748b').style('font-size', '10px');
  yAxis.selectAll('line, path').style('stroke', '#334155');

  // Input bars (bottom of stack)
  svg.selectAll('.bar-input')
    .data(buckets)
    .enter().append('rect')
    .attr('x', d => x(d.time))
    .attr('y', d => y(d.input_tokens))
    .attr('width', x.bandwidth())
    .attr('height', d => height - y(d.input_tokens))
    .attr('fill', '#3b82f6')
    .attr('opacity', 0.7);

  // Output bars (stacked on top of input)
  svg.selectAll('.bar-output')
    .data(buckets)
    .enter().append('rect')
    .attr('x', d => x(d.time))
    .attr('y', d => y(d.input_tokens + d.output_tokens))
    .attr('width', x.bandwidth())
    .attr('height', d => y(d.input_tokens) - y(d.input_tokens + d.output_tokens))
    .attr('fill', '#f97316')
    .attr('opacity', 0.7);

  // Tooltip
  const tooltip = d3.select('body').append('div').attr('class', 'd3-tooltip').style('display', 'none');

  svg.selectAll('rect')
    .on('mouseover', (event, d) => {
      tooltip.style('display', 'block')
        .html(`<strong>${d.time}</strong><br>Input: ${d3.format(',')(d.input_tokens)}<br>Output: ${d3.format(',')(d.output_tokens)}`);
    })
    .on('mousemove', (event) => {
      tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', () => tooltip.style('display', 'none'));

  // Legend
  const legend = el.append('div').style('display', 'flex').style('gap', '16px').style('margin-top', '8px');
  legend.append('span').style('font-size', '11px').style('color', '#60a5fa').html('● Input tokens');
  legend.append('span').style('font-size', '11px').style('color', '#f97316').html('● Output tokens');
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/charts/token-trend.js
git commit -m "feat: add D3 token consumption trend chart"
```

---

### Task 10: Cost comparison, model distribution, cache efficiency charts

**Files:**
- Create: `public/js/charts/cost-comparison.js`
- Create: `public/js/charts/model-distribution.js`
- Create: `public/js/charts/cache-efficiency.js`

- [ ] **Step 1: Implement cost comparison bar chart**

Create `public/js/charts/cost-comparison.js`:

```js
// d3 is loaded as a global via <script> tag in index.html

export function renderCostComparison(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  const margin = { top: 10, right: 20, bottom: 40, left: 50 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = 180 - margin.top - margin.bottom;

  const svg = el.append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const bars = [
    { label: 'Subscription', value: data.subscription_cost_usd, color: '#3b82f6' },
    { label: 'API Cost', value: data.api_equivalent_cost_usd, color: '#f59e0b' },
  ];

  const x = d3.scaleBand().domain(bars.map(d => d.label)).range([0, width]).padding(0.4);
  const y = d3.scaleLinear().domain([0, d3.max(bars, d => d.value) * 1.2]).range([height, 0]);

  svg.append('g').attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x))
    .selectAll('text').style('fill', '#94a3b8').style('font-size', '11px');

  svg.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d => `$${d}`))
    .selectAll('text').style('fill', '#64748b').style('font-size', '10px');

  svg.selectAll('.bar')
    .data(bars)
    .enter().append('rect')
    .attr('x', d => x(d.label))
    .attr('y', d => y(d.value))
    .attr('width', x.bandwidth())
    .attr('height', d => height - y(d.value))
    .attr('fill', d => d.color)
    .attr('rx', 4);

  // Value labels
  svg.selectAll('.label')
    .data(bars)
    .enter().append('text')
    .attr('x', d => x(d.label) + x.bandwidth() / 2)
    .attr('y', d => y(d.value) - 5)
    .attr('text-anchor', 'middle')
    .style('fill', '#f8fafc').style('font-size', '12px').style('font-weight', '600')
    .text(d => `$${d.value.toFixed(2)}`);
}
```

- [ ] **Step 2: Implement model distribution donut chart**

Create `public/js/charts/model-distribution.js`:

```js
// d3 is loaded as a global via <script> tag in index.html

const MODEL_COLORS = {
  'claude-sonnet-4-6': '#3b82f6',
  'claude-opus-4-6': '#8b5cf6',
  'claude-haiku-4-5': '#f59e0b',
};

export function renderModelDistribution(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  if (!data.models || data.models.length === 0) {
    el.append('p').style('color', '#64748b').text('No data');
    return;
  }

  const size = Math.min(container.clientWidth, 200);
  const radius = size / 2;
  const innerRadius = radius * 0.55;

  const svg = el.append('svg')
    .attr('width', container.clientWidth)
    .attr('height', size)
    .append('g')
    .attr('transform', `translate(${size / 2},${size / 2})`);

  const total = d3.sum(data.models, d => d.total_tokens);
  const pie = d3.pie().value(d => d.total_tokens).sort(null);
  const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);

  svg.selectAll('path')
    .data(pie(data.models))
    .enter().append('path')
    .attr('d', arc)
    .attr('fill', d => MODEL_COLORS[d.data.id] || '#64748b')
    .attr('stroke', '#1e293b')
    .attr('stroke-width', 2);

  // Legend
  const legend = el.append('div')
    .style('position', 'absolute')
    .style('right', '10px')
    .style('top', '50%')
    .style('transform', 'translateY(-50%)');

  // Make container relative
  el.style('position', 'relative');

  data.models.forEach(m => {
    const pct = ((m.total_tokens / total) * 100).toFixed(1);
    const color = MODEL_COLORS[m.id] || '#64748b';
    const shortName = m.id.replace('claude-', '').replace(/-/g, ' ');
    legend.append('div')
      .style('font-size', '11px')
      .style('color', '#94a3b8')
      .style('margin-bottom', '4px')
      .html(`<span style="color:${color}">●</span> ${shortName} — ${pct}%`);
  });
}
```

- [ ] **Step 3: Implement cache efficiency chart**

Create `public/js/charts/cache-efficiency.js`:

```js
export function renderCacheEfficiency(container, data) {
  container.innerHTML = '';

  const items = [
    { label: 'Cache Read', value: data.cache_read_rate, color: '#4ade80', tokens: data.cache_read_tokens },
    { label: 'Cache Creation', value: data.cache_creation_rate, color: '#f59e0b', tokens: data.cache_creation_tokens },
    { label: 'No Cache', value: data.no_cache_rate, color: '#ef4444', tokens: data.non_cached_input_tokens },
  ];

  for (const item of items) {
    const row = document.createElement('div');
    row.style.marginBottom = '12px';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:4px';
    header.innerHTML = `<span>${item.label}</span><span>${(item.value * 100).toFixed(1)}%</span>`;

    const barBg = document.createElement('div');
    barBg.style.cssText = 'height:8px;background:#334155;border-radius:4px;overflow:hidden';

    const barFill = document.createElement('div');
    barFill.style.cssText = `width:${item.value * 100}%;height:100%;background:${item.color};border-radius:4px;transition:width 0.5s`;

    barBg.appendChild(barFill);
    row.appendChild(header);
    row.appendChild(barBg);
    container.appendChild(row);
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add public/js/charts/cost-comparison.js public/js/charts/model-distribution.js public/js/charts/cache-efficiency.js
git commit -m "feat: add cost comparison, model distribution, and cache efficiency charts"
```

---

### Task 11: Project distribution + session stats table

**Files:**
- Create: `public/js/charts/project-distribution.js`
- Create: `public/js/charts/session-stats.js`

- [ ] **Step 1: Implement project distribution chart**

Create `public/js/charts/project-distribution.js`:

```js
// d3 is loaded as a global via <script> tag in index.html

const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#4ade80', '#ef4444', '#ec4899', '#06b6d4'];

export function renderProjectDistribution(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  if (!data.projects || data.projects.length === 0) {
    el.append('p').style('color', '#64748b').text('No data');
    return;
  }

  const margin = { top: 10, right: 80, bottom: 10, left: 120 };
  const barHeight = 24;
  const gap = 8;
  const height = data.projects.length * (barHeight + gap) + margin.top + margin.bottom;
  const width = container.clientWidth - margin.left - margin.right;

  const svg = el.append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear()
    .domain([0, d3.max(data.projects, d => d.total_tokens)])
    .range([0, width]);

  const y = d3.scaleBand()
    .domain(data.projects.map(d => d.name))
    .range([0, height - margin.top - margin.bottom])
    .padding(0.25);

  // Project name labels
  svg.selectAll('.project-label')
    .data(data.projects)
    .enter().append('text')
    .attr('x', -8)
    .attr('y', d => y(d.name) + y.bandwidth() / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle')
    .style('fill', '#e2e8f0').style('font-size', '12px')
    .text(d => d.name);

  // Bars
  svg.selectAll('.bar')
    .data(data.projects)
    .enter().append('rect')
    .attr('x', 0)
    .attr('y', d => y(d.name))
    .attr('width', d => x(d.total_tokens))
    .attr('height', y.bandwidth())
    .attr('fill', (_, i) => COLORS[i % COLORS.length])
    .attr('rx', 3);

  // Token count labels
  svg.selectAll('.token-label')
    .data(data.projects)
    .enter().append('text')
    .attr('x', d => x(d.total_tokens) + 8)
    .attr('y', d => y(d.name) + y.bandwidth() / 2)
    .attr('dominant-baseline', 'middle')
    .style('fill', '#94a3b8').style('font-size', '11px')
    .text(d => d3.format('.2s')(d.total_tokens) + ' tokens');
}
```

- [ ] **Step 2: Implement session stats table**

Create `public/js/charts/session-stats.js`:

```js
function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

function modelTag(model) {
  const shortName = model.replace('claude-', '').split('-').slice(0, -1).join('-') || model;
  let cls = 'tag-model-sonnet';
  if (model.includes('opus')) cls = 'tag-model-opus';
  else if (model.includes('haiku')) cls = 'tag-model-haiku';
  return `<span class="tag ${cls}">${shortName}</span>`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function renderSessionTable(container, data, { onSort, onPageChange }) {
  container.innerHTML = '';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const columns = [
    { key: 'date', label: 'Date & Time' },
    { key: 'project', label: 'Project' },
    { key: 'models', label: 'Model(s)' },
    { key: 'input', label: 'Input', align: 'right' },
    { key: 'output', label: 'Output', align: 'right' },
    { key: 'cache_read', label: 'Cache Read', align: 'right' },
    { key: 'cache_creation', label: 'Cache Write', align: 'right' },
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'cost', label: 'API Cost', align: 'right' },
    { key: 'duration', label: 'Duration', align: 'right' },
  ];

  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.align) th.className = 'align-right';
    if (['date', 'cost', 'total'].includes(col.key)) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const sortKey = col.key === 'total' ? 'tokens' : col.key;
        onSort(sortKey);
      });
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const s of data.sessions) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(s.startTime)}</td>
      <td><span class="tag tag-project">${s.project}</span></td>
      <td>${s.models.map(modelTag).join(' ')}</td>
      <td class="align-right" style="color:#60a5fa">${formatTokens(s.input_tokens)}</td>
      <td class="align-right" style="color:#f97316">${formatTokens(s.output_tokens)}</td>
      <td class="align-right" style="color:#4ade80">${formatTokens(s.cache_read_tokens)}</td>
      <td class="align-right" style="color:#f59e0b">${formatTokens(s.cache_creation_tokens)}</td>
      <td class="align-right" style="font-weight:600">${formatTokens(s.total_tokens)}</td>
      <td class="align-right" style="color:#f59e0b;font-weight:600">$${s.estimated_cost_usd.toFixed(2)}</td>
      <td class="align-right">${formatDuration(s.duration_minutes)}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  // Footer
  if (data.totals) {
    const tfoot = document.createElement('tfoot');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="3">Showing ${data.sessions.length} of ${data.pagination.total_sessions} sessions</td>
      <td class="align-right" colspan="4"></td>
      <td class="align-right">${formatTokens(data.totals.total_tokens)}</td>
      <td class="align-right" style="color:#f59e0b">$${data.totals.estimated_cost_usd.toFixed(2)}</td>
      <td></td>
    `;
    tfoot.appendChild(tr);
    table.appendChild(tfoot);
  }

  container.appendChild(table);

  // Pagination
  const pagEl = document.getElementById('session-pagination');
  if (pagEl && data.pagination && data.pagination.total_pages > 1) {
    pagEl.innerHTML = '';
    for (let i = 1; i <= data.pagination.total_pages; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      if (i === data.pagination.page) btn.className = 'active';
      btn.addEventListener('click', () => onPageChange(i));
      pagEl.appendChild(btn);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add public/js/charts/project-distribution.js public/js/charts/session-stats.js
git commit -m "feat: add project distribution chart and session stats table"
```

---

## Chunk 5: Main App Controller + Integration

### Task 12: Main app controller (`public/js/app.js`)

**Files:**
- Create: `public/js/app.js`

- [ ] **Step 1: Implement main app controller**

Create `public/js/app.js`:

```js
import { fetchUsage, fetchModels, fetchProjects, fetchSessions, fetchCost, fetchCache } from './api.js';
import { initDatePicker } from './components/date-picker.js';
import { initPlanSelector } from './components/plan-selector.js';
import { renderTokenTrend } from './charts/token-trend.js';
import { renderCostComparison } from './charts/cost-comparison.js';
import { renderModelDistribution } from './charts/model-distribution.js';
import { renderCacheEfficiency } from './charts/cache-efficiency.js';
import { renderProjectDistribution } from './charts/project-distribution.js';
import { renderSessionTable } from './charts/session-stats.js';

// App state
const state = {
  dateRange: { from: null, to: null },
  plan: { plan: 'max5x', customPrice: null },
  granularity: null, // null = auto
  sessionSort: 'date',
  sessionOrder: 'desc',
  sessionPage: 1,
  sessionProject: '',
};

let datePicker, planSelector;

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

async function loadAll() {
  const params = { ...state.dateRange };
  const planParams = { ...state.dateRange, plan: state.plan.plan };
  if (state.plan.customPrice) planParams.customPrice = state.plan.customPrice;

  const [usage, models, projects, sessions, cost, cache] = await Promise.all([
    fetchUsage({ ...params, granularity: state.granularity }),
    fetchModels(params),
    fetchProjects(params),
    fetchSessions({
      ...params,
      project: state.sessionProject,
      sort: state.sessionSort,
      order: state.sessionOrder,
      page: state.sessionPage,
    }),
    fetchCost(planParams),
    fetchCache(params),
  ]);

  // Summary cards
  document.getElementById('val-total-tokens').textContent = formatNumber(usage.total.input_tokens + usage.total.output_tokens);
  document.getElementById('val-api-cost').textContent = `$${cost.api_equivalent_cost_usd.toFixed(2)}`;

  const savings = cost.savings_usd;
  const savingsEl = document.getElementById('val-savings');
  savingsEl.textContent = `$${Math.abs(savings).toFixed(2)}`;
  savingsEl.style.color = savings >= 0 ? '#4ade80' : '#ef4444';
  document.getElementById('sub-savings').textContent = savings >= 0 ? 'subscription saved you this much!' : 'API would have been cheaper';

  document.getElementById('val-cache-rate').textContent = `${(cache.cache_read_rate * 100).toFixed(1)}%`;

  // Set active granularity button
  const activeGran = usage.granularity;
  document.querySelectorAll('.granularity-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.granularity === activeGran);
  });

  // Charts
  renderTokenTrend(document.getElementById('chart-token-trend'), usage);
  renderCostComparison(document.getElementById('chart-cost-comparison'), cost);
  renderModelDistribution(document.getElementById('chart-model-distribution'), models);
  renderCacheEfficiency(document.getElementById('chart-cache-efficiency'), cache);
  renderProjectDistribution(document.getElementById('chart-project-distribution'), projects);
  renderSessionTable(document.getElementById('session-table'), sessions, {
    onSort: (key) => {
      if (state.sessionSort === key) {
        state.sessionOrder = state.sessionOrder === 'desc' ? 'asc' : 'desc';
      } else {
        state.sessionSort = key;
        state.sessionOrder = 'desc';
      }
      state.sessionPage = 1;
      loadAll();
    },
    onPageChange: (page) => {
      state.sessionPage = page;
      loadAll();
    },
  });
}

function init() {
  // Date picker
  datePicker = initDatePicker(document.getElementById('date-picker'), (range) => {
    state.dateRange = range;
    state.sessionPage = 1;
    loadAll();
  });
  state.dateRange = datePicker.getRange();

  // Plan selector
  planSelector = initPlanSelector(document.getElementById('plan-selector'), (plan) => {
    state.plan = plan;
    loadAll();
  });

  // Granularity toggle
  document.getElementById('granularity-toggle').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      state.granularity = e.target.dataset.granularity;
      loadAll();
    }
  });

  // Session filter
  const filterInput = document.getElementById('session-filter');
  let filterTimeout;
  filterInput.addEventListener('input', () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      state.sessionProject = filterInput.value.trim();
      state.sessionPage = 1;
      loadAll();
    }, 300);
  });

  // Session sort dropdown
  document.getElementById('session-sort').addEventListener('change', (e) => {
    state.sessionSort = e.target.value;
    state.sessionOrder = 'desc';
    state.sessionPage = 1;
    loadAll();
  });

  loadAll();
}

document.addEventListener('DOMContentLoaded', init);
```

- [ ] **Step 2: Verify the app loads end-to-end**

```bash
node server/index.js &
sleep 1
curl -s http://localhost:3000/ | grep "Claude Usage Report"
curl -s http://localhost:3000/api/usage | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Buckets: {len(d.get(\"buckets\",[]))}')"
kill %1
```
Expected: HTML page title found, API returns bucket data.

- [ ] **Step 3: Commit**

```bash
git add public/js/app.js
git commit -m "feat: add main app controller wiring all charts and components"
```

---

### Task 13: Final integration test and polish

**Files:**
- Modify: `server/index.js` (if needed for D3 path fix)

- [ ] **Step 1: Verify D3 module import path works**

Start the server and check that D3 is accessible:

```bash
node server/index.js &
sleep 1
curl -sI http://localhost:3000/lib/d3/d3.min.js | head -3
kill %1
```

Expected: `HTTP/1.1 200 OK` with `Content-Type: application/javascript`.

If the D3 path doesn't resolve correctly, check `node_modules/d3/dist/` for the actual filename and update `server/index.js` static path or the import paths in chart modules accordingly.

- [ ] **Step 2: Run all backend tests**

```bash
npm test
```
Expected: All tests PASS.

- [ ] **Step 3: Manual smoke test in browser**

```bash
node server/index.js
```

Open `http://localhost:3000` in browser. Verify:
1. Dashboard loads with dark theme
2. Summary cards show token counts and costs
3. Token trend chart renders with data
4. Cost comparison, model distribution, cache efficiency charts render
5. Project distribution shows projects from your logs
6. Session table shows session list with costs
7. Date range picker changes trigger data reload
8. Plan selector changes update cost comparison
9. Granularity toggle switches chart view

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Claude Usage Report dashboard with D3 visualizations"
```
