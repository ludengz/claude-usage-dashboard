export const MODEL_PRICING = {
  'claude-opus-4-6': {
    input_price_per_mtok: 5,
    output_price_per_mtok: 25,
    cache_read_price_per_mtok: 0.50,
    cache_creation_price_per_mtok: 6.25,
  },
  'claude-sonnet-4-6': {
    input_price_per_mtok: 3,
    output_price_per_mtok: 15,
    cache_read_price_per_mtok: 0.30,
    cache_creation_price_per_mtok: 3.75,
  },
  'claude-haiku-4-5': {
    input_price_per_mtok: 1,
    output_price_per_mtok: 5,
    cache_read_price_per_mtok: 0.10,
    cache_creation_price_per_mtok: 1.25,
  },
};

export const PLAN_DEFAULTS = {
  pro: 20,
  max5x: 100,
  max20x: 200,
};

export function getModelPricing(modelId) {
  return MODEL_PRICING[modelId] || null;
}

/**
 * Calculate the API cost for a single usage record.
 * Returns 0 for unknown models.
 *
 * In Claude Code logs, input_tokens is the non-cached input.
 * cache_read_tokens and cache_creation_tokens are separate, additive fields.
 * cost = input * input_rate + cache_read * read_rate + cache_creation * write_rate + output * output_rate
 */
export function calculateRecordCost(record) {
  const pricing = MODEL_PRICING[record.model];
  if (!pricing) return 0;

  const M = 1_000_000;

  return (
    (record.input_tokens / M) * pricing.input_price_per_mtok +
    (record.cache_read_tokens / M) * pricing.cache_read_price_per_mtok +
    (record.cache_creation_tokens / M) * pricing.cache_creation_price_per_mtok +
    (record.output_tokens / M) * pricing.output_price_per_mtok
  );
}
