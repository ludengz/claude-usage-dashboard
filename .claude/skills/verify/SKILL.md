---
name: verify
description: How to end-to-end verify claude-usage-dashboard changes — isolated server instance, fixture injection without touching real logs, Playwright checks
---

# Verifying claude-usage-dashboard changes

## Launch an isolated server instance

The sandbox blocks in-process listeners — start the server detached via
`Start-Process`. Port 3000 is often inside a Windows excluded port range;
8080 is known-safe. An explicit `PORT` fails fast instead of falling back.

```powershell
$env:PORT = "8080"
$env:CLAUDE_DASH_SYNC_DIR = "<scratch>\sync-verify"   # see fixture injection below
$env:CLAUDE_DASH_MACHINE_NAME = "verify-local"
Start-Process -FilePath node -ArgumentList "server/index.js" `
  -WorkingDirectory <repo> -WindowStyle Hidden `
  -RedirectStandardOutput "<scratch>\server-out.log" -RedirectStandardError "<scratch>\server-err.log" -PassThru
```

Poll `server-out.log` for `running at` (startup sync of real logs takes up to
~60s the first time). Kill by PID and delete the temp sync dir when done.

## Fixture injection without touching real logs

`LOG_DIR` is hardcoded to `~/.claude/projects`, but when `CLAUDE_DASH_SYNC_DIR`
is set the server *reads* from that dir instead (multi-machine layout:
`<syncDir>/<machine>/<project-dir>/<session>.jsonl`). So:

1. Point `CLAUDE_DASH_SYNC_DIR` at a temp dir — startup sync copies real logs
   into `<temp>/verify-local/` (real data appears in the UI for free).
2. Drop synthetic records under a second "machine" dir, e.g.
   `<temp>/synthetic-box/-Users-test-Workspace-myfixture/sess.jsonl`.

Minimal parseable record (one JSONL line):

```json
{"type":"assistant","sessionId":"s1","timestamp":"2026-07-05T08:00:00.000Z","message":{"id":"msg_1","model":"claude-sonnet-5","usage":{"input_tokens":500000,"output_tokens":200000,"cache_read_input_tokens":1000000,"cache_creation_input_tokens":400000}}}
```

Records are deduped by `message.id` (largest `output_tokens` wins) — give each
synthetic record a distinct id.

## Driving the UI (Playwright MCP)

- Default date range is the current quota cycle (~7 days) — older records won't
  show. Widen it by setting the first date input's value and dispatching a
  bubbling `change` event.
- Model distribution legend entries match `/— \d+.?\d*%$/`; slice colors are
  `svg path[fill]`; session-table model tags are `.tag[class*="tag-model-"]`.
- Cross-check numbers against the API from the page:
  `fetch('/api/cost?from=...&to=...&model=<id>')` → `api_equivalent_cost_usd`.
- Logs re-parse with a 5s TTL + per-file mtime/size cache, so fixture edits
  show up without a restart (wait >5s or hit refresh).
