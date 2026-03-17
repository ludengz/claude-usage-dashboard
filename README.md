# Claude Usage Dashboard

[![npm version](https://img.shields.io/npm/v/claude-usage-dashboard)](https://www.npmjs.com/package/claude-usage-dashboard)

A self-hosted dashboard that visualizes your [Claude Code](https://claude.ai/code) usage by parsing local JSONL session logs from `~/.claude/projects/`.

![Dashboard Screenshot](docs/screenshots/dashboard.png)

## Features

- **Token tracking** — Total tokens with breakdown by input, output, cache read, and cache write
- **Cost estimation** — API cost equivalent at standard pricing, compared against your subscription plan (Pro / Max 5x / Max 20x)
- **Subscription quota** — Real-time utilization gauges (5-hour, 7-day, per-model) pulled from the Anthropic API with auto-detection of your plan tier
- **Token consumption trend** — Stacked bar chart with hourly, daily, weekly, or monthly granularity
- **Model distribution** — Donut chart showing usage across Claude models
- **Cache efficiency** — Visual breakdown of cache read, cache creation, and uncached requests
- **Project distribution** — Horizontal bar chart comparing token usage across projects
- **Session details** — Sortable, paginated table of every session with cost and duration
- **Auto-refresh** — Dashboard polls every 30s for new usage data; quota refreshes every 2 minutes

## Quick Start

Run directly without installing:

```bash
npx claude-usage-dashboard
```

Open http://localhost:3000 in your browser.

### From Source

```bash
git clone https://github.com/ludengz/claudeUsageDashboard.git
cd claudeUsageDashboard
npm install
npm start
```

### Custom Port

```bash
PORT=8080 npx claude-usage-dashboard
```

## How It Works

The dashboard reads Claude Code session logs from `~/.claude/projects/` — if you use Claude Code, these already exist on your machine. Logs are automatically re-read every 5 seconds, and new usage appears without restarting the server.

Subscription quota data is fetched from the Anthropic API using your local OAuth credentials (`~/.claude/.credentials.json`). Your plan tier (Pro / Max 5x / Max 20x) is auto-detected from the same file.

## Tech Stack

- **Backend:** Node.js, Express 5
- **Frontend:** Vanilla JS (ES modules), D3.js v7
- **Tests:** Mocha + Chai

## Running Tests

```bash
npm test
```

## License

ISC
