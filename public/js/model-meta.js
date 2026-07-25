// Single source of truth for how model ids are rendered across charts.
// Kept in sync with MODEL_PRICING in server/pricing.js — test/model-meta.test.js
// asserts every priced model has both a colour and a display name, so adding a
// model to the pricing table without updating this file fails the build.

// Mirrors normalizeModelId() in server/pricing.js: log model ids may carry a
// release-date suffix (e.g. claude-haiku-4-5-20251001) with no dedicated entry,
// so strip it before every lookup rather than enumerating suffixed variants.
export function normalizeModelId(modelId) {
  return typeof modelId === 'string' ? modelId.replace(/-\d{8}$/, '') : modelId;
}

// Warm near-monochrome ramp ("Ledger"): the Opus family carries the accent
// hue, Sonnet recedes into the neutral greys, Haiku takes the amber warning
// tone. Colour is a family signal here, not decoration.
export const MODEL_COLORS = {
  'claude-fable-5': '#C25B4E',
  'claude-opus-5': '#D97757',
  'claude-opus-4-8': '#C2764F',
  'claude-opus-4-7': '#B0765C',
  'claude-opus-4-6': '#8A6350',
  'claude-sonnet-5': '#C4BCAE',
  'claude-sonnet-4-6': '#B8B0A3',
  'claude-sonnet-4-5': '#8A8378',
  'claude-haiku-4-5': '#C9A227',
};

export const MODEL_DISPLAY = {
  'claude-fable-5': 'fable 5',
  'claude-opus-5': 'opus 5',
  'claude-opus-4-8': 'opus 4.8',
  'claude-opus-4-7': 'opus 4.7',
  'claude-opus-4-6': 'opus 4.6',
  'claude-sonnet-5': 'sonnet 5',
  'claude-sonnet-4-6': 'sonnet 4.6',
  'claude-sonnet-4-5': 'sonnet 4.5',
  'claude-haiku-4-5': 'haiku 4.5',
};

export const UNKNOWN_MODEL_COLOR = '#57534A';

export function modelColor(modelId) {
  return MODEL_COLORS[normalizeModelId(modelId)] || UNKNOWN_MODEL_COLOR;
}

// Unknown models still get a readable label: drop the vendor prefix and turn the
// version segments into a dotted version (claude-foo-9-1 -> foo 9.1).
export function modelDisplayName(modelId) {
  const id = normalizeModelId(modelId);
  return MODEL_DISPLAY[id] ||
    String(id).replace('claude-', '').replace(/-(\d+)-(\d+)/, ' $1.$2');
}
