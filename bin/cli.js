#!/usr/bin/env node
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(__dirname, '..', 'server', 'index.js');

const child = spawn(process.execPath, [server], {
  stdio: 'inherit',
  // Attach child to the terminal's foreground process group
  detached: false,
});

child.on('exit', (code) => process.exit(code ?? 0));

// Forward signals to child
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
