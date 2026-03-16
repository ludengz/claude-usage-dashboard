const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#4ade80', '#ef4444', '#ec4899', '#06b6d4'];

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

export function renderProjectDistribution(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  if (!data.projects || data.projects.length === 0) {
    el.append('p').style('color', '#64748b').text('No data');
    return;
  }

  const margin = { top: 10, right: 360, bottom: 10, left: 120 };
  const barHeight = 24;
  const gap = 8;
  const height = data.projects.length * (barHeight + gap) + margin.top + margin.bottom;
  const width = container.clientWidth - margin.left - margin.right;

  const svg = el.append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, d3.max(data.projects, d => d.total_tokens)]).range([0, width]);
  const y = d3.scaleBand().domain(data.projects.map(d => d.name)).range([0, height - margin.top - margin.bottom]).padding(0.25);

  // Project name labels
  svg.selectAll('.project-label').data(data.projects).enter().append('text')
    .attr('x', -8).attr('y', d => y(d.name) + y.bandwidth() / 2)
    .attr('text-anchor', 'end').attr('dominant-baseline', 'middle')
    .style('fill', '#e2e8f0').style('font-size', '12px').text(d => d.name);

  // Stacked bars: cache_read + cache_creation + input + output
  const cr = d => d.cache_read_tokens || 0;
  const cc = d => d.cache_creation_tokens || 0;

  svg.selectAll('.bar-cache-read').data(data.projects).enter().append('rect')
    .attr('x', 0).attr('y', d => y(d.name))
    .attr('width', d => x(cr(d))).attr('height', y.bandwidth())
    .attr('fill', '#4ade80').attr('opacity', 0.6).attr('rx', 3);

  svg.selectAll('.bar-cache-creation').data(data.projects).enter().append('rect')
    .attr('x', d => x(cr(d))).attr('y', d => y(d.name))
    .attr('width', d => x(cr(d) + cc(d)) - x(cr(d))).attr('height', y.bandwidth())
    .attr('fill', '#f59e0b').attr('opacity', 0.6);

  svg.selectAll('.bar-input').data(data.projects).enter().append('rect')
    .attr('x', d => x(cr(d) + cc(d))).attr('y', d => y(d.name))
    .attr('width', d => x(cr(d) + cc(d) + d.total_input_tokens) - x(cr(d) + cc(d))).attr('height', y.bandwidth())
    .attr('fill', '#3b82f6').attr('opacity', 0.7);

  svg.selectAll('.bar-output').data(data.projects).enter().append('rect')
    .attr('x', d => x(cr(d) + cc(d) + d.total_input_tokens)).attr('y', d => y(d.name))
    .attr('width', d => x(d.total_tokens) - x(cr(d) + cc(d) + d.total_input_tokens)).attr('height', y.bandwidth())
    .attr('fill', '#f97316').attr('opacity', 0.7);

  // Right-side label: tokens + cost
  svg.selectAll('.detail-label').data(data.projects).enter().append('text')
    .attr('x', d => x(d.total_tokens) + 8).attr('y', d => y(d.name) + y.bandwidth() / 2)
    .attr('dominant-baseline', 'middle')
    .style('font-size', '11px')
    .html(d => {
      // Use tspans for colored segments
      return '';
    })
    .each(function(d) {
      const text = d3.select(this);
      text.append('tspan').style('fill', '#f8fafc').style('font-weight', '600').text(fmt(d.total_tokens));
      text.append('tspan').style('fill', '#64748b').text(' (');
      text.append('tspan').style('fill', '#4ade80').text(`cr:${fmt(d.cache_read_tokens || 0)}`);
      text.append('tspan').style('fill', '#64748b').text('/');
      text.append('tspan').style('fill', '#f59e0b').text(`cw:${fmt(d.cache_creation_tokens || 0)}`);
      text.append('tspan').style('fill', '#64748b').text('/');
      text.append('tspan').style('fill', '#60a5fa').text(`in:${fmt(d.total_input_tokens)}`);
      text.append('tspan').style('fill', '#64748b').text('/');
      text.append('tspan').style('fill', '#f97316').text(`out:${fmt(d.total_output_tokens)}`);
      text.append('tspan').style('fill', '#64748b').text(')  ');
      text.append('tspan').style('fill', '#f59e0b').style('font-weight', '600').text(`$${d.estimated_cost_usd.toFixed(2)}`);
    });

  // Legend
  const legend = el.append('div').style('display', 'flex').style('gap', '16px').style('margin-top', '8px');
  legend.append('span').style('font-size', '11px').style('color', '#4ade80').html('● Cache Read');
  legend.append('span').style('font-size', '11px').style('color', '#f59e0b').html('● Cache Write');
  legend.append('span').style('font-size', '11px').style('color', '#60a5fa').html('● Input');
  legend.append('span').style('font-size', '11px').style('color', '#f97316').html('● Output');
}
