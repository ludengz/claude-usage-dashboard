const MODEL_COLORS = {
  'claude-sonnet-4-6': '#3b82f6',
  'claude-opus-4-6': '#8b5cf6',
  'claude-haiku-4-5': '#f59e0b',
};

const MODEL_DISPLAY = {
  'claude-opus-4-6': 'opus 4.6',
  'claude-sonnet-4-6': 'sonnet 4.6',
  'claude-haiku-4-5': 'haiku 4.5',
  'claude-haiku-4-5-20251001': 'haiku 4.5',
};

export function renderModelDistribution(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  if (!data.models || data.models.length === 0) {
    el.append('p').style('color', '#64748b').text('No data');
    return;
  }

  const size = Math.min(container.clientWidth, 200);
  const radius = size / 2;
  const innerRadius = radius * 0.55;

  const wrapper = el.append('div').style('display', 'flex').style('align-items', 'center').style('gap', '20px');

  const svg = wrapper.append('svg').attr('width', size).attr('height', size)
    .append('g').attr('transform', `translate(${size / 2},${size / 2})`);

  const total = d3.sum(data.models, d => d.total_tokens);
  const pie = d3.pie().value(d => d.total_tokens).sort(null);
  const arc = d3.arc().innerRadius(innerRadius).outerRadius(radius);

  svg.selectAll('path').data(pie(data.models)).enter().append('path')
    .attr('d', arc).attr('fill', d => MODEL_COLORS[d.data.id] || '#64748b')
    .attr('stroke', '#1e293b').attr('stroke-width', 2);

  const legend = wrapper.append('div');
  data.models.forEach(m => {
    const pct = ((m.total_tokens / total) * 100).toFixed(1);
    const color = MODEL_COLORS[m.id] || '#64748b';
    const shortName = MODEL_DISPLAY[m.id] || m.id.replace('claude-', '').replace(/-(\d+)-(\d+)/, ' $1.$2');
    legend.append('div').style('font-size', '11px').style('color', '#94a3b8').style('margin-bottom', '4px')
      .html(`<span style="color:${color}">●</span> ${shortName} — ${pct}%`);
  });
}
