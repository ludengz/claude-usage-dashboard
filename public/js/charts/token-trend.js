// d3 is loaded as a global via <script> tag in index.html

export function renderTokenTrend(container, data) {
  const el = d3.select(container);
  el.selectAll('*').remove();

  if (!data.buckets || data.buckets.length === 0) {
    el.append('p').style('color', '#64748b').text('No data for selected range');
    return;
  }

  const margin = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = 250 - margin.top - margin.bottom;

  const svg = el.append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const buckets = data.buckets;
  const x = d3.scaleBand()
    .domain(buckets.map(d => d.time))
    .range([0, width])
    .padding(0.1);

  const maxVal = d3.max(buckets, d => d.input_tokens + d.output_tokens);
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([height, 0]);

  const xAxis = svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickValues(x.domain().filter((_, i) => i % Math.ceil(buckets.length / 10) === 0)));
  xAxis.selectAll('text').style('fill', '#64748b').style('font-size', '10px')
    .attr('transform', 'rotate(-45)').attr('text-anchor', 'end');
  xAxis.selectAll('line, path').style('stroke', '#334155');

  const yAxis = svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.2s')));
  yAxis.selectAll('text').style('fill', '#64748b').style('font-size', '10px');
  yAxis.selectAll('line, path').style('stroke', '#334155');

  // Input bars (bottom of stack)
  svg.selectAll('.bar-input')
    .data(buckets)
    .enter().append('rect')
    .attr('x', d => x(d.time))
    .attr('y', d => y(d.input_tokens))
    .attr('width', x.bandwidth())
    .attr('height', d => height - y(d.input_tokens))
    .attr('fill', '#3b82f6')
    .attr('opacity', 0.7);

  // Output bars (stacked on top of input)
  svg.selectAll('.bar-output')
    .data(buckets)
    .enter().append('rect')
    .attr('x', d => x(d.time))
    .attr('y', d => y(d.input_tokens + d.output_tokens))
    .attr('width', x.bandwidth())
    .attr('height', d => y(d.input_tokens) - y(d.input_tokens + d.output_tokens))
    .attr('fill', '#f97316')
    .attr('opacity', 0.7);

  // Tooltip
  const tooltip = d3.select('body').append('div').attr('class', 'd3-tooltip').style('display', 'none');

  svg.selectAll('rect')
    .on('mouseover', (event, d) => {
      tooltip.style('display', 'block')
        .html(`<strong>${d.time}</strong><br>Input: ${d3.format(',')(d.input_tokens)}<br>Output: ${d3.format(',')(d.output_tokens)}`);
    })
    .on('mousemove', (event) => {
      tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', () => tooltip.style('display', 'none'));

  const legend = el.append('div').style('display', 'flex').style('gap', '16px').style('margin-top', '8px');
  legend.append('span').style('font-size', '11px').style('color', '#60a5fa').html('● Input tokens');
  legend.append('span').style('font-size', '11px').style('color', '#f97316').html('● Output tokens');
}
