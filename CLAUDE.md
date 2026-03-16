# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A dashboard that visualizes Claude Code usage by parsing JSONL session logs from `~/.claude/projects/`. It shows token usage, cost estimates, cache efficiency, and per-project/model/session breakdowns.

## Commands

- **Start server:** `npm start` (runs on http://localhost:3000)
- **Custom port:** `PORT=8080 npm start`
- **Run as npx package:** `npx claude-usage-dashboard`
- **Run all tests:** `npm test`
- **Run single test:** `npx mocha test/parser.test.js --timeout 5000`
- **Test framework:** Mocha + Chai (expect style). API tests spin up a real Express server with a temp JSONL fixture directory. Test files: `parser`, `pricing`, `aggregator`, `api`.

## Architecture

**ES modules throughout** (`"type": "module"` in package.json). No build step — the frontend uses native ES module imports via `<script type="module">`.

### CLI (`bin/cli.js`)

npm package entry point. Spawns the server as a child process with `stdio: 'inherit'` and forwards signals.

### Server (Express 5, `server/`)

- `index.js` — Mounts static files and API router. Serves d3 from node_modules.
- `parser.js` — Reads `~/.claude/projects/` JSONL files, extracts assistant messages with token usage. `deriveProjectName()` converts directory names (e.g., `-Users-foo-Workspace-myproject`) back to project names.
- `aggregator.js` — All aggregation logic: by time (with granularity: hourly/daily/weekly/monthly), session, project, model, and cache stats. Date filtering uses local timezone.
- `pricing.js` — Model pricing table (`MODEL_PRICING`) and `calculateRecordCost()`. Cost is computed server-side per-record. Plan subscription defaults (`PLAN_DEFAULTS`) for cost comparison.
- `routes/api.js` — Single router factory. Parses logs once at startup into `allRecords[]`, then filters/aggregates per request. Endpoints: `/api/usage`, `/api/models`, `/api/projects`, `/api/sessions`, `/api/cost`, `/api/cache`.

### Frontend (`public/`)

- `js/app.js` — Central state management and orchestration. Calls all 6 API endpoints in parallel via `loadAll()`, updates summary cards and charts.
- `js/api.js` — Thin fetch wrappers for each API endpoint.
- `js/charts/` — Each chart is a standalone module using D3 v7 (imported from `/lib/d3/d3.min.js`). Charts: `token-trend.js`, `cost-comparison.js`, `model-distribution.js`, `cache-efficiency.js`, `project-distribution.js`, `session-stats.js`.
- `js/components/` — `date-picker.js` (date range with presets), `plan-selector.js` (subscription plan toggle).

### Key Design Decisions

- D3 v7 is served from `node_modules/d3/dist/` via an Express static mount at `/lib/d3/`. Frontend imports use `/lib/d3/d3.min.js`.
- Logs are parsed once at server startup (no hot-reload). Restart server to pick up new data.
- All cost calculations happen server-side in `pricing.js`. The frontend displays pre-computed values.
- Date filtering and time bucketing use local timezone (not UTC).
- The `/api/sessions` endpoint supports server-side pagination (`page`, `limit` params).
- All API endpoints accept `from`, `to`, `project`, and `model` query params for filtering.
