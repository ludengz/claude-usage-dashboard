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

app.listen(PORT, () => {
  console.log(`Claude Usage Report running at http://localhost:${PORT}`);
});
