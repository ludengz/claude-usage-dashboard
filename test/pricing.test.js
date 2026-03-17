import { describe, it } from 'mocha';
import { expect } from 'chai';
import { MODEL_PRICING, PLAN_DEFAULTS, calculateRecordCost, getModelPricing } from '../server/pricing.js';

describe('MODEL_PRICING', () => {
  it('has pricing for known models', () => {
    expect(MODEL_PRICING['claude-opus-4-6']).to.exist;
    expect(MODEL_PRICING['claude-sonnet-4-6']).to.exist;
    expect(MODEL_PRICING['claude-haiku-4-5']).to.exist;
  });
});

describe('PLAN_DEFAULTS', () => {
  it('has correct subscription prices', () => {
    expect(PLAN_DEFAULTS.pro).to.equal(20);
    expect(PLAN_DEFAULTS.max5x).to.equal(100);
    expect(PLAN_DEFAULTS.max20x).to.equal(200);
  });
});

describe('calculateRecordCost', () => {
  it('calculates cost for a known model', () => {
    const record = {
      model: 'claude-sonnet-4-6',
      input_tokens: 1000000,
      output_tokens: 1000000,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    };
    const cost = calculateRecordCost(record);
    expect(cost).to.equal(18);
  });

  it('accounts for cache token pricing', () => {
    const record = {
      model: 'claude-sonnet-4-6',
      input_tokens: 300000,   // non-cached input (additive, not inclusive of cache)
      output_tokens: 0,
      cache_read_tokens: 500000,
      cache_creation_tokens: 200000,
    };
    const cost = calculateRecordCost(record);
    // 300K * $3/M = $0.90 + 500K * $0.30/M = $0.15 + 200K * $3.75/M = $0.75 = $1.80
    expect(cost).to.be.closeTo(1.80, 0.01);
  });

  it('returns 0 for unknown model', () => {
    const record = {
      model: 'unknown-model',
      input_tokens: 1000000,
      output_tokens: 1000000,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    };
    const cost = calculateRecordCost(record);
    expect(cost).to.equal(0);
  });
});

describe('getModelPricing', () => {
  it('returns pricing for known model', () => {
    const pricing = getModelPricing('claude-opus-4-6');
    expect(pricing.input_price_per_mtok).to.equal(5);
    expect(pricing.output_price_per_mtok).to.equal(25);
  });

  it('returns null for unknown model', () => {
    expect(getModelPricing('unknown')).to.be.null;
  });
});
