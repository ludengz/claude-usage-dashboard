// Standard API-equivalent rates (USD per million tokens), checked 2026-11-02:
// https://platform.claude.com/docs/en/about-claude/pricing
// Cache creation uses the 5-minute rate; historical usage is valued at current rates.
export const MODEL_PRICING = {
  // Same per-token rates as Fable 5 except cache reads, which drop to 0.025x
  // base input (a quarter of Fable 5's 0.1x rate).
  'claude-fable-5-1': {
    input_price_per_mtok: 10,
    output_price_per_mtok: 50,
    cache_read_price_per_mtok: 0.25,
    cache_creation_price_per_mtok: 12.50,
  },
  'claude-fable-5': {
    input_price_per_mtok: 10,
    output_price_per_mtok: 50,
    cache_read_price_per_mtok: 1.00,
    cache_creation_price_per_mtok: 12.50,
  },
  'claude-opus-5-5': {
    input_price_per_mtok: 4,
    output_price_per_mtok: 20,
    cache_read_price_per_mtok: 0.20,
    cache_creation_price_per_mtok: 5,
  },
  'claude-opus-5': {
    input_price_per_mtok: 5,
    output_price_per_mtok: 25,
    cache_read_price_per_mtok: 0.50,
    cache_creation_price_per_mtok: 6.25,
  },
  'claude-opus-4-6': {
    input_price_per_mtok: 5,
    output_price_per_mtok: 25,
    cache_read_price_per_mtok: 0.50,
    cache_creation_price_per_mtok: 6.25,
  },
  'claude-opus-4-7': {
    input_price_per_mtok: 5,
    output_price_per_mtok: 25,
    cache_read_price_per_mtok: 0.50,
    cache_creation_price_per_mtok: 6.25,
  },
  'claude-opus-4-8': {
    input_price_per_mtok: 5,
    output_price_per_mtok: 25,
    cache_read_price_per_mtok: 0.50,
    cache_creation_price_per_mtok: 6.25,
  },
  'claude-sonnet-5-5': {
    input_price_per_mtok: 2,
    output_price_per_mtok: 10,
    cache_read_price_per_mtok: 0.10,
    cache_creation_price_per_mtok: 2.50,
  },
  'claude-sonnet-5': {
    input_price_per_mtok: 2,
    output_price_per_mtok: 10,
    cache_read_price_per_mtok: 0.20,
    cache_creation_price_per_mtok: 2.50,
  },
  'claude-sonnet-4-6': {
    input_price_per_mtok: 3,
    output_price_per_mtok: 15,
    cache_read_price_per_mtok: 0.30,
    cache_creation_price_per_mtok: 3.75,
  },
  'claude-sonnet-4-5': {
    input_price_per_mtok: 3,
    output_price_per_mtok: 15,
    cache_read_price_per_mtok: 0.30,
    cache_creation_price_per_mtok: 3.75,
  },
  'claude-haiku-5-5': {
    input_price_per_mtok: 0.10,
    output_price_per_mtok: 0.50,
    cache_read_price_per_mtok: 0.01,
    cache_creation_price_per_mtok: 0.125,
    long_context: {
      threshold_tokens: 100_000,
      input_price_per_mtok: 0.50,
      output_price_per_mtok: 2.50,
      cache_read_price_per_mtok: 0.05,
      cache_creation_price_per_mtok: 0.625,
    },
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

// Log model ids may carry a release-date suffix (e.g. claude-haiku-4-5-20251001)
// that has no dedicated pricing entry; strip it so they resolve to the base model.
function normalizeModelId(modelId) {
  return typeof modelId === 'string' ? modelId.replace(/-\d{8}$/, '') : modelId;
}

export function getModelPricing(modelId, promptTokens = 0) {
  const pricing = MODEL_PRICING[normalizeModelId(modelId)];
  if (!pricing) return null;
  return pricing.long_context && promptTokens > pricing.long_context.threshold_tokens
    ? pricing.long_context
    : pricing;
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
  // The tier applies to the whole request, including output and cache tokens.
  // Only input (cached and uncached) counts toward the prompt-length threshold.
  const promptTokens = record.input_tokens + record.cache_read_tokens + record.cache_creation_tokens;
  const pricing = getModelPricing(record.model, promptTokens);
  if (!pricing) return 0;

  const M = 1_000_000;

  return (
    (record.input_tokens / M) * pricing.input_price_per_mtok +
    (record.cache_read_tokens / M) * pricing.cache_read_price_per_mtok +
    (record.cache_creation_tokens / M) * pricing.cache_creation_price_per_mtok +
    (record.output_tokens / M) * pricing.output_price_per_mtok
  );
}
