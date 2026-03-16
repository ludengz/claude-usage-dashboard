import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createApiRouter } from '../server/routes/api.js';

let app, server, baseUrl, tmpDir;

before((done) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
  const projectDir = path.join(tmpDir, '-Users-test-Workspace-testproject');
  fs.mkdirSync(projectDir);
  const logFile = path.join(projectDir, 'sess.jsonl');
  const lines = [
    JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T10:00:00.000Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 } } }),
    JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T11:00:00.000Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 2000, output_tokens: 800, cache_creation_input_tokens: 300, cache_read_input_tokens: 400 } } }),
  ];
  fs.writeFileSync(logFile, lines.join('\n'));
  app = express();
  app.use('/api', createApiRouter(tmpDir));
  server = app.listen(0, () => { baseUrl = `http://localhost:${server.address().port}`; done(); });
});

after((done) => { server.close(() => { fs.rmSync(tmpDir, { recursive: true }); done(); }); });

async function fetchJson(path) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, data: await res.json() };
}

describe('GET /api/usage', () => {
  it('returns aggregated buckets', async () => {
    const { status, data } = await fetchJson('/api/usage?from=2026-03-10&to=2026-03-10&granularity=daily');
    expect(status).to.equal(200);
    expect(data.granularity).to.equal('daily');
    expect(data.buckets).to.have.length(1);
    expect(data.buckets[0].input_tokens).to.equal(3000);
    expect(data.total.input_tokens).to.equal(3000);
    expect(data.total.estimated_api_cost_usd).to.be.a('number');
  });
});

describe('GET /api/models', () => {
  it('returns detected models with pricing', async () => {
    const { data } = await fetchJson('/api/models');
    expect(data.models).to.have.length(1);
    expect(data.models[0].id).to.equal('claude-sonnet-4-6');
    expect(data.models[0].input_price_per_mtok).to.equal(3);
  });
});

describe('GET /api/projects', () => {
  it('returns projects with totals', async () => {
    const { data } = await fetchJson('/api/projects');
    expect(data.projects).to.have.length(1);
    expect(data.projects[0].name).to.equal('testproject');
    expect(data.projects[0].total_tokens).to.equal(4300);
  });
});

describe('GET /api/sessions', () => {
  it('returns session list with pagination', async () => {
    const { data } = await fetchJson('/api/sessions?from=2026-03-10&to=2026-03-10');
    expect(data.sessions).to.have.length(1);
    expect(data.sessions[0].sessionId).to.equal('s1');
    expect(data.sessions[0].total_tokens).to.equal(4300);
    expect(data.pagination.total_sessions).to.equal(1);
  });
});

describe('GET /api/cost', () => {
  it('returns cost comparison', async () => {
    const { data } = await fetchJson('/api/cost?from=2026-03-10&to=2026-03-10&plan=max5x');
    expect(data.plan).to.equal('max5x');
    expect(data.subscription_cost_usd).to.equal(100);
    expect(data.api_equivalent_cost_usd).to.be.a('number');
    expect(data.savings_usd).to.be.a('number');
  });
});

describe('GET /api/cache', () => {
  it('returns cache stats', async () => {
    const { data } = await fetchJson('/api/cache?from=2026-03-10&to=2026-03-10');
    expect(data.total_input_tokens).to.equal(3000);
    expect(data.cache_read_tokens).to.equal(600);
    expect(data.cache_read_rate).to.be.a('number');
  });
});
