import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createApiRouter } from '../server/routes/api.js';

describe('Current model pricing through the API', () => {
  let server, baseUrl, tmpDir;

  before((done) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-latest-models-'));
    const projectDir = path.join(tmpDir, '-Users-test-Workspace-latestmodels');
    fs.mkdirSync(projectDir);
    const records = [
      ...['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5'].map(model => ({
        model, input_tokens: 300000, output_tokens: 100000,
        cache_read_input_tokens: 500000, cache_creation_input_tokens: 200000,
      })),
      ...[50000, 50000, 50001].map(cacheRead => ({
        model: 'claude-haiku-5-5', input_tokens: 50000, output_tokens: 10000,
        cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0,
      })),
    ];
    fs.writeFileSync(path.join(projectDir, 'usage.jsonl'), records.map(({ model, ...usage }, i) => JSON.stringify({
      type: 'assistant', sessionId: model, timestamp: '2026-11-02T12:00:00.000Z',
      message: { id: `latest-${i}`, model, usage },
    })).join('\n'));
    const app = express();
    app.use('/api', createApiRouter(tmpDir, { cacheTtlMs: 0 }));
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}/api`;
      done();
    });
  });

  after((done) => {
    server.close(() => {
      fs.rmSync(tmpDir, { recursive: true });
      done();
    });
  });

  async function get(endpoint, model) {
    const res = await fetch(`${baseUrl}/${endpoint}${model ? `?model=${model}` : ''}`);
    expect(res.status).to.equal(200);
    return res.json();
  }

  for (const [model, expectedCost] of [
    ['claude-opus-5-5', 4.30],
    ['claude-sonnet-5-5', 2.15],
    ['claude-sonnet-5', 2.20],
    ['claude-haiku-5-5', 0.07],
  ]) {
    it(`keeps ${model} costs consistent across summaries, charts, projects, and sessions`, async () => {
      const [usage, cost, projects, sessions] = await Promise.all(
        ['usage', 'cost', 'projects', 'sessions'].map(endpoint => get(endpoint, model))
      );
      expect(usage.total.estimated_api_cost_usd).to.equal(expectedCost);
      expect(usage.buckets[0].estimated_cost_usd).to.equal(expectedCost);
      expect(cost.api_equivalent_cost_usd).to.equal(expectedCost);
      expect(cost.cost_per_day[0].api_cost).to.equal(expectedCost);
      expect(projects.projects[0].estimated_cost_usd).to.equal(expectedCost);
      expect(sessions.sessions[0].estimated_cost_usd).to.equal(expectedCost);
      expect(sessions.totals.estimated_cost_usd).to.equal(expectedCost);
    });
  }

  it('sums mixed models without treating combined Haiku usage as one long prompt', async () => {
    const { api_equivalent_cost_usd: cost } = await get('cost');
    expect(cost).to.equal(8.72);
  });

  it('exposes both Haiku pricing tiers and detects the new models', async () => {
    const { models } = await get('models');
    expect(models.map(model => model.id)).to.have.members([
      'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5',
    ]);
    const haiku = models.find(model => model.id === 'claude-haiku-5-5');
    expect(haiku.input_price_per_mtok).to.equal(0.10);
    expect(haiku.long_context.threshold_tokens).to.equal(100000);
    expect(haiku.long_context.input_price_per_mtok).to.equal(0.50);
  });
});
