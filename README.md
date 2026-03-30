# Claude Usage Dashboard

[![npm version](https://img.shields.io/npm/v/claude-usage-dashboard)](https://www.npmjs.com/package/claude-usage-dashboard)
[![npm downloads](https://img.shields.io/npm/dm/claude-usage-dashboard)](https://www.npmjs.com/package/claude-usage-dashboard)

> Find out what your Claude Code subscription is actually worth in API costs — and whether your quota is shrinking — across every machine you own.

Your $200/month Max plan might be consuming **$15,000+/month** in API-equivalent value. This dashboard shows you exactly how much — per project, per session, per model, and across all your machines in one unified view. It also tracks your 7-day quota cycles, projects token usage at full utilization, and keeps history so you can spot if your effective quota quietly changed. One command to start. Completely local.

```bash
npx claude-usage-dashboard
```

![Dashboard Screenshot](docs/screenshots/dashboard.png?v=2)

## What You'll See

### :computer: See Every Machine in One Place

Use Claude on a laptop, a desktop, and a work machine? Most dashboards only see the one they're running on. This one syncs across all of them.

Point it at any shared folder — Google Drive, Dropbox, OneDrive, a NAS, an rsync target — and every machine's logs roll up into one unified view. No server. No account. Just a folder you already have.

### :dollar: Know What You're Spending

Real-time projected API cost at your current usage rate — weekly and monthly. At 5% quota utilization, you might be burning through **$3,600/week** equivalent. The dashboard calculates this from your actual quota window, not estimates.

### :bar_chart: Track Your Quota in Real Time

Live utilization gauges for 5-hour, 7-day, and per-model quotas pulled directly from the Anthropic API. Auto-detects your plan tier (Pro / Max 5x / Max 20x). Never get throttled by surprise again.

### :chart_with_upwards_trend: Track Your Quota Across Cycles

Anthropic doesn't publish exact token limits, and those limits can change without notice. The Quota Cycle History section gives you a running record of each 7-day cycle so you can see exactly how much you got and whether it stayed consistent.

For each cycle, the dashboard projects what your full token quota would be at 100% utilization — broken down by Input, Output, Cache Read, Cache Write, and Total. A horizontal bar chart overlays actual vs. projected per cycle, and the history table highlights projected tokens and cost with a delta column showing the change versus the previous cycle.

That delta is the key signal: if your projected quota drops from one cycle to the next without you changing how you work, something changed on the platform side. Track your actual consumption week-over-week so you have real numbers when something feels off — not just a gut feeling. Up to 10 past cycles are retained across all your machines.

### :mag: Find What's Eating Your Tokens

Per-project and per-session cost breakdowns show exactly where your usage goes. Sortable session table with cost, duration, and full token breakdown. Spot the expensive sessions instantly.

### :zap: Understand Your Cache Efficiency

You'll probably discover that ~95% of your tokens are cache reads at 1/10th the cost. The dashboard visualizes cache read vs. cache write vs. uncached requests so you can see how efficiently Claude is using context.

### Everything Else

**Multi-machine sync** — aggregate usage across all your devices via a shared folder · **Quota cycle tracking** — monitors each 7-day reset window, projects usage at 100% utilization, logs history to detect quota changes · Hourly/daily/weekly/monthly token trends · Dollar and token toggle · Model distribution across Opus/Sonnet/Haiku · Active hours heatmap · Auto-refresh (30s) · Persistent filters via localStorage · Dark theme

## Quick Start

Run directly — no install, no config, no API keys needed:

```bash
npx claude-usage-dashboard
```

Open [localhost:3000](http://localhost:3000). That's it.

### From Source

```bash
git clone https://github.com/ludengz/claude-usage-dashboard.git
cd claude-usage-dashboard
npm install
npm start
```

### Custom Port

```bash
PORT=8080 npx claude-usage-dashboard
```

## Multi-Machine Sync

If you use Claude Code on more than one machine — a desktop and a laptop, a work Mac and a home PC — each one only sees its own logs. Sync solves this.

Set two environment variables on each machine, then start the dashboard normally:

```bash
# Add to your shell profile (~/.bashrc, ~/.zshrc, etc.) on each machine:
export CLAUDE_DASH_SYNC_DIR="$HOME/Google Drive/claude-sync"
export CLAUDE_DASH_MACHINE_NAME="MacBook"   # optional — defaults to hostname
```

On Windows, set them as user environment variables:

```powershell
[Environment]::SetEnvironmentVariable('CLAUDE_DASH_SYNC_DIR', 'C:\Users\you\Google Drive\claude-sync', 'User')
[Environment]::SetEnvironmentVariable('CLAUDE_DASH_MACHINE_NAME', 'Desktop', 'User')
```

Or pass them inline:

```bash
CLAUDE_DASH_SYNC_DIR="/path/to/shared" CLAUDE_DASH_MACHINE_NAME="MacBook" npx claude-usage-dashboard
```

On startup, local logs from `~/.claude/projects/` are copied into `<sync_dir>/<machine_name>/`. The dashboard then reads **all machine folders** in the sync directory, giving you a single aggregated view across every device. Usage re-syncs every 5 seconds.

**Works with any shared folder.** Google Drive, Dropbox, OneDrive, iCloud Drive, Syncthing, a NAS, or a plain rsync cronjob. No server, no account, no API key — just a folder that syncs between your machines.

## How It Works

Reads the JSONL session logs that Claude Code already writes to `~/.claude/projects/` on your machine. If you use Claude Code, the data is already there. Logs are re-read every 5 seconds — new usage appears without restarting.

When `CLAUDE_DASH_SYNC_DIR` is set, the dashboard copies local logs into `<sync_dir>/<machine_name>/` on startup and on every refresh. It then reads all machine subfolders in that directory — so any machine running the dashboard with the same sync folder contributes to the aggregate view.

Subscription quota data is fetched from the Anthropic API using your existing local OAuth credentials. Your plan tier is auto-detected.

## Running Tests

```bash
npm test
```

## License

ISC
