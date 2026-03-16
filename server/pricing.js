export const MODEL_PRICING = {
  'claude-opus-4-6': {
    input_price_per_mtok: 15,
    output_price_per_mtok: 75,
    cache_read_price_per_mtok: 1.5,
    cache_creation_price_per_mtok: 18.75,
  },
  'claude-sonnet-4-6': {
    input_price_per_mtok: 3,
    output_price_per_mtok: 15,
    cache_read_price_per_mtok: 0.30,
    cache_creation_price_per_mtok: 3.75,
  },
  'claude-haiku-4-5': {
    input_price_per_mtok: 0.80,
    output_price_per_mtok: 4,
    cache_read_price_per_mtok: 0.08,
    cache_creation_price_per_mtok: 1.0,
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

export function calculateRecordCost(record) {
  const pricing = MODEL_PRICING[record.model];
  if (!pricing) return 0;

  const nonCachedInput = record.input_tokens - record.cache_read_tokens - record.cache_creation_tokens;
  const M = 1_000_000;

  return (
    (nonCachedInput / M) * pricing.input_price_per_mtok +
    (record.cache_read_tokens / M) * pricing.cache_read_price_per_mtok +
    (record.cache_creation_tokens / M) * pricing.cache_creation_price_per_mtok +
    (record.output_tokens / M) * pricing.output_price_per_mtok
  );
}
