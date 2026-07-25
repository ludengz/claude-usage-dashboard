import { modelColor, modelDisplayName } from '../model-meta.js';

export function renderModelDistribution(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  if (!data.models || data.models.length === 0) {
    el.append('p').style('color', '#64748b').text('No data');
    return;
  }

  const containerWidth = container.clientWidth;
  const size = Math.min(containerWidth * 0.45, 200);
  const radius = size / 2;
  const innerRadius = radius * 0.55;

  const isNarrow = containerWidth < 280;
  const wrapper = el.append('div')
    .style('display', 'flex')
    .style('flex-direction', isNarrow ? 'column' : 'row')
    .style('align-items', 'center')
    .style('gap', isNarrow ? '8px' : '20px');

  const svg = wrapper.append('svg')
    .attr('width', size).attr('height', size)
    .style('flex-shrink', '0')
    .append('g').attr('transform', `translate(${size / 2},${size / 2})`);

  // Use non-cache tokens (input + output) for both slice size and percentages
  // so the share of each model matches Anthropic's official usage report.
  // Cache reads dominate total_tokens and drown out small-output models like
  // new Opus 4.7, making the distribution misleading.
  const nonCache = m => (m.input_tokens || 0) + (m.output_tokens || 0);
  const total = d3.sum(data.models, nonCache);
  const pie = d3.pie().value(nonCache).sort(null);
  const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);

  svg.selectAll('path').data(pie(data.models)).enter().append('path')
    .attr('d', arc).attr('fill', d => modelColor(d.data.id))
    .attr('stroke', '#1e293b').attr('stroke-width', 2);

  const legend = wrapper.append('div');
  data.models.forEach(m => {
    const pct = total > 0 ? ((nonCache(m) / total) * 100).toFixed(1) : '0.0';
    const color = modelColor(m.id);
    const shortName = modelDisplayName(m.id);
    // Build via .text() — model ids come from logs and must not be injected as HTML
    const row = legend.append('div').style('font-size', '11px').style('color', '#94a3b8').style('margin-bottom', '4px');
    row.append('span').style('color', color).text('●');
    row.append('span').text(` ${shortName} — ${pct}%`);
  });
}
