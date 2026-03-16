import express from 'express';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createApiRouter } from './routes/api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const LOG_DIR = path.join(os.homedir(), '.claude', 'projects');

const app = express();
app.use('/lib/d3', express.static(path.join(__dirname, '..', 'node_modules', 'd3', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', createApiRouter(LOG_DIR));

const server = app.listen(PORT, () => {
  console.log(`Claude Usage Dashboard running at http://localhost:${PORT}`);
  console.log('Press Ctrl+C to stop.');
});

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
