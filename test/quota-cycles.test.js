import { describe, it, before, after, beforeEach, afterEach } from 'mocha';
import express from 'express';
import { createApiRouter } from '../server/routes/api.js';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeCycleData, updateQuotaCycleSnapshot, loadQuotaCycles } from '../server/quota-cycles.js';

describe('computeCycleData', () => {
  it('computes overall and per-model token/cost totals with projections', () => {
    const records = [
      { model: 'claude-opus-4-6', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 200, cache_creation_tokens: 100 },
      { model: 'claude-sonnet-4-6', input_tokens: 2000, output_tokens: 800, cache_read_tokens: 300, cache_creation_tokens: 150 },
      { model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 400, cache_read_tokens: 100, cache_creation_tokens: 50 },
    ];
    const quotaData = {
      seven_day: { utilization: 50, resets_at: '2026-04-05T00:00:00Z' },
      seven_day_opus: { utilization: 30 },
      seven_day_sonnet: { utilization: 60 },
    };
    const result = computeCycleData(records, quotaData);

    // Overall: 1000+2000+1000=4000 in, 500+800+400=1700 out, 200+300+100=600 cread, 100+150+50=300 ccreate
    // Total tokens = 4000+1700+600+300 = 6600
    expect(result.overall.actualTokens).to.equal(6600);
    expect(result.overall.utilization).to.equal(50);
    // projectedTokensAt100 = 6600 / (50/100) = 13200
    expect(result.overall.projectedTokensAt100).to.equal(13200);
    expect(result.overall.actualCost).to.be.a('number');
    expect(result.overall.projectedCostAt100).to.be.a('number');

    // Opus: 1000+500+200+100 = 1800 tokens
    expect(result.models.opus.actualTokens).to.equal(1800);
    expect(result.models.opus.utilization).to.equal(30);
    expect(result.models.opus.projectedTokensAt100).to.equal(6000); // 1800 / 0.3

    // Sonnet: 3000+1200+400+200 = 4800 tokens
    expect(result.models.sonnet.actualTokens).to.equal(4800);
    expect(result.models.sonnet.utilization).to.equal(60);
    expect(result.models.sonnet.projectedTokensAt100).to.equal(8000); // 4800 / 0.6
  });

  it('sets projections to null when utilization is 0', () => {
    const records = [
      { model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0 },
    ];
    const quotaData = {
      seven_day: { utilization: 0, resets_at: '2026-04-05T00:00:00Z' },
      seven_day_sonnet: { utilization: 0 },
    };
    const result = computeCycleData(records, quotaData);
    expect(result.overall.projectedTokensAt100).to.be.null;
    expect(result.overall.projectedCostAt100).to.be.null;
    expect(result.models.sonnet.projectedTokensAt100).to.be.null;
  });

  it('includes haiku tokens in overall but not in models', () => {
    const records = [
      { model: 'claude-haiku-4-5', input_tokens: 5000, output_tokens: 2000, cache_read_tokens: 500, cache_creation_tokens: 200 },
    ];
    const quotaData = {
      seven_day: { utilization: 40, resets_at: '2026-04-05T00:00:00Z' },
    };
    const result = computeCycleData(records, quotaData);
    expect(result.overall.actualTokens).to.equal(7700);
    expect(result.models.opus.actualTokens).to.equal(0);
    expect(result.models.sonnet.actualTokens).to.equal(0);
  });
});

describe('updateQuotaCycleSnapshot', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-test-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  function makeLogDir(records) {
    const projectDir = path.join(tmpDir, 'logs', '-Users-test-Workspace-myproject');
    fs.mkdirSync(projectDir, { recursive: true });
    const lines = records.map(r => JSON.stringify({
      type: 'assistant',
      sessionId: 's1',
      timestamp: r.timestamp,
      message: {
        model: r.model,
        usage: {
          input_tokens: r.input_tokens,
          output_tokens: r.output_tokens,
          cache_creation_input_tokens: r.cache_creation_tokens,
          cache_read_input_tokens: r.cache_read_tokens,
        },
      },
    }));
    fs.writeFileSync(path.join(projectDir, 'session.jsonl'), lines.join('\n'));
    return path.join(tmpDir, 'logs');
  }

  it('creates snapshot file on first run', () => {
    const logDir = makeLogDir([
      { timestamp: '2026-03-30T10:00:00Z', model: 'claude-sonnet-4-6', input_tokens: 1000, output_tokens: 500, cache_read_tokens: 100, cache_creation_tokens: 50 },
    ]);
    const quotaData = {
      available: true,
      seven_day: { utilization: 40, resets_at: '2026-04-05T00:00:00Z' },
      seven_day_sonnet: { utilization: 40 },
    };
    updateQuotaCycleSnapshot(quotaData, logDir, 'test-machine', tmpDir);

    const filePath = path.join(tmpDir, 'quota-cycles-test-machine.json');
    expect(fs.existsSync(filePath)).to.be.true;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(data.schemaVersion).to.equal(1);
    expect(data.machineName).to.equal('test-machine');
    expect(data.currentCycle.resets_at).to.equal('2026-04-05T00:00:00Z');
    expect(data.currentCycle.overall.actualTokens).to.equal(1650);
    expect(data.history).to.have.length(0);
  });

  it('detects cycle switch and archives old cycle to history', () => {
    const logDir = makeLogDir([
      { timestamp: '2026-04-06T10:00:00Z', model: 'claude-sonnet-4-6', input_tokens: 500, output_tokens: 200, cache_read_tokens: 50, cache_creation_tokens: 25 },
    ]);

    // First: write a snapshot with old resets_at
    const oldSnapshot = {
      schemaVersion: 1,
      machineName: 'test-machine',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z',
        start: '2026-03-29T00:00:00Z',
        lastUpdated: '2026-04-04T23:00:00Z',
        overall: { utilization: 80, actualTokens: 20000, projectedTokensAt100: 25000, actualCost: 15.00, projectedCostAt100: 18.75 },
        models: {
          opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null },
          sonnet: { utilization: 80, actualTokens: 20000, projectedTokensAt100: 25000, actualCost: 15.00, projectedCostAt100: 18.75 },
        },
      },
      history: [],
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), JSON.stringify(oldSnapshot));

    // Now update with new resets_at (cycle switched)
    const quotaData = {
      available: true,
      seven_day: { utilization: 10, resets_at: '2026-04-12T00:00:00Z' },
      seven_day_sonnet: { utilization: 10 },
    };
    updateQuotaCycleSnapshot(quotaData, logDir, 'test-machine', tmpDir);

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), 'utf-8'));
    expect(data.currentCycle.resets_at).to.equal('2026-04-12T00:00:00Z');
    expect(data.history).to.have.length(1);
    expect(data.history[0].resets_at).to.equal('2026-04-05T00:00:00Z');
    expect(data.history[0].overall.actualTokens).to.equal(20000);
  });

  it('caps history at 52 entries', () => {
    const logDir = makeLogDir([]);
    const oldSnapshot = {
      schemaVersion: 1,
      machineName: 'test-machine',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z',
        start: '2026-03-29T00:00:00Z',
        lastUpdated: '2026-04-04T23:00:00Z',
        overall: { utilization: 50, actualTokens: 1000, projectedTokensAt100: 2000, actualCost: 1.00, projectedCostAt100: 2.00 },
        models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
      },
      history: Array.from({ length: 52 }, (_, i) => ({
        resets_at: `2025-0${(i % 9) + 1}-01T00:00:00Z`,
        start: `2025-0${(i % 9) + 1}-01T00:00:00Z`,
        overall: { utilization: 50, actualTokens: 1000, projectedTokensAt100: 2000, actualCost: 1.00, projectedCostAt100: 2.00 },
        models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
      })),
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), JSON.stringify(oldSnapshot));

    const quotaData = {
      available: true,
      seven_day: { utilization: 5, resets_at: '2026-04-12T00:00:00Z' },
    };
    updateQuotaCycleSnapshot(quotaData, logDir, 'test-machine', tmpDir);

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), 'utf-8'));
    expect(data.history).to.have.length(52);
  });
});

describe('loadQuotaCycles', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-load-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty data when no snapshot exists', () => {
    const result = loadQuotaCycles('test-machine', null, tmpDir);
    expect(result.currentCycle).to.be.null;
    expect(result.history).to.have.length(0);
    expect(result.machines).to.have.length(0);
  });

  it('merges multiple machine files by summing tokens', () => {
    const machine1 = {
      schemaVersion: 1, machineName: 'laptop',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T10:00:00Z',
        overall: { utilization: 50, actualTokens: 10000, projectedTokensAt100: 20000, actualCost: 5.00, projectedCostAt100: 10.00 },
        models: {
          opus: { utilization: 30, actualTokens: 3000, projectedTokensAt100: 10000, actualCost: 3.00, projectedCostAt100: 10.00 },
          sonnet: { utilization: 60, actualTokens: 7000, projectedTokensAt100: 11667, actualCost: 2.00, projectedCostAt100: 3.33 },
        },
      },
      history: [],
    };
    const machine2 = {
      schemaVersion: 1, machineName: 'desktop',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T12:00:00Z',
        overall: { utilization: 50, actualTokens: 5000, projectedTokensAt100: 10000, actualCost: 2.50, projectedCostAt100: 5.00 },
        models: {
          opus: { utilization: 30, actualTokens: 1000, projectedTokensAt100: 3333, actualCost: 1.00, projectedCostAt100: 3.33 },
          sonnet: { utilization: 60, actualTokens: 4000, projectedTokensAt100: 6667, actualCost: 1.50, projectedCostAt100: 2.50 },
        },
      },
      history: [],
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-laptop.json'), JSON.stringify(machine1));
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-desktop.json'), JSON.stringify(machine2));

    const result = loadQuotaCycles('laptop', tmpDir, tmpDir);
    expect(result.machines).to.include.members(['laptop', 'desktop']);
    // Summed: 10000 + 5000 = 15000 actual tokens
    expect(result.currentCycle.overall.actualTokens).to.equal(15000);
    // Re-projected: 15000 / 0.5 = 30000
    expect(result.currentCycle.overall.projectedTokensAt100).to.equal(30000);
    // Utilization from most recent machine (desktop, lastUpdated 12:00)
    expect(result.currentCycle.overall.utilization).to.equal(50);
  });
});

describe('GET /api/quota-cycles (integration)', () => {
  let apiApp, apiServer, baseUrl, tmpDir, logDir;

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-api-'));
    logDir = path.join(tmpDir, 'logs');
    const projectDir = path.join(logDir, '-Users-test-Workspace-testproject');
    fs.mkdirSync(projectDir, { recursive: true });
    const lines = [
      JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-04-01T10:00:00Z', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 100, cache_read_input_tokens: 200 } } }),
    ];
    fs.writeFileSync(path.join(projectDir, 'session.jsonl'), lines.join('\n'));

    const snapshot = {
      schemaVersion: 1, machineName: 'test',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T12:00:00Z',
        overall: { utilization: 50, actualTokens: 10000, projectedTokensAt100: 20000, actualCost: 5.00, projectedCostAt100: 10.00 },
        models: {
          opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null },
          sonnet: { utilization: 50, actualTokens: 10000, projectedTokensAt100: 20000, actualCost: 5.00, projectedCostAt100: 10.00 },
        },
      },
      history: [{
        resets_at: '2026-03-29T00:00:00Z', start: '2026-03-22T00:00:00Z',
        overall: { utilization: 80, actualTokens: 30000, projectedTokensAt100: 37500, actualCost: 15.00, projectedCostAt100: 18.75 },
        models: {
          opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null },
          sonnet: { utilization: 80, actualTokens: 30000, projectedTokensAt100: 37500, actualCost: 15.00, projectedCostAt100: 18.75 },
        },
      }],
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-test.json'), JSON.stringify(snapshot));

    apiApp = express();
    apiApp.use('/api', createApiRouter(logDir, {
      cacheTtlMs: 500,
      machineName: 'test',
      snapshotDir: tmpDir,
    }));
    await new Promise((resolve) => {
      apiServer = apiApp.listen(0, () => { baseUrl = `http://localhost:${apiServer.address().port}`; resolve(); });
    });
  });

  after(async () => {
    await new Promise((resolve) => apiServer.close(resolve));
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns current cycle and history', async () => {
    const res = await fetch(`${baseUrl}/api/quota-cycles`);
    const data = await res.json();
    expect(res.status).to.equal(200);
    expect(data.currentCycle).to.be.an('object');
    expect(data.currentCycle.resets_at).to.equal('2026-04-05T00:00:00Z');
    expect(data.currentCycle.overall.actualTokens).to.equal(10000);
    expect(data.history).to.have.length(1);
    expect(data.machines).to.include('test');
  });
});
