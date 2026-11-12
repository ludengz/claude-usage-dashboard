// "Ledger" design tokens for charts. The custom properties in css/style.css are
// the single source of truth, for both the default dark theme and the light
// one: charts draw into SVG attributes and inline styles, where var() is
// unreliable, so they read the resolved values here at render time.
//
// DARK_FALLBACK only applies where there is no stylesheet to read (Node tests);
// test/theme.test.js keeps it identical to the dark :root block.

export const TOKEN_VARS = {
  text: '--text',
  text2: '--text-2',
  text3: '--text-3',
  text4: '--text-4',
  text5: '--text-5',

  line: '--line',
  lineSoft: '--line-soft',
  track: '--track',
  trackDeep: '--track-deep',

  accent: '--accent',
  accentDim: '--accent-dim',
  accentGhost: '--accent-ghost',

  ok: '--ok',
  warn: '--warn',
  danger: '--danger',
  neutral: '--neutral',
};

// Token mix, cheapest to most expensive. The ramp itself encodes price: cache
// reads are ~10x cheaper than output, so they recede into the background.
export const MIX_VARS = {
  cacheRead: '--mix-cr',
  cacheWrite: '--mix-cw',
  input: '--mix-in',
  output: '--mix-out',
};

const HEAT_VARS = ['--heat-0', '--heat-1', '--heat-2', '--heat-3'];

export const DARK_FALLBACK = {
  '--text': '#F2F0EA',
  '--text-2': '#A5A099',
  '--text-3': '#6D6862',
  '--text-4': '#4A4740',
  '--text-5': '#3A3833',
  '--line': '#232219',
  '--line-soft': '#1F1E1B',
  '--track': '#201F1B',
  '--track-deep': '#1B1A17',
  '--accent': '#D97757',
  '--accent-dim': '#B0765C',
  '--accent-ghost': '#3A2F26',
  '--ok': '#7C9A76',
  '--warn': '#C9A227',
  '--danger': '#C25B4E',
  '--neutral': '#C4BCAE',
  '--mix-cr': '#57534A',
  '--mix-cw': '#8A8378',
  '--mix-in': '#B8B0A3',
  '--mix-out': '#D97757',
  '--heat-0': '#1F1E1B',
  '--heat-1': '#3A3833',
  '--heat-2': '#8A6350',
  '--heat-3': '#D97757',
};

// getComputedStyle is too slow to call per bar, so resolve every token once
// and keep the result until the theme changes.
let resolved = null;

function resolveTokens() {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return DARK_FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const out = {};
  for (const [name, fallback] of Object.entries(DARK_FALLBACK)) {
    out[name] = style.getPropertyValue(name).trim() || fallback;
  }
  return out;
}

function token(name) {
  if (!resolved) resolved = resolveTokens();
  return resolved[name];
}

/** Drop the resolved palette; call after switching data-theme. */
export function invalidateThemeTokens() {
  resolved = null;
}

function tokenGetters(vars) {
  const obj = {};
  for (const [key, name] of Object.entries(vars)) {
    Object.defineProperty(obj, key, { enumerable: true, get: () => token(name) });
  }
  return Object.freeze(obj);
}

export const C = tokenGetters(TOKEN_VARS);
export const MIX = tokenGetters(MIX_VARS);

export const MIX_LEGEND = [
  { key: 'cacheRead', label: 'cache read' },
  { key: 'cacheWrite', label: 'cache write' },
  { key: 'input', label: 'input' },
  { key: 'output', label: 'output' },
].map(entry => Object.freeze({ ...entry, get color() { return MIX[entry.key]; } }));

// Healthy meters stay neutral; colour appears only as a warning. Keeping green
// off the happy path is what makes the single accent readable.
export function meterColor(pct) {
  if (pct >= 80) return C.danger;
  if (pct >= 50) return C.warn;
  if (pct > 0) return C.neutral;
  return C.text5;
}

export function heatColor(ratio) {
  if (ratio === 0) return token(HEAT_VARS[0]);
  if (ratio < 0.33) return token(HEAT_VARS[1]);
  if (ratio < 0.66) return token(HEAT_VARS[2]);
  return token(HEAT_VARS[3]);
}

export function fmtTokens(n) {
  if (n == null) return '—';
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return Math.round(n / 1_000) + 'K';
  return String(Math.round(n));
}

export function fmtCost(n) {
  return n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtHour(h) {
  if (h === 0) return '12AM';
  if (h < 12) return `${h}AM`;
  if (h === 12) return '12PM';
  return `${h - 12}PM`;
}

// Project and model names come straight from JSONL logs / directory names —
// escape them before any innerHTML interpolation.
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
