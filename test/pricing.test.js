import { describe, it } from 'mocha';
import { expect } from 'chai';
import { MODEL_PRICING, PLAN_DEFAULTS, calculateRecordCost, getModelPricing } from '../server/pricing.js';

describe('MODEL_PRICING', () => {
  it('has pricing for known models', () => {
    expect(MODEL_PRICING['claude-fable-5-2']).to.exist;
    expect(MODEL_PRICING['claude-fable-5-1']).to.exist;
    expect(MODEL_PRICING['claude-fable-5']).to.exist;
    expect(MODEL_PRICING['claude-opus-5-5']).to.exist;
    expect(MODEL_PRICING['claude-opus-5']).to.exist;
    expect(MODEL_PRICING['claude-opus-4-6']).to.exist;
    expect(MODEL_PRICING['claude-opus-4-7']).to.exist;
    expect(MODEL_PRICING['claude-opus-4-8']).to.exist;
    expect(MODEL_PRICING['claude-sonnet-5']).to.exist;
    expect(MODEL_PRICING['claude-sonnet-5-5']).to.exist;
    expect(MODEL_PRICING['claude-sonnet-4-6']).to.exist;
    expect(MODEL_PRICING['claude-haiku-4-5']).to.exist;
    expect(MODEL_PRICING['claude-haiku-5-5']).to.exist;
  });

  it('prices Fable 5 at $10/$50 per Mtok', () => {
    expect(MODEL_PRICING['claude-fable-5'].input_price_per_mtok).to.equal(10);
    expect(MODEL_PRICING['claude-fable-5'].output_price_per_mtok).to.equal(50);
    expect(MODEL_PRICING['claude-fable-5'].cache_read_price_per_mtok).to.equal(1.00);
    expect(MODEL_PRICING['claude-fable-5'].cache_creation_price_per_mtok).to.equal(12.50);
  });

  it('prices Fable 5.1 like Fable 5 except for cheaper cache reads', () => {
    const fable51 = MODEL_PRICING['claude-fable-5-1'];
    const fable5 = MODEL_PRICING['claude-fable-5'];
    expect(fable51.input_price_per_mtok).to.equal(fable5.input_price_per_mtok);
    expect(fable51.output_price_per_mtok).to.equal(fable5.output_price_per_mtok);
    expect(fable51.cache_creation_price_per_mtok).to.equal(fable5.cache_creation_price_per_mtok);
    expect(fable51.cache_read_price_per_mtok).to.equal(0.25);
  });

  it('prices Fable 5.2 at its reduced rates', () => {
    expect(MODEL_PRICING['claude-fable-5-2']).to.deep.equal({
      input_price_per_mtok: 8,
      output_price_per_mtok: 40,
      cache_read_price_per_mtok: 0.20,
      cache_creation_price_per_mtok: 10,
    });
  });

  it('has no prompt-length tier for Fable 5.2', () => {
    expect(getModelPricing('claude-fable-5-2', 900000)).to.equal(MODEL_PRICING['claude-fable-5-2']);
  });

  it('prices Opus 4.8 identically to Opus 4.6/4.7', () => {
    expect(MODEL_PRICING['claude-opus-4-8']).to.deep.equal(MODEL_PRICING['claude-opus-4-6']);
    expect(MODEL_PRICING['claude-opus-4-8']).to.deep.equal(MODEL_PRICING['claude-opus-4-7']);
  });

  it('prices Opus 5.5 at its reduced input, output, and cache rates', () => {
    expect(MODEL_PRICING['claude-opus-5-5']).to.deep.equal({
      input_price_per_mtok: 4,
      output_price_per_mtok: 20,
      cache_read_price_per_mtok: 0.20,
      cache_creation_price_per_mtok: 5,
    });
  });

  it('prices Opus 5 identically to the rest of the Opus tier', () => {
    expect(MODEL_PRICING['claude-opus-5']).to.deep.equal(MODEL_PRICING['claude-opus-4-8']);
  });

  it('prices Sonnet 5 at its reduced rates', () => {
    expect(MODEL_PRICING['claude-sonnet-5']).to.deep.equal({
      input_price_per_mtok: 2,
      output_price_per_mtok: 10,
      cache_read_price_per_mtok: 0.20,
      cache_creation_price_per_mtok: 2.50,
    });
  });

  it('prices Sonnet 5.5 with cheaper cache reads than Sonnet 5', () => {
    expect(MODEL_PRICING['claude-sonnet-5-5']).to.deep.equal({
      input_price_per_mtok: 2,
      output_price_per_mtok: 10,
      cache_read_price_per_mtok: 0.10,
      cache_creation_price_per_mtok: 2.50,
    });
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

  it('calculates cost for Fable 5.1', () => {
    const record = {
      model: 'claude-fable-5-1',
      input_tokens: 300000,
      output_tokens: 100000,
      cache_read_tokens: 500000,
      cache_creation_tokens: 200000,
    };
    const cost = calculateRecordCost(record);
    // 300K * $10/M = $3.00 + 100K * $50/M = $5.00 + 500K * $0.25/M = $0.125 + 200K * $12.50/M = $2.50 = $10.625
    expect(cost).to.be.closeTo(10.625, 0.001);
  });

  it('calculates cost for Fable 5.2, including date-suffixed ids', () => {
    const record = {
      model: 'claude-fable-5-2',
      input_tokens: 300000,
      output_tokens: 100000,
      cache_read_tokens: 500000,
      cache_creation_tokens: 200000,
    };
    // 300K * $8/M = $2.40 + 100K * $40/M = $4.00 + 500K * $0.20/M = $0.10 + 200K * $10/M = $2.00 = $8.50
    expect(calculateRecordCost(record)).to.be.closeTo(8.50, 1e-10);
    expect(calculateRecordCost({ ...record, model: 'claude-fable-5-2-20261101' })).to.be.closeTo(8.50, 1e-10);
  });

  it('calculates cost for Opus 5', () => {
    const record = {
      model: 'claude-opus-5',
      input_tokens: 300000,
      output_tokens: 100000,
      cache_read_tokens: 500000,
      cache_creation_tokens: 200000,
    };
    const cost = calculateRecordCost(record);
    // 300K * $5/M = $1.50 + 100K * $25/M = $2.50 + 500K * $0.50/M = $0.25 + 200K * $6.25/M = $1.25 = $5.50
    expect(cost).to.be.closeTo(5.50, 0.01);
  });

  describe('Haiku 5.5 prompt-length pricing', () => {
    const record = {
      model: 'claude-haiku-5-5',
      input_tokens: 20000,
      output_tokens: 10000,
      cache_read_tokens: 70000,
      cache_creation_tokens: 10000,
    };

    it('uses the lower tier below and at exactly 100,000 input tokens', () => {
      expect(calculateRecordCost({ ...record, input_tokens: 19999 })).to.be.closeTo(0.0089499, 1e-10);
      expect(calculateRecordCost(record)).to.be.closeTo(0.00895, 1e-10);
    });

    it('counts cache reads toward the threshold and reprices the entire request', () => {
      expect(calculateRecordCost({ ...record, cache_read_tokens: 70001 })).to.be.closeTo(0.04475005, 1e-10);
    });

    it('counts cache writes toward the threshold', () => {
      expect(calculateRecordCost({ ...record, cache_creation_tokens: 10001 })).to.be.closeTo(0.044750625, 1e-10);
    });

    it('uses the higher tier for uncached prompts over 100,000 tokens', () => {
      expect(calculateRecordCost({ ...record, input_tokens: 100001, cache_read_tokens: 0, cache_creation_tokens: 0 }))
        .to.be.closeTo(0.0750005, 1e-10);
    });

    it('does not count output tokens toward the threshold', () => {
      expect(calculateRecordCost({ ...record, input_tokens: 50000, output_tokens: 100000, cache_read_tokens: 0, cache_creation_tokens: 0 }))
        .to.be.closeTo(0.055, 1e-10);
    });

    it('applies tier pricing to date-suffixed model ids', () => {
      expect(calculateRecordCost({ ...record, model: 'claude-haiku-5-5-20261007', cache_read_tokens: 70001 }))
        .to.be.closeTo(0.04475005, 1e-10);
    });
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

  it('keeps the lower tier at the threshold and selects the higher tier above it', () => {
    expect(getModelPricing('claude-haiku-5-5', 100000).input_price_per_mtok).to.equal(0.10);
    expect(getModelPricing('claude-haiku-5-5', 100001).input_price_per_mtok).to.equal(0.50);
  });

  it('does not apply Haiku tiers to other models', () => {
    expect(getModelPricing('claude-sonnet-5-5', 900000)).to.equal(MODEL_PRICING['claude-sonnet-5-5']);
  });

  it('returns null for unknown model', () => {
    expect(getModelPricing('unknown')).to.be.null;
    expect(getModelPricing(null)).to.be.null;
  });
});
