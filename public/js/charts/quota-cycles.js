const fmt = (n) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
};

const fmtCost = (n) => n == null ? '—' : `$${n.toFixed(2)}`;

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function getModelData(cycle, modelKey) {
  if (modelKey === 'overall') return cycle.overall;
  return cycle.models?.[modelKey] || { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null };
}

const MAX_DISPLAY_CYCLES = 6;

export function renderQuotaCycles(container, data, { modelKey = 'overall' } = {}) {
  if (!container) return;

  // Check if per-model utilization data is available
  const hasModelData = data.currentCycle &&
    ((data.currentCycle.models?.opus?.utilization > 0) ||
     (data.currentCycle.models?.sonnet?.utilization > 0));

  // --- Model toggle visibility ---
  const toggleEl = document.getElementById('cycle-model-toggle');
  if (toggleEl) {
    toggleEl.style.display = hasModelData ? '' : 'none';
  }

  // --- Projection Cards ---
  const cardsEl = document.getElementById('cycle-projection-cards');
  if (cardsEl) {
    cardsEl.innerHTML = '';
    if (data.currentCycle) {
      const items = [{ label: 'Total at 100%', key: 'overall' }];
      if (hasModelData) {
        items.push({ label: 'Opus at 100%', key: 'opus' });
        items.push({ label: 'Sonnet at 100%', key: 'sonnet' });
      }
      for (const item of items) {
        const d = getModelData(data.currentCycle, item.key);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="card-label">${item.label}</div>
          <div class="card-value">${fmt(d.projectedTokensAt100)}</div>
          <div class="card-sub">actual: ${fmt(d.actualTokens)}</div>
        `;
        cardsEl.appendChild(card);
      }
    }
  }

  // --- Bar Chart ---
  container.innerHTML = '';

  const allCycles = [];
  if (data.history) allCycles.push(...[...data.history].reverse());
  if (data.currentCycle) allCycles.push(data.currentCycle);

  if (allCycles.length === 0) {
    container.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px;font-size:13px">No cycle data yet. Data will accumulate as the dashboard runs.</div>';
    return;
  }

  // Show only the most recent N cycles
  const displayAll = allCycles.slice(-MAX_DISPLAY_CYCLES);

  const chartData = displayAll.map(c => {
    const d = getModelData(c, modelKey);
    return {
      label: `${fmtDate(c.start)} – ${fmtDate(c.resets_at)}`,
      actual: d.actualTokens,
      projected: d.projectedTokensAt100,
      isCurrent: c === data.currentCycle,
    };
  });

  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = 220;

  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Cap the chart width used for bars when few cycles, so bars don't stretch full-width
  const maxBarGroupWidth = 120;
  const chartWidth = Math.min(width, chartData.length * (maxBarGroupWidth + 40));
  const x0 = d3.scaleBand().domain(chartData.map(d => d.label)).range([0, chartWidth]).padding(0.3);
  const maxVal = d3.max(chartData, d => Math.max(d.actual, d.projected || 0)) || 1;
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([height, 0]);

  // Axes
  svg.append('g').attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x0).tickSize(0))
    .selectAll('text').attr('fill', '#94a3b8').style('font-size', '10px');
  svg.append('g').call(d3.axisLeft(y).ticks(5).tickFormat(d => fmt(d)))
    .selectAll('text').attr('fill', '#94a3b8').style('font-size', '10px');
  svg.selectAll('.domain, .tick line').attr('stroke', '#334155');

  const barWidth = Math.min(x0.bandwidth() / 2.5, 40);

  // Projected bars (behind, semi-transparent)
  svg.selectAll('.bar-projected').data(chartData.filter(d => d.projected != null))
    .join('rect').attr('class', 'bar-projected')
    .attr('x', d => x0(d.label) + x0.bandwidth() / 2 - barWidth)
    .attr('width', barWidth * 2)
    .attr('y', d => y(d.projected))
    .attr('height', d => height - y(d.projected))
    .attr('fill', '#f59e0b').attr('opacity', 0.2)
    .attr('rx', 3);

  // Actual bars (front)
  svg.selectAll('.bar-actual').data(chartData)
    .join('rect').attr('class', 'bar-actual')
    .attr('x', d => x0(d.label) + x0.bandwidth() / 2 - barWidth / 2)
    .attr('width', barWidth)
    .attr('y', d => y(d.actual))
    .attr('height', d => height - y(d.actual))
    .attr('fill', d => d.isCurrent ? '#3b82f6' : '#60a5fa')
    .attr('rx', 3);

  // Legend
  const legend = svg.append('g').attr('transform', `translate(${width - 180}, -5)`);
  legend.append('rect').attr('width', 10).attr('height', 10).attr('fill', '#60a5fa').attr('rx', 2);
  legend.append('text').attr('x', 14).attr('y', 9).text('Actual').attr('fill', '#94a3b8').style('font-size', '10px');
  legend.append('rect').attr('x', 70).attr('width', 10).attr('height', 10).attr('fill', '#f59e0b').attr('opacity', 0.4).attr('rx', 2);
  legend.append('text').attr('x', 84).attr('y', 9).text('Projected').attr('fill', '#94a3b8').style('font-size', '10px');

  // --- History Table ---
  const tableEl = document.getElementById('quota-cycles-table');
  if (!tableEl) return;
  tableEl.innerHTML = '';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>Cycle</th>
    <th class="align-right">Utilization</th>
    <th class="align-right">Tokens (non-cached)</th>
    <th class="align-right">Projected at 100%</th>
    <th class="align-right">Actual Cost</th>
    <th class="align-right">Projected Cost</th>
    <th class="align-right">\u0394 vs Prev</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  // Show only recent cycles, newest first
  const displayCycles = [...displayAll].reverse();
  for (let i = 0; i < displayCycles.length; i++) {
    const c = displayCycles[i];
    const d = getModelData(c, modelKey);
    const prev = displayCycles[i + 1] ? getModelData(displayCycles[i + 1], modelKey) : null;

    let deltaStr = '—';
    let deltaClass = '';
    if (prev && prev.projectedTokensAt100 != null && d.projectedTokensAt100 != null && prev.projectedTokensAt100 > 0) {
      const delta = ((d.projectedTokensAt100 - prev.projectedTokensAt100) / prev.projectedTokensAt100) * 100;
      deltaStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
      deltaClass = delta >= 0 ? 'delta-positive' : 'delta-negative';
    }

    const isCurrent = c === data.currentCycle;
    const label = `${fmtDate(c.start)} – ${fmtDate(c.resets_at)}${isCurrent ? ' *' : ''}`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td class="align-right">${d.utilization.toFixed(1)}%</td>
      <td class="align-right">${fmt(d.actualTokens)}</td>
      <td class="align-right">${fmt(d.projectedTokensAt100)}</td>
      <td class="align-right">${fmtCost(d.actualCost)}</td>
      <td class="align-right">${fmtCost(d.projectedCostAt100)}</td>
      <td class="align-right ${deltaClass}">${deltaStr}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableEl.appendChild(table);
}
