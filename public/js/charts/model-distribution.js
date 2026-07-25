import { modelColor, modelDisplayName } from '../model-meta.js';
import { C } from '../theme.js';

const SIZE = 80;
const RADIUS = 34;
const RING = 6;

export function renderModelDistribution(container, data) {
  container.innerHTML = '';

  if (!data.models || data.models.length === 0) {
    container.innerHTML = '<p class="empty">No data</p>';
    return;
  }

  // Non-cache tokens (input + output) drive both slice size and percentages so
  // the share matches Anthropic's own usage report. Cache reads dominate
  // total_tokens and would drown out low-output models.
  const nonCache = m => (m.input_tokens || 0) + (m.output_tokens || 0);
  const total = d3.sum(data.models, nonCache);

  const wrap = document.createElement('div');
  wrap.className = 'model-mix';

  const svgHost = document.createElement('div');
  svgHost.style.flexShrink = '0';
  wrap.appendChild(svgHost);

  const svg = d3.select(svgHost).append('svg')
    .attr('width', SIZE).attr('height', SIZE);
  svg.append('circle')
    .attr('cx', SIZE / 2).attr('cy', SIZE / 2).attr('r', RADIUS)
    .attr('fill', 'none').attr('stroke', C.track).attr('stroke-width', RING);

  const g = svg.append('g').attr('transform', `translate(${SIZE / 2},${SIZE / 2})`);
  const arc = d3.arc().innerRadius(RADIUS - RING / 2).outerRadius(RADIUS + RING / 2);
  const pie = d3.pie().value(nonCache).sort(null);

  if (total > 0) {
    g.selectAll('path').data(pie(data.models)).enter().append('path')
      .attr('d', arc)
      .attr('fill', d => modelColor(d.data.id));
  }

  const legend = document.createElement('div');
  legend.className = 'model-mix-legend';
  const sorted = [...data.models].sort((a, b) => nonCache(b) - nonCache(a));
  for (const m of sorted) {
    const pct = total > 0 ? (nonCache(m) / total) * 100 : 0;
    const row = document.createElement('div');
    row.className = 'model-mix-row';

    // Model ids come from logs — build via textContent, never innerHTML.
    const name = document.createElement('span');
    name.className = 'model-mix-name';
    const dot = document.createElement('i');
    dot.style.color = modelColor(m.id);
    dot.textContent = '■';
    name.appendChild(dot);
    name.appendChild(document.createTextNode(modelDisplayName(m.id)));

    const value = document.createElement('span');
    value.className = 'model-mix-pct';
    value.textContent = `${pct.toFixed(1)}%`;

    row.appendChild(name);
    row.appendChild(value);
    legend.appendChild(row);
  }

  const note = document.createElement('div');
  note.className = 'model-mix-note';
  note.textContent = 'on input + output tokens';
  legend.appendChild(note);

  wrap.appendChild(legend);
  container.appendChild(wrap);
}
