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
  'claude-fable-5-2': '#E04A3F',
  'claude-fable-5-1': '#A9433A',
  'claude-fable-5': '#C25B4E',
  'claude-opus-5-5': '#E8956B',
  'claude-opus-5': '#D97757',
  'claude-opus-4-8': '#C2764F',
  'claude-opus-4-7': '#B0765C',
  'claude-opus-4-6': '#8A6350',
  'claude-sonnet-5-5': '#D4CEC3',
  'claude-sonnet-5': '#C4BCAE',
  'claude-sonnet-4-6': '#B8B0A3',
  'claude-sonnet-4-5': '#8A8378',
  'claude-haiku-5-5': '#E2B84B',
  'claude-haiku-4-5': '#C9A227',
};

// The same families on the light theme's paper panel. Pale greys and amber
// vanish on white, so each ramp inverts: the newest model takes the strongest
// tone, and every colour keeps at least 3:1 contrast with the panel
// (test/model-meta.test.js checks both).
export const MODEL_COLORS_LIGHT = {
  'claude-fable-5-2': '#B3302A',
  'claude-fable-5-1': '#C9574A',
  'claude-fable-5': '#D06E5E',
  'claude-opus-5-5': '#A34A2E',
  'claude-opus-5': '#BF5F3E',
  'claude-opus-4-8': '#C9774F',
  'claude-opus-4-7': '#A87560',
  'claude-opus-4-6': '#8A6350',
  'claude-sonnet-5-5': '#4F4B45',
  'claude-sonnet-5': '#6B665E',
  'claude-sonnet-4-6': '#837D72',
  'claude-sonnet-4-5': '#938D81',
  'claude-haiku-5-5': '#9C7A12',
  'claude-haiku-4-5': '#AC8717',
};

export const MODEL_DISPLAY = {
  'claude-fable-5-2': 'fable 5.2',
  'claude-fable-5-1': 'fable 5.1',
  'claude-fable-5': 'fable 5',
  'claude-opus-5-5': 'opus 5.5',
  'claude-opus-5': 'opus 5',
  'claude-opus-4-8': 'opus 4.8',
  'claude-opus-4-7': 'opus 4.7',
  'claude-opus-4-6': 'opus 4.6',
  'claude-sonnet-5-5': 'sonnet 5.5',
  'claude-sonnet-5': 'sonnet 5',
  'claude-sonnet-4-6': 'sonnet 4.6',
  'claude-sonnet-4-5': 'sonnet 4.5',
  'claude-haiku-5-5': 'haiku 5.5',
  'claude-haiku-4-5': 'haiku 4.5',
};

export const UNKNOWN_MODEL_COLOR = '#57534A';
export const UNKNOWN_MODEL_COLOR_LIGHT = '#B5B0A6';

// The header toggle sets data-theme on <html>; dark is the default.
function isLightTheme() {
  return typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'light';
}

export function modelColor(modelId, light = isLightTheme()) {
  const palette = light ? MODEL_COLORS_LIGHT : MODEL_COLORS;
  return palette[normalizeModelId(modelId)] || (light ? UNKNOWN_MODEL_COLOR_LIGHT : UNKNOWN_MODEL_COLOR);
}

// Unknown models still get a readable label: drop the vendor prefix and turn the
// version segments into a dotted version (claude-foo-9-1 -> foo 9.1).
export function modelDisplayName(modelId) {
  const id = normalizeModelId(modelId);
  return MODEL_DISPLAY[id] ||
    String(id).replace('claude-', '').replace(/-(\d+)-(\d+)/, ' $1.$2');
}
