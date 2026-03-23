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

const serverPath = join(__dirname, '..', 'server', 'index.js');
const result = spawnSync(process.execPath, [serverPath], { stdio: 'inherit' });
process.exit(result.status || 0);
