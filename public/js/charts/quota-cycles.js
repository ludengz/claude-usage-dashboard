import { C, fmtTokens, fmtCost } from '../theme.js';

const fmtDate = (iso) => {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

function getModelData(cycle, modelKey) {
  if (modelKey === 'overall') return cycle.overall;
  return cycle.models?.[modelKey] || {
    utilization: 0, actualTokens: 0, projectedTokensAt100: null,
    actualCost: 0, projectedCostAt100: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  };
}

const MAX_DISPLAY_CYCLES = 10;

export function renderQuotaCycles(container, data, { modelKey = 'overall' } = {}) {
  if (!container) return;

  const hasModelData = data.currentCycle &&
    ((data.currentCycle.models?.opus?.utilization > 0) ||
     (data.currentCycle.models?.sonnet?.utilization > 0));

  const toggleEl = document.getElementById('cycle-model-toggle');
  if (toggleEl) {
    toggleEl.querySelectorAll('button[data-cycle-model="opus"], button[data-cycle-model="sonnet"]').forEach(btn => {
      btn.disabled = !hasModelData;
    });
  }

  const summaryEl = document.getElementById('cycle-projection-summary');
  if (summaryEl) summaryEl.textContent = '';

  container.innerHTML = '';

  const allCycles = [];
  if (data.history) allCycles.push(...[...data.history].reverse());
  if (data.currentCycle) allCycles.push(data.currentCycle);

  if (allCycles.length === 0) {
    container.innerHTML = '<div class="empty">No cycle data yet.</div>';
    const emptyTable = document.getElementById('quota-cycles-table');
    if (emptyTable) emptyTable.innerHTML = '';
    return;
  }

  const displayAll = allCycles.slice(-MAX_DISPLAY_CYCLES);
  const rows = displayAll.map(c => {
    const d = getModelData(c, modelKey);
    return {
      label: `${fmtDate(c.start)}–${fmtDate(c.resets_at)}`,
      actual: d.actualTokens || 0,
      projected: d.projectedTokensAt100,
      isCurrent: c === data.currentCycle,
    };
  });

  // Scale every row against the same maximum so cycles stay comparable —
  // per-row normalisation would make a tiny cycle look like a full one.
  const scaleMax = Math.max(...rows.map(r => Math.max(r.actual, r.projected || 0)), 1);

  for (const r of rows) {
    const row = document.createElement('div');
    row.className = `cycle-row${r.isCurrent ? ' is-current' : ''}`;
    const projW = r.projected != null ? (r.projected / scaleMax) * 100 : 0;
    const actualW = (r.actual / scaleMax) * 100;
    row.innerHTML =
      `<span class="cycle-row-label">${r.label}${r.isCurrent ? ' •' : ''}</span>` +
      `<div class="cycle-track">` +
        (r.projected != null ? `<div class="cycle-projected" style="width:${projW}%"></div>` : '') +
        `<div class="cycle-actual" style="width:${actualW}%"></div>` +
      `</div>` +
      `<span class="cycle-row-value">${fmtTokens(r.actual)} / ${r.projected == null ? '—' : fmtTokens(r.projected)}</span>`;
    row.title = `${r.label} — actual ${fmtTokens(r.actual)}, projected @100% ${r.projected == null ? '—' : fmtTokens(r.projected)}`;
    container.appendChild(row);
  }

  const legend = document.createElement('div');
  legend.className = 'cycle-legend';
  legend.innerHTML =
    `<span><i style="color:${C.accent}">■</i>actual</span>` +
    `<span><i style="color:${C.accentGhost}">■</i>projected @100%</span>`;
  container.appendChild(legend);

  // --- history table ---
  const tableEl = document.getElementById('quota-cycles-table');
  if (!tableEl) return;
  tableEl.innerHTML = '';

  const table = document.createElement('table');
  table.innerHTML = `<thead><tr>
    <th>Cycle</th>
    <th class="align-right">Util</th>
    <th class="align-right">In</th>
    <th class="align-right">Out</th>
    <th class="align-right">CR</th>
    <th class="align-right">CW</th>
    <th class="align-right">Total</th>
    <th class="align-right">Excl CR</th>
    <th class="align-right">Cost</th>
    <th class="align-right col-highlight">Proj tokens</th>
    <th class="align-right col-highlight">Proj cost</th>
    <th class="align-right">Δ</th>
  </tr></thead>`;

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
    if (prev && prev.projectedCostAt100 != null && d.projectedCostAt100 != null && prev.projectedCostAt100 > 0) {
      const delta = ((d.projectedCostAt100 - prev.projectedCostAt100) / prev.projectedCostAt100) * 100;
      deltaStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
      deltaClass = delta >= 0 ? 'delta-positive' : 'delta-negative';
    }

    const isCurrent = c === data.currentCycle;
    const backfillTitle = c.backfilled
      ? ' title="Reconstructed from local logs. Utilization is unknown: the quota API only reports the window that is current when asked."'
      : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="${isCurrent ? 'strong' : ''}">${fmtDate(c.start)}–${fmtDate(c.resets_at)}${isCurrent ? ' <span style="color:' + C.accent + '">•</span>' : ''}</td>
      <td class="align-right"${backfillTitle}>${d.utilization == null ? '—' : `${d.utilization.toFixed(1)}%`}</td>
      <td class="align-right">${fmtTokens(t.input)}</td>
      <td class="align-right">${fmtTokens(t.output)}</td>
      <td class="align-right">${fmtTokens(t.cacheRead)}</td>
      <td class="align-right">${fmtTokens(t.cacheCreation)}</td>
      <td class="align-right strong">${fmtTokens(totalInclCR)}</td>
      <td class="align-right">${fmtTokens(d.actualTokens)}</td>
      <td class="align-right">${fmtCost(d.actualCost)}</td>
      <td class="align-right col-highlight">${fmtTokens(d.projectedTokensAt100)}</td>
      <td class="align-right col-highlight">${fmtCost(d.projectedCostAt100)}</td>
      <td class="align-right ${deltaClass}">${deltaStr}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  tableEl.appendChild(table);
}
