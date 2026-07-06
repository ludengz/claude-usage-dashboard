# Quota Cycle Tracking — Design Spec

## Problem

Claude Code users lack visibility into their per-cycle quota limits. Reddit users report perceived quota reductions with no data to confirm or deny. The dashboard already projects costs in dollars but doesn't track token-level projections or allow cross-cycle comparison.

## Solution

Track each 7-day quota cycle's actual token usage and project what the full quota would be at 100% utilization. Persist cycle snapshots so users can compare across periods and detect if their effective quota is changing.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cycle boundary | API `resets_at` timestamp | Exact alignment with Anthropic's actual quota window |
| Storage | JSON file per machine | Zero dependencies, avoids multi-machine sync conflicts |
| Display | Table + chart | Table for precise numbers, chart for trend visualization |
| Model granularity | Overall + per-model (Opus/Sonnet) | Separate model quotas may change independently |
| Projection disclaimer | None | Users understand this is an estimate |

## Data Model

### Snapshot File

Path: `~/.claude/quota-cycles-{machineName}.json`

```json
{
  "schemaVersion": 1,
  "machineName": "work-laptop",
  "currentCycle": {
    "resets_at": "2026-04-05T00:00:00Z",
    "start": "2026-03-29T00:00:00Z",
    "lastUpdated": "2026-03-29T12:45:30Z",
    "overall": {
      "utilization": 62.1,
      "actualTokens": 18500000,
      "projectedTokensAt100": 29791000,
      "actualCost": 12.50,
      "projectedCostAt100": 20.13
    },
    "models": {
      "opus": {
        "utilization": 30.5,
        "actualTokens": 5200000,
        "projectedTokensAt100": 17049180,
        "actualCost": 8.10,
        "projectedCostAt100": 26.56
      },
      "sonnet": {
        "utilization": 50.3,
        "actualTokens": 13300000,
        "projectedTokensAt100": 26440000,
        "actualCost": 4.40,
        "projectedCostAt100": 8.75
      }
    }
  },
  "history": [
    {
      "resets_at": "2026-03-29T00:00:00Z",
      "start": "2026-03-22T00:00:00Z",
      "overall": { "utilization": 85.0, "actualTokens": 25000000, "projectedTokensAt100": 29411764, "actualCost": 18.20, "projectedCostAt100": 21.41 },
      "models": {
        "opus": { "utilization": 70.0, "actualTokens": 10000000, "projectedTokensAt100": 14285714, "actualCost": 12.00, "projectedCostAt100": 17.14 },
        "sonnet": { "utilization": 80.0, "actualTokens": 15000000, "projectedTokensAt100": 18750000, "actualCost": 6.20, "projectedCostAt100": 7.75 }
      }
    }
  ]
}
```

### Token Definition

`actualTokens` is the sum of all token types for a given scope: `input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens`. This matches the total throughput visible to the user, even though Anthropic's internal quota accounting may weight token types differently.

### Derived Fields

- `start` is always computed as `resets_at - 7 days` (Anthropic uses 7-day rolling windows)
- `daysElapsed` (API response only) is computed as `now - start` in fractional days

### Projection Formula

```
projectedTokensAt100 = actualTokens / (utilization / 100)
projectedCostAt100   = actualCost   / (utilization / 100)
```

Where `utilization` comes from the Anthropic API quota response. Field names use `At100` suffix consistently across storage and API to clarify these are 100%-utilization projections.

**Guard: utilization = 0%** — When utilization is 0 (no usage recorded by API yet), projections are set to `null`. The frontend renders this as "—" instead of a number.

## Server API

### New Endpoint: `GET /api/quota-cycles`

No query parameters. Returns all recorded cycle data (merged across machines if applicable).

Response:

```json
{
  "currentCycle": {
    "resets_at": "2026-04-05T00:00:00Z",
    "start": "2026-03-29T00:00:00Z",
    "daysElapsed": 0.5,
    "daysTotal": 7,
    "overall": {
      "utilization": 62.1,
      "actualTokens": 18500000,
      "projectedTokensAt100": 29791000,
      "actualCost": 12.50,
      "projectedCostAt100": 20.13
    },
    "models": {
      "opus": { "utilization": 30.5, "actualTokens": 5200000, "projectedTokensAt100": 17049180, "actualCost": 8.10, "projectedCostAt100": 26.56 },
      "sonnet": { "utilization": 50.3, "actualTokens": 13300000, "projectedTokensAt100": 26440000, "actualCost": 4.40, "projectedCostAt100": 8.75 }
    }
  },
  "history": [
    {
      "resets_at": "2026-03-29T00:00:00Z",
      "start": "2026-03-22T00:00:00Z",
      "overall": { "utilization": 85.0, "actualTokens": 25000000, "projectedTokensAt100": 29411764, "actualCost": 18.20, "projectedCostAt100": 21.41 },
      "models": { "...": "..." }
    }
  ],
  "machines": ["work-laptop", "home-desktop"]
}
```

### Snapshot Update Hook

The existing `/api/quota` handler calls `updateQuotaCycleSnapshot()` after each successful quota fetch (~120s interval). This function:

1. Reads the snapshot file (or creates it if missing)
2. Filters `allRecords[]` by current cycle date range, groups by model
3. Detects cycle switch: new `resets_at` !== stored `resets_at` → moves `currentCycle` to `history`
4. Writes updated snapshot

## New Module: `server/quota-cycles.js`

### `updateQuotaCycleSnapshot(quotaData, allRecords, machineName)`

Called by `/api/quota` handler after successful quota fetch. **Only runs when `quotaData.available === true`** — skipped entirely if quota API is unavailable (no credentials configured).

- Filters records within `[start, resets_at)` of current cycle **and** by `machineName` (each machine only counts its own records to prevent double-counting when `--sync-dir` merges all machines' logs into `allRecords`)
- Groups by model, sums tokens and costs
- Computes projections using utilization from `quotaData` (sets to `null` when utilization is 0)
- Detects cycle boundary change and archives to history
- Writes to `~/.claude/quota-cycles-{machineName}.json`

### `loadQuotaCycles(machineName, syncDir?)`

Called by `/api/quota-cycles` endpoint.

- Reads local machine's file
- If `syncDir` provided, scans for all `quota-cycles-*.json` files
- Multi-machine merge: same `resets_at` cycles get `actualTokens`/`actualCost` summed, `utilization` taken from most recently updated machine, projections recalculated
- Returns `{ currentCycle, history, machines }`

### Edge Cases

| Scenario | Handling |
|----------|----------|
| First run, no snapshot | Created on first `updateQuotaCycleSnapshot` call; history is empty |
| Dashboard offline during cycle switch | Next startup detects changed `resets_at`, archives old `currentCycle` with its last-known data |
| Multi-machine utilization time skew | Use `lastUpdated` most recent machine's utilization |
| Multi-machine token counting | Each machine only counts its own records (filtered by `machineName`); `loadQuotaCycles` sums across machines |
| History growth | Cap at 52 cycles (~1 year), drop oldest |
| Quota API unavailable | `updateQuotaCycleSnapshot` is not called; `/api/quota-cycles` returns whatever is already on disk (may be empty) |
| Utilization is 0% | Projections set to `null`; frontend renders "—" |
| Haiku or other models | Included in `overall` totals; not tracked in `models` breakdown (no per-model utilization from API) |

## Frontend

### Current Cycle Token Projection Cards

Positioned near existing quota gauges. Three cards:

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Total at 100%  │  │  Opus at 100%   │  │  Sonnet at 100% │
│   29.8M tokens  │  │   17.0M tokens  │  │   26.4M tokens  │
│  (actual: 18.5M)│  │  (actual: 5.2M) │  │  (actual: 13.3M)│
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### History Chart (D3)

Bar chart below the cards:
- X-axis: cycle date ranges (e.g., `3/22 - 3/29`)
- Each cycle shows two bars: solid = actual tokens, semi-transparent = projected at 100%
- Dropdown to switch between Overall / Opus / Sonnet views

### History Table

Below the chart:

| Cycle | Utilization | Actual Tokens | Projected at 100% | Actual Cost | Projected Cost | Δ vs Prev |
|-------|------------|---------------|-------------------|-------------|----------------|-----------|
| 3/22 – 3/29 | 85.0% | 25.0M | 29.4M | $18.20 | $21.41 | +5.8% |
| 3/15 – 3/22 | 72.3% | 20.1M | 27.8M | $14.50 | $20.05 | — |

- `Δ vs Prev`: percentage change in `projectedTokensAt100` vs the chronologically previous cycle — the key metric for detecting quota changes
- Oldest cycle shows "—" (no predecessor to compare against)
- Negative values in red (quota may have decreased), positive in green
- Sorted newest-first

### New Files

| File | Purpose |
|------|---------|
| `public/js/charts/quota-cycles.js` | D3 bar chart + table rendering |

### Modified Files

| File | Change |
|------|--------|
| `server/routes/api.js` | Add `/api/quota-cycles` endpoint; hook `updateQuotaCycleSnapshot()` into `/api/quota` handler |
| `public/js/app.js` | Add `loadQuotaCycles()` to `loadAll()` flow; add quota cycles section container |
| `public/js/api.js` | Add `fetchQuotaCycles()` wrapper |
| `public/index.html` | Add DOM structure for token projection cards + history section |

### Unaffected Files

- `parser.js`, `aggregator.js`, `pricing.js` — no changes
- All 6 existing chart modules — no changes
- `bin/cli.cjs` — no changes
- `sync.js` — no changes (snapshot files are naturally handled by sync)

## Testing

New test file: `test/quota-cycles.test.js`

Key test cases:
- Snapshot creation on first run
- Cycle switch detection and history archival
- Token/cost calculation from records
- Projection formula accuracy
- Multi-machine merge logic
- History cap at 52 entries
- Edge case: dashboard offline during cycle switch
