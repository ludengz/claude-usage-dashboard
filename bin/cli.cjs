#!/usr/bin/env node
'use strict';
const { join, resolve } = require('path');
const { spawnSync } = require('child_process');

// Parse CLI args before spawning server
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sync-dir' && args[i + 1]) {
    process.env.CLAUDE_DASH_SYNC_DIR = resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--machine-name' && args[i + 1]) {
    process.env.CLAUDE_DASH_MACHINE_NAME = args[i + 1];
    i++;
  }
}

// Ctrl+C delivers SIGINT (macOS) / CTRL_C_EVENT (Windows) to BOTH this wrapper
// and the server child. Without handlers the wrapper dies first with the default
// action, returning the shell prompt while the child is still shutting down
// (and orphaning it on some platforms). No-op handlers let the child own the
// graceful shutdown; spawnSync then returns its exit status.
process.on('SIGINT', () => {});
process.on('SIGTERM', () => {});

const serverPath = join(__dirname, '..', 'server', 'index.js');
const result = spawnSync(process.execPath, [serverPath], { stdio: 'inherit' });
if (result.error) {
  console.error('Failed to start server:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 0);
