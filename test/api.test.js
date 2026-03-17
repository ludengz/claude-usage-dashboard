import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createApiRouter } from '../server/routes/api.js';

let app, server, baseUrl, tmpDir, projectDir;

before((done) => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-test-'));
  projectDir = path.join(tmpDir, '-Users-test-Workspace-testproject');
  fs.mkdirSync(projectDir);
  const logFile = path.join(projectDir, 'sess.jsonl');
  const lines = [
    JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T10:00:00.000Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 } } }),
    JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T11:00:00.000Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 2000, output_tokens: 800, cache_creation_input_tokens: 300, cache_read_input_tokens: 400 } } }),
  ];
  fs.writeFileSync(logFile, lines.join('\n'));
  app = express();
  app.use('/api', createApiRouter(tmpDir, { cacheTtlMs: 500 }));
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
    // total = input(3000) + output(1300) + cache_read(600) + cache_creation(400) = 5300
    expect(data.projects[0].total_tokens).to.equal(5300);
  });
});

describe('GET /api/sessions', () => {
  it('returns session list with pagination', async () => {
    const { data } = await fetchJson('/api/sessions?from=2026-03-10&to=2026-03-10');
    expect(data.sessions).to.have.length(1);
    expect(data.sessions[0].sessionId).to.equal('s1');
    expect(data.sessions[0].total_tokens).to.equal(5300);
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
    // allInput = nonCached(3000) + cacheRead(600) + cacheCreation(400) = 4000
    expect(data.total_input_tokens).to.equal(4000);
    expect(data.cache_read_tokens).to.equal(600);
    expect(data.cache_read_rate).to.be.a('number');
  });
});

describe('GET /api/status', () => {
  it('returns server status with cache info', async () => {
    const { data } = await fetchJson('/api/status');
    expect(data.record_count).to.equal(2);
    expect(data.last_refreshed).to.be.a('string');
    expect(data.cache_ttl_ms).to.equal(500);
  });
});

describe('Cache refresh', () => {
  it('picks up new log data after TTL expires', async function () {
    this.timeout(10000);
    // Verify initial state
    const before = await fetchJson('/api/usage?from=2026-03-11&to=2026-03-11');
    expect(before.data.total.input_tokens).to.equal(0);

    // Write new data to the fixture directory
    const newLogFile = path.join(projectDir, 'sess2.jsonl');
    const newLine = JSON.stringify({
      type: 'assistant', sessionId: 's2', timestamp: '2026-03-11T12:00:00.000Z',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 5000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
    });
    fs.writeFileSync(newLogFile, newLine);

    // Wait for TTL to expire (500ms + buffer)
    await new Promise(resolve => setTimeout(resolve, 700));

    // New data should now appear
    const after = await fetchJson('/api/usage?from=2026-03-11&to=2026-03-11');
    expect(after.data.total.input_tokens).to.equal(5000);
    expect(after.data.total.output_tokens).to.equal(1000);
  });
});
