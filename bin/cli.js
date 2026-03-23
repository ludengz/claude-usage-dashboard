#!/usr/bin/env node
import path from 'path';

// Parse CLI args before importing server
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sync-dir' && args[i + 1]) {
    process.env.CLAUDE_DASH_SYNC_DIR = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--machine-name' && args[i + 1]) {
    process.env.CLAUDE_DASH_MACHINE_NAME = args[i + 1];
    i++;
  }
}

await import('../server/index.js');
