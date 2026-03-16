export function renderCostComparison(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  const margin = { top: 10, right: 20, bottom: 40, left: 50 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = 180 - margin.top - margin.bottom;

  const svg = el.append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const bars = [
    { label: 'Subscription', value: data.subscription_cost_usd, color: '#3b82f6' },
    { label: 'API Cost', value: data.api_equivalent_cost_usd, color: '#f59e0b' },
  ];

  const x = d3.scaleBand().domain(bars.map(d => d.label)).range([0, width]).padding(0.4);
  const y = d3.scaleLinear().domain([0, d3.max(bars, d => d.value) * 1.2]).range([height, 0]);

  svg.append('g').attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x))
    .selectAll('text').style('fill', '#94a3b8').style('font-size', '11px');
  svg.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d => `$${d}`))
    .selectAll('text').style('fill', '#64748b').style('font-size', '10px');

  svg.selectAll('.bar').data(bars).enter().append('rect')
    .attr('x', d => x(d.label)).attr('y', d => y(d.value))
    .attr('width', x.bandwidth()).attr('height', d => height - y(d.value))
    .attr('fill', d => d.color).attr('rx', 4);

  svg.selectAll('.label').data(bars).enter().append('text')
    .attr('x', d => x(d.label) + x.bandwidth() / 2).attr('y', d => y(d.value) - 5)
    .attr('text-anchor', 'middle')
    .style('fill', '#f8fafc').style('font-size', '12px').style('font-weight', '600')
    .text(d => `$${d.value.toFixed(2)}`);
}
