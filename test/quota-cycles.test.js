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
      seven_day: { utilization: 50, resets_at: '2026-04-05T00:00:00.000Z' },
      seven_day_opus: { utilization: 30 },
      seven_day_sonnet: { utilization: 60 },
    };
    const result = computeCycleData(records, quotaData);

    // Token breakdown
    expect(result.overall.tokens.input).to.equal(4000);
    expect(result.overall.tokens.output).to.equal(1700);
    expect(result.overall.tokens.cacheRead).to.equal(600);
    expect(result.overall.tokens.cacheCreation).to.equal(300);

    // actualTokens = total excl cache reads (in + out + cw) = 4000+1700+300 = 6000
    expect(result.overall.actualTokens).to.equal(6000);
    expect(result.overall.utilization).to.equal(50);
    // projectedTokensAt100 = 6000 / 0.5 = 12000
    expect(result.overall.projectedTokensAt100).to.equal(12000);
    expect(result.overall.actualCost).to.be.a('number');
    expect(result.overall.projectedCostAt100).to.be.a('number');

    // Opus: in=1000 out=500 cw=100 → excl CR = 1600
    expect(result.models.opus.actualTokens).to.equal(1600);
    expect(result.models.opus.utilization).to.equal(30);
    expect(result.models.opus.projectedTokensAt100).to.equal(5333); // 1600 / 0.3

    // Sonnet: in=3000 out=1200 cw=200 → excl CR = 4400
    expect(result.models.sonnet.actualTokens).to.equal(4400);
    expect(result.models.sonnet.utilization).to.equal(60);
    expect(result.models.sonnet.projectedTokensAt100).to.equal(7333); // 4400 / 0.6
  });

  it('sets projections to null when utilization is 0', () => {
    const records = [
      { model: 'claude-sonnet-4-6', input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_creation_tokens: 0 },
    ];
    const quotaData = {
      seven_day: { utilization: 0, resets_at: '2026-04-05T00:00:00.000Z' },
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
      seven_day: { utilization: 40, resets_at: '2026-04-05T00:00:00.000Z' },
    };
    const result = computeCycleData(records, quotaData);
    // Haiku: in=5000 out=2000 cw=200 → excl CR = 7200
    expect(result.overall.actualTokens).to.equal(7200);
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
      seven_day: { utilization: 40, resets_at: '2026-04-05T00:00:00.000Z' },
      seven_day_sonnet: { utilization: 40 },
    };
    updateQuotaCycleSnapshot(quotaData, logDir, 'test-machine', tmpDir);

    const filePath = path.join(tmpDir, 'quota-cycles-test-machine.json');
    expect(fs.existsSync(filePath)).to.be.true;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(data.schemaVersion).to.equal(1);
    expect(data.machineName).to.equal('test-machine');
    expect(data.currentCycle.resets_at).to.equal('2026-04-05T00:00:00.000Z');
    // Excl CR: 1000 input + 500 output + 50 cache_creation = 1550
    expect(data.currentCycle.overall.actualTokens).to.equal(1550);
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
        resets_at: '2026-04-05T00:00:00.000Z',
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
      seven_day: { utilization: 10, resets_at: '2026-04-12T00:00:00.000Z' },
      seven_day_sonnet: { utilization: 10 },
    };
    updateQuotaCycleSnapshot(quotaData, logDir, 'test-machine', tmpDir);

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), 'utf-8'));
    expect(data.currentCycle.resets_at).to.equal('2026-04-12T00:00:00.000Z');
    expect(data.history).to.have.length(1);
    expect(data.history[0].resets_at).to.equal('2026-04-05T00:00:00.000Z');
    expect(data.history[0].overall.actualTokens).to.equal(20000);
  });

  it('caps history at 52 entries', () => {
    const logDir = makeLogDir([]);
    const oldSnapshot = {
      schemaVersion: 1,
      machineName: 'test-machine',
      currentCycle: {
        resets_at: '2026-04-05T00:00:00.000Z',
        start: '2026-03-29T00:00:00Z',
        lastUpdated: '2026-04-04T23:00:00Z',
        overall: { utilization: 50, actualTokens: 1000, projectedTokensAt100: 2000, actualCost: 1.00, projectedCostAt100: 2.00 },
        models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
      },
      history: Array.from({ length: 52 }, (_, i) => {
        const d = new Date(Date.UTC(2025, 0, 1 + i * 7));
        return {
          resets_at: d.toISOString(),
          start: new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          lastUpdated: d.toISOString(),
          overall: { utilization: 50, actualTokens: 1000, projectedTokensAt100: 2000, actualCost: 1.00, projectedCostAt100: 2.00 },
          models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
        };
      }),
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-test-machine.json'), JSON.stringify(oldSnapshot));

    const quotaData = {
      available: true,
      seven_day: { utilization: 5, resets_at: '2026-04-12T00:00:00.000Z' },
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
        resets_at: '2026-04-05T00:00:00.000Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T10:00:00Z',
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
        resets_at: '2026-04-05T00:00:00.000Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T12:00:00Z',
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

  it('merges offline machine history into current cycle instead of dropping it', () => {
    // Machine A is active with current cycle 4/2-4/9
    const machineA = {
      schemaVersion: 1, machineName: 'active-laptop',
      currentCycle: {
        resets_at: '2026-04-09T06:00:00.000Z', start: '2026-04-02T06:00:00.000Z', lastUpdated: '2026-04-05T10:00:00Z',
        overall: { utilization: 17, tokens: { input: 44000, output: 1100000, cacheRead: 142000000, cacheCreation: 15200000 }, actualTokens: 16344000, projectedTokensAt100: 96141176, actualCost: 182.38, projectedCostAt100: 1072.82 },
        models: {
          opus: { utilization: 17, tokens: { input: 44000, output: 1100000, cacheRead: 142000000, cacheCreation: 15200000 }, actualTokens: 16344000, projectedTokensAt100: 96141176, actualCost: 182.38, projectedCostAt100: 1072.82 },
          sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } },
        },
      },
      history: [{ resets_at: '2026-04-02T06:00:00.000Z', start: '2026-03-26T06:00:00.000Z', lastUpdated: '2026-04-02T05:00:00Z',
        overall: { utilization: 15, actualTokens: 20000000, projectedTokensAt100: 133333333, actualCost: 350.00, projectedCostAt100: 2333.33 },
        models: { opus: { utilization: 15, actualTokens: 20000000, projectedTokensAt100: 133333333, actualCost: 350.00, projectedCostAt100: 2333.33 }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
      }],
    };
    // Machine B went offline early in the cycle; its 4/2-4/9 data was archived to history
    const machineB = {
      schemaVersion: 1, machineName: 'offline-desktop',
      currentCycle: null,
      history: [
        { resets_at: '2026-04-09T06:00:00.534Z', start: '2026-04-02T06:00:00.534Z', lastUpdated: '2026-04-03T08:00:00Z',
          overall: { utilization: 1, tokens: { input: 389, output: 26000, cacheRead: 7600000, cacheCreation: 832000 }, actualTokens: 858389, projectedTokensAt100: 85838900, actualCost: 9.02, projectedCostAt100: 902.00 },
          models: {
            opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } },
            sonnet: { utilization: 1, tokens: { input: 389, output: 26000, cacheRead: 7600000, cacheCreation: 832000 }, actualTokens: 858389, projectedTokensAt100: 85838900, actualCost: 9.02, projectedCostAt100: 902.00 },
          },
        },
        { resets_at: '2026-04-02T06:00:00.000Z', start: '2026-03-26T06:00:00.000Z', lastUpdated: '2026-04-02T04:00:00Z',
          overall: { utilization: 15, actualTokens: 400000, projectedTokensAt100: 2666667, actualCost: 8.17, projectedCostAt100: 54.47 },
          models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 15, actualTokens: 400000, projectedTokensAt100: 2666667, actualCost: 8.17, projectedCostAt100: 54.47 } },
        },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-active-laptop.json'), JSON.stringify(machineA));
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-offline-desktop.json'), JSON.stringify(machineB));

    const result = loadQuotaCycles('active-laptop', tmpDir, tmpDir);

    // Machine B's 4/2-4/9 history should be MERGED into current cycle, not dropped
    expect(result.currentCycle).to.not.be.null;
    expect(result.currentCycle.overall.actualTokens).to.equal(16344000 + 858389);
    expect(result.currentCycle.overall.actualCost).to.equal(Math.round((182.38 + 9.02) * 100) / 100);

    // Machine B's sonnet data should appear in merged models
    expect(result.currentCycle.models.sonnet.actualTokens).to.equal(858389);

    // History should NOT contain 4/2-4/9 (it's merged into current)
    const historyPeriods = result.history.map(h => h.start.slice(0, 10));
    expect(historyPeriods).to.not.include('2026-04-02');

    // 3/26-4/2 history should still exist, merged from both machines
    expect(result.history).to.have.length(1);
    expect(result.history[0].overall.actualTokens).to.equal(20000000 + 400000);
  });

  it('deduplicates within-machine history before cross-machine merge', () => {
    // Machine A has duplicate entries for the same cycle (from old false-switch bug)
    const machineA = {
      schemaVersion: 1, machineName: 'laptop',
      currentCycle: {
        resets_at: '2026-04-09T06:00:00.000Z', start: '2026-04-02T06:00:00.000Z', lastUpdated: '2026-04-05T10:00:00Z',
        overall: { utilization: 10, actualTokens: 5000, projectedTokensAt100: 50000, actualCost: 5.00, projectedCostAt100: 50.00 },
        models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
      },
      history: [
        { resets_at: '2026-04-02T06:00:00.000Z', start: '2026-03-26T06:00:00.000Z', lastUpdated: '2026-04-02T05:00:00Z',
          overall: { utilization: 50, actualTokens: 10000, projectedTokensAt100: 20000, actualCost: 10.00, projectedCostAt100: 20.00 },
          models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
        },
        // Duplicate from false cycle switch — older snapshot of the same data
        { resets_at: '2026-04-02T06:00:00.534Z', start: '2026-03-26T06:00:00.534Z', lastUpdated: '2026-04-02T04:00:00Z',
          overall: { utilization: 50, actualTokens: 8000, projectedTokensAt100: 16000, actualCost: 8.00, projectedCostAt100: 16.00 },
          models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
        },
      ],
    };
    const machineB = {
      schemaVersion: 1, machineName: 'desktop',
      currentCycle: {
        resets_at: '2026-04-09T06:00:00.000Z', start: '2026-04-02T06:00:00.000Z', lastUpdated: '2026-04-05T12:00:00Z',
        overall: { utilization: 10, actualTokens: 3000, projectedTokensAt100: 30000, actualCost: 3.00, projectedCostAt100: 30.00 },
        models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
      },
      history: [
        { resets_at: '2026-04-02T06:00:00.000Z', start: '2026-03-26T06:00:00.000Z', lastUpdated: '2026-04-02T03:00:00Z',
          overall: { utilization: 50, actualTokens: 7000, projectedTokensAt100: 14000, actualCost: 7.00, projectedCostAt100: 14.00 },
          models: { opus: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null }, sonnet: { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null } },
        },
      ],
    };
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-laptop.json'), JSON.stringify(machineA));
    fs.writeFileSync(path.join(tmpDir, 'quota-cycles-desktop.json'), JSON.stringify(machineB));

    const result = loadQuotaCycles('laptop', tmpDir, tmpDir);

    // History 3/26-4/2: laptop deduped to 10000 (most recent) + desktop 7000 = 17000
    // NOT 10000 + 8000 + 7000 = 25000 (which would double-count laptop's duplicate)
    expect(result.history).to.have.length(1);
    expect(result.history[0].overall.actualTokens).to.equal(10000 + 7000);
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
        resets_at: '2026-04-05T00:00:00.000Z', start: '2026-03-29T00:00:00Z', lastUpdated: '2026-04-01T12:00:00Z',
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
    expect(data.currentCycle.resets_at).to.equal('2026-04-05T00:00:00.000Z');
    // Recomputed from parsed records: 1000 input + 500 output + 100 cache_creation = 1600
    expect(data.currentCycle.overall.actualTokens).to.equal(1600);
    expect(data.history).to.have.length(1);
    expect(data.machines).to.include('test');
  });
});
