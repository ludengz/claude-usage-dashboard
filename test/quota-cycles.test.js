import { describe, it } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { computeCycleData } from '../server/quota-cycles.js';

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
