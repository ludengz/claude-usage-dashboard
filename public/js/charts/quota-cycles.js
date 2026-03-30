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
  return cycle.models?.[modelKey] || { utilization: 0, actualTokens: 0, projectedTokensAt100: null, actualCost: 0, projectedCostAt100: null, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 } };
}

const MAX_DISPLAY_CYCLES = 10;

export function renderQuotaCycles(container, data, { modelKey = 'overall' } = {}) {
  if (!container) return;

  const hasModelData = data.currentCycle &&
    ((data.currentCycle.models?.opus?.utilization > 0) ||
     (data.currentCycle.models?.sonnet?.utilization > 0));

  // --- Model toggle: grey out when no data ---
  const toggleEl = document.getElementById('cycle-model-toggle');
  if (toggleEl) {
    toggleEl.querySelectorAll('button[data-cycle-model="opus"], button[data-cycle-model="sonnet"]').forEach(btn => {
      btn.disabled = !hasModelData;
    });
  }

  // --- Inline projection summary in header ---
  const summaryEl = document.getElementById('cycle-projection-summary');
  if (summaryEl && data.currentCycle) {
    const d = getModelData(data.currentCycle, modelKey);
    summaryEl.innerHTML = d.projectedTokensAt100 != null
      ? `(<strong>${fmt(d.projectedTokensAt100)}</strong> projected at 100%, actual: ${fmt(d.actualTokens)})`
      : '';
  } else if (summaryEl) {
    summaryEl.textContent = '';
  }

  // --- Bar Chart (compact) ---
  container.innerHTML = '';

  const allCycles = [];
  if (data.history) allCycles.push(...[...data.history].reverse());
  if (data.currentCycle) allCycles.push(data.currentCycle);

  if (allCycles.length === 0) {
    container.innerHTML = '<div style="color:#64748b;text-align:center;padding:20px;font-size:12px">No cycle data yet.</div>';
    return;
  }

  const displayAll = allCycles.slice(-MAX_DISPLAY_CYCLES);

  const chartData = displayAll.map(c => {
    const d = getModelData(c, modelKey);
    return {
      label: `${fmtDate(c.start)}–${fmtDate(c.resets_at)}`,
      actual: d.actualTokens,
      projected: d.projectedTokensAt100,
      isCurrent: c === data.currentCycle,
    };
  });

  const margin = { top: 14, right: 10, bottom: 24, left: 50 };
  const width = container.clientWidth - margin.left - margin.right;
  const height = 130;

  const svg = d3.select(container).append('svg')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
    .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const maxBarGroupWidth = 100;
  const chartWidth = Math.min(width, chartData.length * (maxBarGroupWidth + 30));
  const x0 = d3.scaleBand().domain(chartData.map(d => d.label)).range([0, chartWidth]).padding(0.3);
  const maxVal = d3.max(chartData, d => Math.max(d.actual, d.projected || 0)) || 1;
  const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([height, 0]);

  svg.append('g').attr('transform', `translate(0,${height})`)
    .call(d3.axisBottom(x0).tickSize(0))
    .selectAll('text').attr('fill', '#94a3b8').style('font-size', '9px');
  svg.append('g').call(d3.axisLeft(y).ticks(4).tickFormat(d => fmt(d)))
    .selectAll('text').attr('fill', '#94a3b8').style('font-size', '9px');
  svg.selectAll('.domain, .tick line').attr('stroke', '#334155');

  const barWidth = Math.min(x0.bandwidth() / 2.5, 30);

  svg.selectAll('.bar-projected').data(chartData.filter(d => d.projected != null))
    .join('rect').attr('class', 'bar-projected')
    .attr('x', d => x0(d.label) + x0.bandwidth() / 2 - barWidth)
    .attr('width', barWidth * 2)
    .attr('y', d => y(d.projected))
    .attr('height', d => height - y(d.projected))
    .attr('fill', '#f59e0b').attr('opacity', 0.2)
    .attr('rx', 2);

  svg.selectAll('.bar-actual').data(chartData)
    .join('rect').attr('class', 'bar-actual')
    .attr('x', d => x0(d.label) + x0.bandwidth() / 2 - barWidth / 2)
    .attr('width', barWidth)
    .attr('y', d => y(d.actual))
    .attr('height', d => height - y(d.actual))
    .attr('fill', d => d.isCurrent ? '#3b82f6' : '#60a5fa')
    .attr('rx', 2);

  // Compact legend
  const legend = svg.append('g').attr('transform', `translate(0, -4)`);
  legend.append('rect').attr('width', 8).attr('height', 8).attr('fill', '#60a5fa').attr('rx', 1);
  legend.append('text').attr('x', 10).attr('y', 7).text('Actual').attr('fill', '#64748b').style('font-size', '9px');
  legend.append('rect').attr('x', 50).attr('width', 8).attr('height', 8).attr('fill', '#f59e0b').attr('opacity', 0.4).attr('rx', 1);
  legend.append('text').attr('x', 60).attr('y', 7).text('Proj@100%').attr('fill', '#64748b').style('font-size', '9px');

  // --- History Table ---
  const tableEl = document.getElementById('quota-cycles-table');
  if (!tableEl) return;
  tableEl.innerHTML = '';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>
    <th>Cycle</th>
    <th class="align-right">Util%</th>
    <th class="align-right">In</th>
    <th class="align-right">Out</th>
    <th class="align-right">CR</th>
    <th class="align-right">CW</th>
    <th class="align-right">Total</th>
    <th class="align-right">Excl CR</th>
    <th class="align-right col-highlight">Proj@100%</th>
    <th class="align-right">Cost</th>
    <th class="align-right">Proj Cost</th>
    <th class="align-right">\u0394 Prev</th>
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const displayCycles = [...displayAll].reverse();
  for (let i = 0; i < displayCycles.length; i++) {
    const c = displayCycles[i];
    const d = getModelData(c, modelKey);
    const t = d.tokens || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    const totalInclCR = t.input + t.output + t.cacheRead + t.cacheCreation;
    const prev = displayCycles[i + 1] ? getModelData(displayCycles[i + 1], modelKey) : null;

    let deltaStr = '—';
    let deltaClass = '';
    if (prev && prev.projectedTokensAt100 != null && d.projectedTokensAt100 != null && prev.projectedTokensAt100 > 0) {
      const delta = ((d.projectedTokensAt100 - prev.projectedTokensAt100) / prev.projectedTokensAt100) * 100;
      deltaStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
      deltaClass = delta >= 0 ? 'delta-positive' : 'delta-negative';
    }

    const isCurrent = c === data.currentCycle;
    const label = `${fmtDate(c.start)}–${fmtDate(c.resets_at)}${isCurrent ? ' *' : ''}`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td class="align-right">${d.utilization.toFixed(1)}%</td>
      <td class="align-right">${fmt(t.input)}</td>
      <td class="align-right">${fmt(t.output)}</td>
      <td class="align-right">${fmt(t.cacheRead)}</td>
      <td class="align-right">${fmt(t.cacheCreation)}</td>
      <td class="align-right">${fmt(totalInclCR)}</td>
      <td class="align-right">${fmt(d.actualTokens)}</td>
      <td class="align-right col-highlight">${fmt(d.projectedTokensAt100)}</td>
      <td class="align-right">${fmtCost(d.actualCost)}</td>
      <td class="align-right">${fmtCost(d.projectedCostAt100)}</td>
      <td class="align-right ${deltaClass}">${deltaStr}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableEl.appendChild(table);
}
