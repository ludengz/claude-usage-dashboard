// d3 is loaded as a global via <script> tag in index.html — used here only for
// scale/tick maths; the bars themselves are DOM so they reflow with the panel
// instead of being pinned to a measured clientWidth.
import { C, MIX, MIX_LEGEND, heatColor, fmtTokens, fmtHour } from '../theme.js';

const PLOT_H = 196;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const emptyBucket = (time) => ({
  time, input_tokens: 0, output_tokens: 0,
  cache_read_tokens: 0, cache_creation_tokens: 0, estimated_cost_usd: 0,
});

// Fill in missing time slots so blank periods stay visible as gaps
function fillBuckets(data) {
  const bucketMap = new Map(data.buckets.map(b => [b.time, b]));
  const pad = n => String(n).padStart(2, '0');
  let keys;
  if (data.granularity === 'hourly') {
    keys = [];
    const cur = new Date(data.buckets[0].time.replace('T', ' ') + ':00');
    const end = new Date(data.buckets[data.buckets.length - 1].time.replace('T', ' ') + ':00');
    while (cur <= end) {
      keys.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}T${pad(cur.getHours())}:00`);
      cur.setHours(cur.getHours() + 1);
    }
  } else if (data.granularity === 'daily') {
    keys = [];
    const cur = new Date(data.buckets[0].time + 'T00:00:00');
    const end = new Date(data.buckets[data.buckets.length - 1].time + 'T00:00:00');
    while (cur <= end) {
      keys.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    keys = data.buckets.map(b => b.time);
  }
  return keys.map(k => bucketMap.get(k) || emptyBucket(k));
}

function formatTick(t) {
  const h = t.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):00$/);
  if (h) return `${MONTHS[+h[1] - 1]} ${+h[2]} ${fmtHour(+h[3])}`;
  const m = t.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (m) return `${MONTHS[+m[1] - 1]} ${+m[2]}`;
  return t;
}

let tooltipEl = null;
function tooltip() {
  if (!tooltipEl || !document.body.contains(tooltipEl)) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'd3-tooltip';
    tooltipEl.style.display = 'none';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function renderTokenTrend(container, data, opts = {}) {
  const showDollars = opts.yAxis === 'dollars';
  container.innerHTML = '';

  if (!data.buckets || data.buckets.length === 0) {
    container.innerHTML = '<p class="empty">No data for selected range</p>';
    return;
  }

  const buckets = fillBuckets(data);
  const totalOf = d => d.input_tokens + d.output_tokens + (d.cache_read_tokens || 0) + (d.cache_creation_tokens || 0);
  const valueOf = showDollars ? (d => d.estimated_cost_usd || 0) : totalOf;

  const maxVal = Math.max(...buckets.map(valueOf), 0) || 1;
  const scale = d3.scaleLinear().domain([0, maxVal * 1.08]).nice();
  const domainMax = scale.domain()[1] || 1;
  const axisFmt = showDollars
    ? (v => v >= 1 ? `$${d3.format('.2~s')(v)}` : `$${v.toFixed(2)}`)
    : (v => d3.format('.2~s')(v).replace('G', 'B'));

  // ---- plot ------------------------------------------------
  const plot = document.createElement('div');
  plot.className = 'trend-plot';

  for (const t of scale.ticks(3).filter(v => v > 0 && v <= domainMax)) {
    const top = (1 - t / domainMax) * PLOT_H;
    const line = document.createElement('div');
    line.className = 'trend-grid';
    line.style.top = `${top}px`;
    plot.appendChild(line);
    const label = document.createElement('div');
    label.className = 'trend-grid-label';
    label.style.top = `${top - 6}px`;
    label.textContent = axisFmt(t);
    plot.appendChild(label);
  }
  const base = document.createElement('div');
  base.className = 'trend-grid is-base';
  base.style.top = `${PLOT_H}px`;
  plot.appendChild(base);

  const bars = document.createElement('div');
  bars.className = 'trend-bars';
  const segments = showDollars
    ? [{ key: 'estimated_cost_usd', color: C.accent }]
    : [
        { key: 'output_tokens', color: MIX.output },
        { key: 'input_tokens', color: MIX.input },
        { key: 'cache_creation_tokens', color: MIX.cacheWrite },
        { key: 'cache_read_tokens', color: MIX.cacheRead },
      ];

  for (const b of buckets) {
    const col = document.createElement('div');
    col.className = 'trend-bar';
    segments.forEach((s, i) => {
      const v = b[s.key] || 0;
      if (v <= 0) return;
      const seg = document.createElement('div');
      seg.style.height = `${(v / domainMax) * 100}%`;
      seg.style.background = s.color;
      if (i === 0) seg.style.borderRadius = '1px 1px 0 0';
      col.appendChild(seg);
    });
    col.addEventListener('mouseenter', () => {
      const tip = tooltip();
      const cost = b.estimated_cost_usd || 0;
      tip.innerHTML = `<b>${formatTick(b.time)}</b><br>` +
        `total <b>${fmtTokens(totalOf(b))}</b> · <span style="color:${C.accent}">$${cost.toFixed(2)}</span><br>` +
        `<span style="color:${MIX.cacheRead}">■</span> cache read ${fmtTokens(b.cache_read_tokens || 0)}<br>` +
        `<span style="color:${MIX.cacheWrite}">■</span> cache write ${fmtTokens(b.cache_creation_tokens || 0)}<br>` +
        `<span style="color:${MIX.input}">■</span> input ${fmtTokens(b.input_tokens)}<br>` +
        `<span style="color:${MIX.output}">■</span> output ${fmtTokens(b.output_tokens)}`;
      tip.style.display = 'block';
    });
    col.addEventListener('mousemove', (e) => {
      const tip = tooltip();
      tip.style.left = `${e.pageX + 12}px`;
      tip.style.top = `${e.pageY - 10}px`;
    });
    col.addEventListener('mouseleave', () => { tooltip().style.display = 'none'; });
    bars.appendChild(col);
  }
  plot.appendChild(bars);
  container.appendChild(plot);

  // ---- x ticks ---------------------------------------------
  const ticks = document.createElement('div');
  ticks.className = 'trend-ticks';
  const tickCount = Math.min(7, buckets.length);
  const step = tickCount > 1 ? (buckets.length - 1) / (tickCount - 1) : 0;
  for (let i = 0; i < tickCount; i++) {
    const span = document.createElement('span');
    span.textContent = formatTick(buckets[Math.round(i * step)].time);
    ticks.appendChild(span);
  }
  container.appendChild(ticks);

  // ---- stats strip -----------------------------------------
  // Server-computed totals (from raw records) are authoritative; bucket sums
  // are only a fallback.
  const t = data.total || {};
  const totals = {
    cacheRead: t.cache_read_tokens ?? buckets.reduce((s, d) => s + (d.cache_read_tokens || 0), 0),
    cacheWrite: t.cache_creation_tokens ?? buckets.reduce((s, d) => s + (d.cache_creation_tokens || 0), 0),
    input: t.input_tokens ?? buckets.reduce((s, d) => s + d.input_tokens, 0),
    output: t.output_tokens ?? buckets.reduce((s, d) => s + d.output_tokens, 0),
    cost: t.estimated_api_cost_usd ?? buckets.reduce((s, d) => s + (d.estimated_cost_usd || 0), 0),
  };
  totals.all = totals.cacheRead + totals.cacheWrite + totals.input + totals.output;

  const vals = buckets.map(valueOf);
  const nonZero = vals.filter(v => v > 0);
  const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
  const max = nonZero.length ? Math.max(...nonZero) : 0;
  const fmtStat = showDollars ? (v => `$${v.toFixed(2)}`) : (v => fmtTokens(Math.round(v)));
  const granLabel = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month' }[data.granularity] || 'bucket';

  const stats = [
    { label: `avg/${granLabel}`, value: fmtStat(avg) },
    { label: 'max', value: fmtStat(max) },
    { label: 'active', value: `${nonZero.length} / ${buckets.length} ${granLabel}s` },
  ];
  if (data.granularity === 'hourly') {
    const days = new Set(buckets.map(b => b.time.slice(0, 10))).size || 1;
    stats.push({ label: 'avg/day', value: `${(nonZero.length / days).toFixed(1)} h` });
  } else if (data.granularity === 'daily') {
    const weeks = Math.max(1, buckets.length / 7);
    stats.push({ label: 'avg/week', value: `${(nonZero.length / weeks).toFixed(1)} d` });
  }

  const strip = document.createElement('div');
  strip.className = 'trend-stats';
  strip.innerHTML =
    `<span class="trend-total" title="${totals.all.toLocaleString()} tokens">${fmtTokens(totals.all)} tokens<b>$${totals.cost.toFixed(2)}</b></span>` +
    `<span class="trend-sep"></span>` +
    stats.map(s => `<span class="trend-stat">${s.label} <b>${s.value}</b></span>`).join('');
  container.appendChild(strip);

  const legend = document.createElement('div');
  legend.className = 'mix-legend';
  legend.innerHTML = MIX_LEGEND.map(m => {
    const key = { cacheRead: 'cacheRead', cacheWrite: 'cacheWrite', input: 'input', output: 'output' }[m.key];
    return `<span><i style="color:${m.color}">■</i>${m.label} ${fmtTokens(totals[key])}</span>`;
  }).join('');
  container.appendChild(legend);

  // ---- active hours ----------------------------------------
  const hourAgg = new Array(24).fill(0);
  let hasHourly = false;
  for (const b of buckets) {
    const hm = b.time.match(/T(\d{2}):00$/);
    if (!hm) continue;
    hasHourly = true;
    hourAgg[+hm[1]] += valueOf(b);
  }
  if (!hasHourly || !hourAgg.some(v => v > 0)) return;

  const maxHour = Math.max(...hourAgg);
  const peakHour = hourAgg.indexOf(maxHour);

  const hours = document.createElement('div');
  hours.className = 'trend-hours';
  const head = document.createElement('div');
  head.className = 'trend-hours-head';
  head.innerHTML =
    `<div class="trend-hours-title">Active hours</div>` +
    `<div class="trend-hours-peak">Peak <b>${fmtHour(peakHour)}</b></div>`;
  hours.appendChild(head);

  const body = document.createElement('div');
  body.style.flex = '1';
  body.style.minWidth = '0';
  const heatBars = document.createElement('div');
  heatBars.className = 'heat-bars';
  const heatLabels = document.createElement('div');
  heatLabels.className = 'heat-labels';
  for (let h = 0; h < 24; h++) {
    const ratio = maxHour > 0 ? hourAgg[h] / maxHour : 0;
    const cell = document.createElement('div');
    cell.style.height = `${Math.max(3, ratio * 100)}%`;
    cell.style.background = heatColor(ratio);
    cell.title = `${fmtHour(h)}: ${showDollars ? '$' + hourAgg[h].toFixed(2) : fmtTokens(Math.round(hourAgg[h]))}`;
    heatBars.appendChild(cell);
    const label = document.createElement('div');
    label.textContent = h % 6 === 0 ? fmtHour(h) : '';
    heatLabels.appendChild(label);
  }
  body.appendChild(heatBars);
  body.appendChild(heatLabels);
  hours.appendChild(body);
  container.appendChild(hours);
}
