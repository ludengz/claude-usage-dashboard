import express from 'express';
import net from 'net';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { createApiRouter } from './routes/api.js';
import { syncLocalToShared } from './sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PORT = process.env.PORT || 3000;
// When the user did not pick a port, fall back through candidates: Windows
// (Hyper-V/WSL) dynamically reserves port ranges that shift across reboots,
// so the default 3000 can fail with EACCES on one boot and work on the next.
// Port 0 (OS-assigned) is the final candidate and always succeeds.
const PORT_CANDIDATES = process.env.PORT ? [Number(PORT)] : [3000, 8080, 8765, 0];
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

// Track connections so we can destroy them on shutdown
const connections = new Set();
let server = null;

/**
 * Verify the bound port actually accepts connections. On Windows, binding a
 * port inside an excluded range can appear to succeed (the 'listening' event
 * fires) while connections are refused and the process later exits silently.
 */
function selfCheck(port) {
  return new Promise((resolveCheck) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (ok) => { sock.destroy(); resolveCheck(ok); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(3000, () => done(false));
  });
}

function portHint(code, port) {
  if (code === 'EADDRINUSE') return `port ${port} is already in use`;
  if (code === 'EACCES' && process.platform === 'win32') {
    return `port ${port} is blocked — likely inside a Windows excluded port range ` +
      `(run "netsh interface ipv4 show excludedportrange protocol=tcp"); these ranges shift across reboots`;
  }
  return `port ${port} is not usable (${code})`;
}

function startServer(candidates) {
  const port = candidates[0];
  const rest = candidates.slice(1);
  const s = app.listen(port);

  s.on('connection', (conn) => {
    connections.add(conn);
    conn.on('close', () => connections.delete(conn));
  });

  s.on('error', (err) => {
    console.warn(`Cannot start: ${portHint(err.code, port)}.`);
    if (rest.length > 0) {
      console.warn(`Retrying on port ${rest[0] === 0 ? 'auto-assigned by OS' : rest[0]}...`);
      startServer(rest);
    } else {
      console.error('No usable port found. Set PORT to a free port and retry.');
      process.exit(1);
    }
  });

  s.on('listening', async () => {
    const actualPort = s.address().port;
    const reachable = await selfCheck(actualPort);
    if (!reachable && rest.length > 0) {
      console.warn(`Port ${actualPort} bound but refuses connections (Windows excluded port range?). Retrying on ${rest[0] === 0 ? 'an OS-assigned port' : rest[0]}...`);
      s.close();
      startServer(rest);
      return;
    }
    server = s;
    console.log(`Claude Usage Dashboard running at http://localhost:${actualPort}`);
    if (SYNC_DIR) {
      console.log(`Sync mode: reading from ${SYNC_DIR} (machine: ${MACHINE_NAME})`);
    }
    console.log('Press Ctrl+C to stop.');
  });

  return s;
}

startServer(PORT_CANDIDATES);

function shutdown() {
  console.log('\nShutting down...');
  for (const conn of connections) conn.destroy();
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
