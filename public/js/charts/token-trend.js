// d3 is loaded as a global via <script> tag in index.html

export function renderTokenTrend(container, data, opts = {}) {
  const showDollars = opts.yAxis === 'dollars';
  const el = d3.select(container);
  el.selectAll('*').remove();

  if (!data.buckets || data.buckets.length === 0) {
    el.append('p').style('color', '#64748b').text('No data for selected range');
    return;
  }

  const margin = { top: 20, right: 30, bottom: 60, left: 60 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = 250 - margin.top - margin.bottom;

  const svg = el.append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const emptyBucket = (time) => ({ time, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, estimated_cost_usd: 0 });

  // Fill in missing time slots so blank periods are visible
  const bucketMap = new Map(data.buckets.map(b => [b.time, b]));
  let allKeys;
  if (data.granularity === 'hourly') {
    allKeys = [];
    const first = data.buckets[0].time; // e.g. "2026-03-15T08:00"
    const last = data.buckets[data.buckets.length - 1].time;
    const pad = n => String(n).padStart(2, '0');
    const cur = new Date(first.replace('T', ' ').replace(/:00$/, ':00:00'));
    const end = new Date(last.replace('T', ' ').replace(/:00$/, ':00:00'));
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}T${pad(cur.getHours())}:00`;
      allKeys.push(key);
      cur.setHours(cur.getHours() + 1);
    }
  } else if (data.granularity === 'daily') {
    allKeys = [];
    const pad = n => String(n).padStart(2, '0');
    const cur = new Date(data.buckets[0].time + 'T00:00:00');
    const end = new Date(data.buckets[data.buckets.length - 1].time + 'T00:00:00');
    while (cur <= end) {
      allKeys.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
      cur.setDate(cur.getDate() + 1);
    }
  } else {
    allKeys = data.buckets.map(b => b.time);
  }
  const buckets = allKeys.map(k => bucketMap.get(k) || emptyBucket(k));

  const x = d3.scaleBand()
    .domain(buckets.map(d => d.time))
    .range([0, width])
    .padding(0.1);

  // Helper to get total height for each bucket
  const totalOf = d => d.input_tokens + d.output_tokens + (d.cache_read_tokens || 0) + (d.cache_creation_tokens || 0);
  const costOf = d => d.estimated_cost_usd || 0;
  const valueOf = showDollars ? costOf : totalOf;

  const maxVal = d3.max(buckets, valueOf) || 1;
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([height, 0]);

  const maxTicks = data.granularity === 'hourly' ? 12 : 10;
  const tickVals = x.domain().filter((_, i) => i % Math.ceil(buckets.length / maxTicks) === 0);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const formatTick = (t) => {
    // Hourly: "2026-03-15T08:00" → "Mar 15 8AM"
    const h = t.match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):00$/);
    if (h) {
      const hr = parseInt(h[3], 10);
      const ampm = hr === 0 ? '12AM' : hr < 12 ? `${hr}AM` : hr === 12 ? '12PM' : `${hr - 12}PM`;
      return `${months[parseInt(h[1], 10) - 1]} ${parseInt(h[2], 10)} ${ampm}`;
    }
    // Daily: "2026-03-08" → "Mar 8"
    const m = t.match(/^\d{4}-(\d{2})-(\d{2})$/);
    if (m) {
      return `${months[parseInt(m[1], 10) - 1]} ${parseInt(m[2], 10)}`;
    }
    return t;
  };
  const xAxis = svg.append('g')
    .attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x).tickValues(tickVals).tickFormat(formatTick));
  xAxis.selectAll('text').style('fill', '#64748b').style('font-size', '10px')
    .attr('transform', 'rotate(-45)').attr('text-anchor', 'end');
  xAxis.selectAll('line, path').style('stroke', '#334155');

  const yAxisFmt = showDollars ? (v => `$${v < 1 ? v.toFixed(2) : d3.format('.2s')(v)}`) : d3.format('.2s');
  const yAxis = svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(yAxisFmt));
  yAxis.selectAll('text').style('fill', '#64748b').style('font-size', '10px');
  yAxis.selectAll('line, path').style('stroke', '#334155');

  if (showDollars) {
    // Single bar per bucket showing cost
    svg.selectAll('.bar-cost')
      .data(buckets)
      .enter().append('rect')
      .attr('x', d => x(d.time))
      .attr('y', d => y(costOf(d)))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(costOf(d)))
      .attr('fill', '#fbbf24')
      .attr('opacity', 0.7);
  } else {
    // Stack order (bottom to top): cache_read, cache_creation, input, output
    // Cache read (bottom)
    svg.selectAll('.bar-cache-read')
      .data(buckets)
      .enter().append('rect')
      .attr('x', d => x(d.time))
      .attr('y', d => y(d.cache_read_tokens || 0))
      .attr('width', x.bandwidth())
      .attr('height', d => height - y(d.cache_read_tokens || 0))
      .attr('fill', '#4ade80')
      .attr('opacity', 0.6);

    // Cache creation (on top of cache read)
    const cacheBase = d => (d.cache_read_tokens || 0);
    svg.selectAll('.bar-cache-creation')
      .data(buckets)
      .enter().append('rect')
      .attr('x', d => x(d.time))
      .attr('y', d => y(cacheBase(d) + (d.cache_creation_tokens || 0)))
      .attr('width', x.bandwidth())
      .attr('height', d => y(cacheBase(d)) - y(cacheBase(d) + (d.cache_creation_tokens || 0)))
      .attr('fill', '#f59e0b')
      .attr('opacity', 0.6);

    // Input (on top of cache)
    const inputBase = d => cacheBase(d) + (d.cache_creation_tokens || 0);
    svg.selectAll('.bar-input')
      .data(buckets)
      .enter().append('rect')
      .attr('x', d => x(d.time))
      .attr('y', d => y(inputBase(d) + d.input_tokens))
      .attr('width', x.bandwidth())
      .attr('height', d => y(inputBase(d)) - y(inputBase(d) + d.input_tokens))
      .attr('fill', '#3b82f6')
      .attr('opacity', 0.7);

    // Output (top)
    const outputBase = d => inputBase(d) + d.input_tokens;
    svg.selectAll('.bar-output')
      .data(buckets)
      .enter().append('rect')
      .attr('x', d => x(d.time))
      .attr('y', d => y(outputBase(d) + d.output_tokens))
      .attr('width', x.bandwidth())
      .attr('height', d => y(outputBase(d)) - y(outputBase(d) + d.output_tokens))
      .attr('fill', '#f97316')
      .attr('opacity', 0.7);
  }

  // Tooltip — remove any stale ones first
  d3.selectAll('.d3-tooltip-token-trend').remove();
  const tooltip = d3.select('body').append('div').attr('class', 'd3-tooltip d3-tooltip-token-trend').style('display', 'none');

  svg.selectAll('rect')
    .on('mouseover', (event, d) => {
      const total = d.input_tokens + d.output_tokens + (d.cache_read_tokens || 0) + (d.cache_creation_tokens || 0);
      const cost = d.estimated_cost_usd || 0;
      tooltip.style('display', 'block')
        .html(`<strong>${d.time}</strong><br>Total: ${d3.format(',')(total)} tokens &nbsp;<span style="color:#f59e0b;font-weight:600">$${cost.toFixed(2)}</span><br><span style="color:#4ade80">Cache Read: ${d3.format(',')(d.cache_read_tokens || 0)}</span><br><span style="color:#f59e0b">Cache Write: ${d3.format(',')(d.cache_creation_tokens || 0)}</span><br><span style="color:#60a5fa">Input: ${d3.format(',')(d.input_tokens)}</span><br><span style="color:#f97316">Output: ${d3.format(',')(d.output_tokens)}</span>`);
    })
    .on('mousemove', (event) => {
      tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 10) + 'px');
    })
    .on('mouseout', () => tooltip.style('display', 'none'));

  // Aggregated totals for the selected period
  const fmt = d3.format(',');
  const fmtShort = (n) => {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  };
  // Use server-computed totals (from raw records) for accuracy;
  // fall back to summing buckets if data.total is unavailable
  const t = data.total || {};
  const totals = {
    cacheRead: t.cache_read_tokens ?? buckets.reduce((s, d) => s + (d.cache_read_tokens || 0), 0),
    cacheWrite: t.cache_creation_tokens ?? buckets.reduce((s, d) => s + (d.cache_creation_tokens || 0), 0),
    input: t.input_tokens ?? buckets.reduce((s, d) => s + d.input_tokens, 0),
    output: t.output_tokens ?? buckets.reduce((s, d) => s + d.output_tokens, 0),
    cost: t.estimated_api_cost_usd ?? buckets.reduce((s, d) => s + (d.estimated_cost_usd || 0), 0),
  };
  totals.all = totals.cacheRead + totals.cacheWrite + totals.input + totals.output;

  const summary = el.append('div')
    .style('margin-top', '10px')
    .style('padding', '10px 14px')
    .style('background', '#1e293b')
    .style('border-radius', '6px')
    .style('font-size', '12px');

  // Top row: total tokens + cost inline
  const topRow = summary.append('div')
    .style('margin-bottom', '8px');
  topRow.append('span')
    .style('color', '#e2e8f0')
    .style('font-size', '13px')
    .html(`Period Total: <strong title="${fmt(totals.all)} tokens">${fmtShort(totals.all)}</strong> tokens`)
    .append('span')
    .style('color', '#fbbf24')
    .style('font-weight', '600')
    .style('margin-left', '12px')
    .html(`$${totals.cost.toFixed(2)}`);

  // Segment breakdown with legend dots
  const segments = [
    { label: 'Cache Read', value: totals.cacheRead, color: '#4ade80' },
    { label: 'Cache Write', value: totals.cacheWrite, color: '#f59e0b' },
    { label: 'Input', value: totals.input, color: '#60a5fa' },
    { label: 'Output', value: totals.output, color: '#f97316' },
  ];
  const segRow = summary.append('div')
    .style('display', 'flex')
    .style('flex-wrap', 'wrap')
    .style('gap', '6px 20px')
    .style('margin-bottom', '8px');
  for (const s of segments) {
    segRow.append('span')
      .style('color', s.color)
      .style('font-size', '11px')
      .html(`● ${s.label}: <strong title="${fmt(s.value)} tokens">${fmtShort(s.value)}</strong>`);
  }

  // Avg / Min / Max stats per bucket
  const bucketVals = buckets.map(valueOf);
  const nonZero = bucketVals.filter(v => v > 0);
  const avg = nonZero.length > 0 ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
  const min = nonZero.length > 0 ? Math.min(...nonZero) : 0;
  const max = nonZero.length > 0 ? Math.max(...nonZero) : 0;

  const fmtStat = showDollars
    ? (v => `$${v.toFixed(2)}`)
    : (v => fmtShort(Math.round(v)));
  const fmtStatTitle = showDollars
    ? (v => `$${v.toFixed(4)}`)
    : (v => `${fmt(Math.round(v))} tokens`);

  const granLabel = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month' }[data.granularity] || 'bucket';
  const statsRow = summary.append('div')
    .style('display', 'flex')
    .style('flex-wrap', 'wrap')
    .style('gap', '6px 20px')
    .style('font-size', '11px')
    .style('color', '#94a3b8');

  statsRow.append('span').html(`Avg/${granLabel}: <strong title="${fmtStatTitle(avg)}" style="color:#e2e8f0">${fmtStat(avg)}</strong>`);
  statsRow.append('span').html(`Min: <strong title="${fmtStatTitle(min)}" style="color:#e2e8f0">${fmtStat(min)}</strong>`);
  statsRow.append('span').html(`Max: <strong title="${fmtStatTitle(max)}" style="color:#e2e8f0">${fmtStat(max)}</strong>`);
  statsRow.append('span').html(`Active ${granLabel}s: <strong style="color:#e2e8f0">${nonZero.length}</strong> / ${buckets.length}`);

  if (data.granularity === 'hourly') {
    const days = new Set(buckets.map(b => b.time.slice(0, 10)));
    const avgHours = (nonZero.length / days.size).toFixed(1);
    statsRow.append('span').html(`Avg hours/day: <strong style="color:#e2e8f0">${avgHours}</strong>`);
  } else if (data.granularity === 'daily') {
    const weeks = Math.max(1, buckets.length / 7);
    const avgDays = (nonZero.length / weeks).toFixed(1);
    statsRow.append('span').html(`Avg days/week: <strong style="color:#e2e8f0">${avgDays}</strong>`);
  }

  // Most active hours heatmap — aggregate by hour-of-day across the entire range
  const hourAgg = new Array(24).fill(0);
  const hourCount = new Array(24).fill(0);
  for (const b of buckets) {
    // Extract hour from hourly buckets (e.g. "2026-03-15T08:00") or from daily/other granularities skip
    const hm = b.time.match(/T(\d{2}):00$/);
    if (hm) {
      const hr = parseInt(hm[1], 10);
      hourAgg[hr] += valueOf(b);
      if (valueOf(b) > 0) hourCount[hr]++;
    }
  }
  const hasHourlyData = hourAgg.some(v => v > 0);
  if (hasHourlyData) {
    const peakHour = hourAgg.indexOf(Math.max(...hourAgg));
    const maxHourVal = Math.max(...hourAgg);

    // Find contiguous active ranges
    const activeHours = hourAgg.map((v, i) => ({ hour: i, val: v })).filter(h => h.val > 0);
    const ranges = [];
    if (activeHours.length > 0) {
      let start = activeHours[0].hour;
      let prev = start;
      for (let i = 1; i < activeHours.length; i++) {
        if (activeHours[i].hour === prev + 1) {
          prev = activeHours[i].hour;
        } else {
          ranges.push([start, prev]);
          start = activeHours[i].hour;
          prev = start;
        }
      }
      ranges.push([start, prev]);
    }

    const fmtHr = h => {
      if (h === 0) return '12AM';
      if (h < 12) return `${h}AM`;
      if (h === 12) return '12PM';
      return `${h - 12}PM`;
    };

    const activeRangeStr = ranges.map(([s, e]) => s === e ? fmtHr(s) : `${fmtHr(s)}-${fmtHr((e + 1) % 24)}`).join(', ');

    const hoursRow = summary.append('div')
      .style('margin-top', '8px')
      .style('font-size', '11px')
      .style('color', '#94a3b8');

    hoursRow.append('div')
      .style('margin-bottom', '4px')
      .html(`Peak hour: <strong style="color:#e2e8f0">${fmtHr(peakHour)}</strong> &nbsp; Active: <strong style="color:#e2e8f0">${activeRangeStr}</strong>`);

    // Mini hour heatmap bar
    const heatmap = hoursRow.append('div')
      .style('display', 'flex')
      .style('gap', '1px')
      .style('align-items', 'end')
      .style('height', '20px');

    for (let h = 0; h < 24; h++) {
      const pct = maxHourVal > 0 ? hourAgg[h] / maxHourVal : 0;
      const color = pct === 0 ? '#1e293b'
        : pct < 0.33 ? '#334155'
        : pct < 0.66 ? '#3b82f6'
        : '#60a5fa';
      heatmap.append('div')
        .attr('title', `${fmtHr(h)}: ${showDollars ? '$' + hourAgg[h].toFixed(2) : fmtShort(Math.round(hourAgg[h]))}`)
        .style('flex', '1')
        .style('height', `${Math.max(2, pct * 100)}%`)
        .style('background', color)
        .style('border-radius', '1px');
    }

    // Hour labels under heatmap
    const labels = hoursRow.append('div')
      .style('display', 'flex')
      .style('gap', '1px');
    for (let h = 0; h < 24; h++) {
      labels.append('div')
        .style('flex', '1')
        .style('text-align', 'center')
        .style('font-size', '8px')
        .style('color', '#64748b')
        .text(h % 3 === 0 ? fmtHr(h) : '');
    }
  }
}
