// "Ledger" design tokens — the single source of truth for chart colours.
// Mirrors the custom properties in css/style.css; charts draw into SVG/inline
// styles where CSS variables are awkward, so the palette lives here too.

export const C = {
  text: '#F2F0EA',
  text2: '#A5A099',
  text3: '#6D6862',
  text4: '#4A4740',
  text5: '#3A3833',

  line: '#232219',
  lineSoft: '#1F1E1B',
  track: '#201F1B',
  trackDeep: '#1B1A17',

  accent: '#D97757',
  accentDim: '#B0765C',
  accentGhost: '#3A2F26',

  ok: '#7C9A76',
  warn: '#C9A227',
  danger: '#C25B4E',
  neutral: '#C4BCAE',
};

// Token mix, darkest (cheapest) to brightest (most expensive). The ramp itself
// encodes price: cache reads are ~10x cheaper than output, so they recede.
export const MIX = {
  cacheRead: '#57534A',
  cacheWrite: '#8A8378',
  input: '#B8B0A3',
  output: '#D97757',
};

export const MIX_LEGEND = [
  { key: 'cacheRead', label: 'cache read', color: MIX.cacheRead },
  { key: 'cacheWrite', label: 'cache write', color: MIX.cacheWrite },
  { key: 'input', label: 'input', color: MIX.input },
  { key: 'output', label: 'output', color: MIX.output },
];

export const HEAT = ['#1F1E1B', '#3A3833', '#8A6350', '#D97757'];

// Healthy meters stay neutral; colour appears only as a warning. Keeping green
// off the happy path is what makes the single accent readable.
export function meterColor(pct) {
  if (pct >= 80) return C.danger;
  if (pct >= 50) return C.warn;
  if (pct > 0) return C.neutral;
  return C.text5;
}

export function heatColor(ratio) {
  if (ratio === 0) return HEAT[0];
  if (ratio < 0.33) return HEAT[1];
  if (ratio < 0.66) return HEAT[2];
  return HEAT[3];
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
