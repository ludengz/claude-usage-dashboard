# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A dashboard that visualizes Claude Code usage by parsing JSONL session logs from `~/.claude/projects/`. It shows token usage, cost estimates, cache efficiency, and per-project/model/session breakdowns.

## Commands

- **Start server:** `npm start` (defaults to http://localhost:3000; if that port is unusable it falls back through 8080 → 8765 → an OS-assigned port and prints the actual URL. Windows Hyper-V/WSL "excluded port ranges" frequently cover 3000 and shift across reboots — see the startup warning if this happens)
- **Custom port:** `PORT=8080 npm start` (an explicitly set PORT never falls back; it fails fast with a clear error)
- **Run as npx package:** `npx claude-usage-dashboard`
- **Run all tests:** `npm test`
- **Run single test:** `npx mocha test/parser.test.js --timeout 5000`
- **Test framework:** Mocha + Chai (expect style). API tests spin up a real Express server with a temp JSONL fixture directory. Test files: `parser`, `pricing`, `aggregator`, `api`.

## Architecture

**ES modules throughout** (`"type": "module"` in package.json). No build step — the frontend uses native ES module imports via `<script type="module">`.

### CLI (`bin/cli.cjs`)

npm package entry point (CJS). Uses `spawnSync` to run `server/index.js` as a child process with `stdio: 'inherit'`. **Must use `spawnSync`** — async `spawn()` or dynamic `import()` causes the parent process to exit on Windows, making npx return to the shell prompt while the server runs orphaned in the background.

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
- Logs are re-parsed on demand with a 5s TTL cache plus a per-file mtime/size parse cache — only changed files are re-read. New data appears without a server restart.
- All cost calculations happen server-side in `pricing.js`. The frontend displays pre-computed values.
- Date filtering and time bucketing use local timezone (not UTC).
- The `/api/sessions` endpoint supports server-side pagination (`page`, `limit` params).
- All API endpoints accept `from`, `to`, `project`, and `model` query params for filtering.

## Pre-publish Checklist

Before every `npm publish`, verify:

1. **`npm test`** — all tests pass
2. **npx foreground test** — run `npm pack`, install the tarball in a temp dir, run `npx claude-usage-dashboard`, and confirm the process stays in the foreground (parent PID stays alive, shell prompt does NOT return). This catches regressions in `bin/cli.cjs` where async patterns (`spawn()`, `import()`) let the parent exit on Windows.
