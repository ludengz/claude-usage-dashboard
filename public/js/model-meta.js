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

export const MODEL_COLORS = {
  'claude-fable-5': '#ec4899',
  'claude-opus-4-8': '#7c3aed',
  'claude-opus-4-7': '#a78bfa',
  'claude-opus-4-6': '#8b5cf6',
  'claude-sonnet-5': '#60a5fa',
  'claude-sonnet-4-6': '#3b82f6',
  'claude-sonnet-4-5': '#2563eb',
  'claude-haiku-4-5': '#f59e0b',
};

export const MODEL_DISPLAY = {
  'claude-fable-5': 'fable 5',
  'claude-opus-4-8': 'opus 4.8',
  'claude-opus-4-7': 'opus 4.7',
  'claude-opus-4-6': 'opus 4.6',
  'claude-sonnet-5': 'sonnet 5',
  'claude-sonnet-4-6': 'sonnet 4.6',
  'claude-sonnet-4-5': 'sonnet 4.5',
  'claude-haiku-4-5': 'haiku 4.5',
};

export const UNKNOWN_MODEL_COLOR = '#64748b';

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
