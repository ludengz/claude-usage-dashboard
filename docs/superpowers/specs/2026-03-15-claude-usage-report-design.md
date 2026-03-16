# Claude Usage Report — Design Spec

## Overview

A local web application that parses Claude Code session logs and visualizes token consumption, cost estimation, and usage patterns through interactive D3.js charts. Subscription users (Pro, Max 5x, Max 20x) can see their total token usage and the equivalent US dollar cost at standard API pricing, broken down by hourly, daily, weekly, and monthly granularity.

## Architecture

**Stack:** Express.js backend + Vanilla JS SPA frontend + D3.js visualizations

**Data Source:** Claude Code local log files at `~/.claude/projects/*/` (`.jsonl` format)

```
claudeUsageReport/
├── server/
│   ├── index.js              # Express entry point, starts server
│   ├── parser.js             # Parses ~/.claude/ JSONL log files
│   ├── aggregator.js         # Aggregates token data by time granularity
│   ├── pricing.js            # Built-in model pricing table + cost calculation
│   └── routes/
│       └── api.js            # REST API routes
├── public/
│   ├── index.html            # SPA entry page
│   ├── css/
│   │   └── style.css         # Dark theme styles
│   └── js/
│       ├── app.js            # Main controller, routing, state management
│       ├── api.js            # Backend API client
│       ├── charts/
│       │   ├── token-trend.js        # Token consumption area chart
│       │   ├── cost-comparison.js    # Subscription vs API cost bar chart
│       │   ├── model-distribution.js # Model usage donut chart
│       │   ├── project-distribution.js # Project usage horizontal bar chart
│       │   ├── session-stats.js      # Session cost table
│       │   └── cache-efficiency.js   # Cache hit rate progress bars
│       └── components/
│           ├── date-picker.js        # Date range selector
│           └── plan-selector.js      # Subscription plan selector
└── package.json
```

## Data Source: Log File Format

Each `.jsonl` file in `~/.claude/projects/<encoded-project-path>/` contains conversation entries. The relevant records are `type: "assistant"` entries with this structure:

```json
{
  "type": "assistant",
  "sessionId": "uuid",
  "timestamp": "2026-03-10T02:36:23.894Z",
  "cwd": "/Users/.../project-name",
  "message": {
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 8407,
      "cache_read_input_tokens": 6490,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 8407,
        "ephemeral_1h_input_tokens": 0
      },
      "output_tokens": 0,
      "service_tier": "standard",
      "inference_geo": "global"
    }
  }
}
```

**Fields captured:** `message.model`, `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`, `timestamp`, `sessionId`.

**Fields ignored:** `usage.cache_creation.ephemeral_*` (treated as a single cache write rate — Anthropic currently prices both tiers the same), `usage.service_tier`, `usage.inference_geo`, `server_tool_use`.

**Special model values:** Records with `model: "<synthetic>"` are internal system messages and are excluded from both token counts and cost calculations.

**Parsing logic:**
- Scan all `~/.claude/projects/*/` directories for `.jsonl` files
- Derive project name from directory name (e.g., `-Users-ludengzhao-Workspace-passionfruit` → `passionfruit`, taking the last path segment)
- Extract only `type: "assistant"` records, skip `model: "<synthetic>"`
- Pull `message.model`, `message.usage`, `timestamp`, and `sessionId` from each record
- Group records by `sessionId` to form sessions

## Backend API

### `GET /api/usage`

Aggregated token data over time.

**Query params:**
- `from` (ISO date, e.g. `2026-03-01`) — start of range (inclusive, treated as start of day UTC)
- `to` (ISO date, e.g. `2026-03-15`) — end of range (inclusive, treated as end of day UTC)
- `granularity` — `hourly | daily | weekly | monthly` (auto-selected if omitted, based on range span: ≤2 days→hourly, ≤14 days→daily, ≤60 days→weekly, else monthly)
- `project` (optional) — filter by project name
- `model` (optional) — filter by model

**Response:**
```json
{
  "granularity": "daily",
  "buckets": [
    {
      "time": "2026-03-10",
      "input_tokens": 125000,
      "output_tokens": 45000,
      "cache_read_tokens": 80000,
      "cache_creation_tokens": 30000,
      "models": {
        "claude-sonnet-4-6": { "input": 100000, "output": 35000 },
        "claude-opus-4-6": { "input": 25000, "output": 10000 }
      }
    }
  ],
  "total": {
    "input_tokens": 1250000,
    "output_tokens": 450000,
    "cache_read_tokens": 800000,
    "cache_creation_tokens": 300000,
    "estimated_api_cost_usd": 28.50
  }
}
```

### `GET /api/models`

All detected models with their pricing info.

**Query params:**
- `from`, `to` (optional) — date range filter (same format as `/api/usage`)

**Response:**
```json
{
  "models": [
    {
      "id": "claude-opus-4-6",
      "input_price_per_mtok": 15.0,
      "output_price_per_mtok": 75.0,
      "cache_read_price_per_mtok": 1.5,
      "cache_creation_price_per_mtok": 18.75,
      "total_tokens": 500000
    }
  ]
}
```

### `GET /api/projects`

All projects with token totals.

**Query params:**
- `from`, `to` (optional) — date range filter (same format as `/api/usage`)

**Response:**
```json
{
  "projects": [
    {
      "name": "passionfruit",
      "path": "/Users/ludengzhao/Workspace/passionfruit",
      "total_input_tokens": 800000,
      "total_output_tokens": 200000,
      "total_tokens": 1000000,
      "estimated_cost_usd": 15.20,
      "session_count": 25
    }
  ]
}
```

### `GET /api/sessions`

Per-session breakdown with cost.

**Query params:**
- `from`, `to` — date range filter
- `project` (optional) — filter by project
- `sort` — `date | cost | tokens` (default: `date`)
- `order` — `asc | desc` (default: `desc`)
- `page`, `limit` — pagination (default: page=1, limit=20)

**Response:**
```json
{
  "sessions": [
    {
      "sessionId": "uuid",
      "project": "passionfruit",
      "startTime": "2026-03-15T14:32:00Z",
      "endTime": "2026-03-15T15:44:00Z",
      "duration_minutes": 72,
      "models": ["claude-opus-4-6"],
      "input_tokens": 285000,
      "output_tokens": 42000,
      "cache_read_tokens": 180000,
      "cache_creation_tokens": 25000,
      "total_tokens": 327000,
      "estimated_cost_usd": 8.45
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total_sessions": 42,
    "total_pages": 3
  },
  "totals": {
    "total_tokens": 2400000,
    "estimated_cost_usd": 48.20
  }
}
```

### `GET /api/cost`

Cost comparison: subscription vs API pricing.

**Query params:**
- `from`, `to` — date range
- `plan` — `pro | max5x | max20x`
- `customPrice` (optional) — override subscription price in USD

**Response:**
```json
{
  "plan": "max5x",
  "subscription_cost_usd": 100.00,
  "api_equivalent_cost_usd": 148.20,
  "savings_usd": 48.20,
  "savings_percent": 32.5,
  "cost_per_day": [
    { "date": "2026-03-10", "api_cost": 12.30, "subscription_daily": 3.33 }
  ],
  "note": "subscription_daily = monthly price / days in that calendar month (e.g. $100/31 for March). For ranges spanning multiple months, each day uses its own month's divisor."
}
```

### `GET /api/cache`

Cache efficiency statistics.

**Query params:**
- `from`, `to` — date range

**Response:**
```json
{
  "cache_read_tokens": 800000,
  "cache_creation_tokens": 300000,
  "non_cached_input_tokens": 150000,
  "total_input_tokens": 1250000,
  "cache_read_rate": 0.64,
  "cache_creation_rate": 0.24,
  "no_cache_rate": 0.12
}
```

## Pricing Table

Built-in model pricing (per million tokens, USD):

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| claude-opus-4-6 | $15.00 | $75.00 | $1.50 | $18.75 |
| claude-sonnet-4-6 | $3.00 | $15.00 | $0.30 | $3.75 |
| claude-haiku-4-5 | $0.80 | $4.00 | $0.08 | $1.00 |

Subscription plan defaults:

| Plan | Monthly Price |
|------|--------------|
| Pro | $20 |
| Max 5x | $100 |
| Max 20x | $200 |

Users can override subscription prices via the plan selector UI.

Unknown models encountered in logs are flagged with "unknown pricing" and excluded from cost calculations.

**Token counting convention:** `input_tokens` from the API already includes cache tokens. To avoid double-counting, `total_tokens` is defined as `input_tokens + output_tokens`. Cache fields (`cache_read_tokens`, `cache_creation_tokens`) are reported separately for analysis but are a breakdown of the input, not additive.

## Frontend Design

### Layout

Dark theme dashboard (background `#0f172a`) with the following sections top-to-bottom:

1. **Top bar** — App title, date range picker (calendar-based), subscription plan dropdown with editable price
2. **Summary cards row** (4 cards) — Total Tokens, API Equivalent Cost, Savings Amount, Cache Hit Rate. Each card shows the metric value and a comparison indicator.
3. **Token consumption trend** (full-width area chart) — Stacked area for input vs output tokens over time. Granularity toggle buttons (Hourly/Daily/Weekly/Monthly) with auto-selection based on date range. Tooltip on hover showing exact values.
4. **Second row** (3 equal columns):
   - Cost comparison bar chart — subscription vs API cost side by side
   - Model distribution donut chart — percentage of tokens by model
   - Cache efficiency — horizontal progress bars for cache read / creation / uncached
5. **Project distribution** (full-width horizontal bar chart) — Each project as a bar, sorted by total tokens
6. **Session cost table** (full-width) — Sortable, filterable, paginated table with columns: Date, Project, Model(s), Input tokens, Output tokens, Cache Read tokens, Cache Creation tokens, Total tokens, API Cost, Duration. Footer row with totals. Project filter search box, sort dropdown.

### Interactions

- **Date range picker** changes trigger all charts and the session table to reload via API calls
- **Granularity toggle** on the trend chart re-fetches `/api/usage` with the selected granularity
- **Plan selector** changes re-fetch `/api/cost` and update savings card
- **Session table** sorting, filtering, and pagination are all server-side via `/api/sessions` query params. Column header clicks and filter changes trigger new API requests.
- **Chart tooltips** on hover for all D3 charts showing exact values

### D3 Charts

All charts rendered with D3.js v7 (installed as npm dependency and served from `node_modules` via Express static middleware, so the app works fully offline). Each chart is a standalone module in `public/js/charts/` that exports a `render(container, data)` function and handles its own scales, axes, transitions, and tooltips.

## Data Flow

1. User opens `http://localhost:3000` (port configurable via `PORT` env var, default 3000)
2. `app.js` initializes: loads default date range (last 30 days), fetches all API endpoints in parallel
3. API responses populate summary cards and render D3 charts
4. User changes date range → all endpoints re-fetched → charts re-rendered with transitions
5. User changes plan → `/api/cost` re-fetched → cost comparison and savings card updated
6. Session table sort/filter/page changes → `/api/sessions` re-fetched → table re-rendered

## Error Handling

- If `~/.claude/` directory not found: show friendly error page with instructions
- If no `.jsonl` files found: show empty state with "No session data found"
- Unknown models: display in charts with "unknown" label, exclude from cost calculations
- Malformed log entries: skip silently, log warning to server console

**API error response format:**
```json
{
  "error": "Description of what went wrong",
  "code": "NO_DATA | PARSE_ERROR | INVALID_PARAMS"
}
```
HTTP status codes: 400 for invalid params, 404 for no data directory, 500 for parse failures.
