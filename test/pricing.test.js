import { describe, it } from 'mocha';
import { expect } from 'chai';
import { MODEL_PRICING, PLAN_DEFAULTS, calculateRecordCost, getModelPricing } from '../server/pricing.js';

describe('MODEL_PRICING', () => {
  it('has pricing for known models', () => {
    expect(MODEL_PRICING['claude-fable-5']).to.exist;
    expect(MODEL_PRICING['claude-opus-4-6']).to.exist;
    expect(MODEL_PRICING['claude-opus-4-7']).to.exist;
    expect(MODEL_PRICING['claude-opus-4-8']).to.exist;
    expect(MODEL_PRICING['claude-sonnet-5']).to.exist;
    expect(MODEL_PRICING['claude-sonnet-4-6']).to.exist;
    expect(MODEL_PRICING['claude-haiku-4-5']).to.exist;
  });

  it('prices Fable 5 at $10/$50 per Mtok', () => {
    expect(MODEL_PRICING['claude-fable-5'].input_price_per_mtok).to.equal(10);
    expect(MODEL_PRICING['claude-fable-5'].output_price_per_mtok).to.equal(50);
    expect(MODEL_PRICING['claude-fable-5'].cache_read_price_per_mtok).to.equal(1.00);
    expect(MODEL_PRICING['claude-fable-5'].cache_creation_price_per_mtok).to.equal(12.50);
  });

  it('prices Opus 4.8 identically to Opus 4.6/4.7', () => {
    expect(MODEL_PRICING['claude-opus-4-8']).to.deep.equal(MODEL_PRICING['claude-opus-4-6']);
    expect(MODEL_PRICING['claude-opus-4-8']).to.deep.equal(MODEL_PRICING['claude-opus-4-7']);
  });

  it('prices Sonnet 5 identically to Sonnet 4.6', () => {
    expect(MODEL_PRICING['claude-sonnet-5']).to.deep.equal(MODEL_PRICING['claude-sonnet-4-6']);
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

  it('calculates cost for Fable 5', () => {
    const record = {
      model: 'claude-fable-5',
      input_tokens: 300000,
      output_tokens: 100000,
      cache_read_tokens: 500000,
      cache_creation_tokens: 200000,
    };
    const cost = calculateRecordCost(record);
    // 300K * $10/M = $3.00 + 100K * $50/M = $5.00 + 500K * $1/M = $0.50 + 200K * $12.50/M = $2.50 = $11.00
    expect(cost).to.be.closeTo(11.00, 0.01);
  });

  it('resolves date-suffixed model ids to base pricing', () => {
    const record = {
      model: 'claude-haiku-4-5-20251001',
      input_tokens: 1000000,
      output_tokens: 1000000,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
    };
    const cost = calculateRecordCost(record);
    expect(cost).to.equal(6); // $1 input + $5 output
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

  it('returns base pricing for date-suffixed model ids', () => {
    const pricing = getModelPricing('claude-haiku-4-5-20251001');
    expect(pricing).to.not.be.null;
    expect(pricing.input_price_per_mtok).to.equal(1);
  });

  it('returns null for unknown model', () => {
    expect(getModelPricing('unknown')).to.be.null;
    expect(getModelPricing(null)).to.be.null;
  });
});
