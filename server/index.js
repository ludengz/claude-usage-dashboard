import express from 'express';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { createApiRouter } from './routes/api.js';
import { syncLocalToShared } from './sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = process.env.PORT || 3000;
const LOG_DIR = path.join(os.homedir(), '.claude', 'projects');
const SYNC_DIR = process.env.CLAUDE_DASH_SYNC_DIR || null;
const MACHINE_NAME = process.env.CLAUDE_DASH_MACHINE_NAME || os.hostname();

// Startup sync
if (SYNC_DIR) {
  console.log(`Syncing local data to shared folder: ${SYNC_DIR} (machine: ${MACHINE_NAME})`);
  await syncLocalToShared(LOG_DIR, SYNC_DIR, MACHINE_NAME);
}

// Resolve d3 via Node module resolution so it works when dependencies are hoisted (e.g. npx)
const d3Dir = path.join(path.dirname(require.resolve('d3')), '..', 'dist');

const app = express();
app.use('/lib/d3', express.static(d3Dir));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', createApiRouter(LOG_DIR, { syncDir: SYNC_DIR, machineName: MACHINE_NAME }));

const server = app.listen(PORT, () => {
  console.log(`Claude Usage Dashboard running at http://localhost:${PORT}`);
  if (SYNC_DIR) {
    console.log(`Sync mode: reading from ${SYNC_DIR} (machine: ${MACHINE_NAME})`);
  }
  console.log('Press Ctrl+C to stop.');
});

// Track connections so we can destroy them on shutdown
const connections = new Set();
server.on('connection', (conn) => {
  connections.add(conn);
  conn.on('close', () => connections.delete(conn));
});

function shutdown() {
  console.log('\nShutting down...');
  for (const conn of connections) conn.destroy();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
