import { modelDisplayName } from '../model-meta.js';
import { MIX, fmtTokens, fmtCost, escapeHtml } from '../theme.js';

const BAR_MAX = 160;

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function renderSessionTable(container, data, { onSort, onPageChange }) {
  container.innerHTML = '';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const columns = [
    { key: 'date', label: 'Started', sortKey: 'date' },
    { key: 'project', label: 'Project' },
    { key: 'models', label: 'Model' },
    { key: 'mix', label: 'Size & mix' },
    { key: 'total', label: 'Total', align: 'right', sortKey: 'tokens' },
    { key: 'cost', label: 'API cost', align: 'right', sortKey: 'cost' },
    { key: 'duration', label: 'Duration', align: 'right' },
  ];

  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.align) th.classList.add('align-right');
    if (col.sortKey) {
      th.classList.add('sortable');
      th.addEventListener('click', () => onSort(col.sortKey));
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Bar length is relative to the largest session on this page — the mix is
  // absolute, the length is comparative.
  const maxTotal = Math.max(...data.sessions.map(s => s.total_tokens), 1);

  const tbody = document.createElement('tbody');
  for (const s of data.sessions) {
    const sum = s.total_tokens || 1;
    const barW = Math.max(3, Math.round((s.total_tokens / maxTotal) * BAR_MAX));
    const seg = v => (v / sum) * 100;
    const mixTitle = `cache read ${fmtTokens(s.cache_read_tokens)} · cache write ${fmtTokens(s.cache_creation_tokens)} · ` +
      `input ${fmtTokens(s.input_tokens)} · output ${fmtTokens(s.output_tokens)}`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(s.startTime)}</td>
      <td class="name">${escapeHtml(s.project)}</td>
      <td>${s.models.map(m => `<span class="tag">${escapeHtml(modelDisplayName(m))}</span>`).join('')}</td>
      <td>
        <div class="mix-bar" style="width:${barW}px" title="${escapeHtml(mixTitle)}">
          <div style="width:${seg(s.cache_read_tokens)}%;background:${MIX.cacheRead}"></div>
          <div style="width:${seg(s.cache_creation_tokens)}%;background:${MIX.cacheWrite}"></div>
          <div style="width:${seg(s.input_tokens)}%;background:${MIX.input}"></div>
          <div style="width:${seg(s.output_tokens)}%;background:${MIX.output}"></div>
        </div>
      </td>
      <td class="align-right strong">${fmtTokens(s.total_tokens)}</td>
      <td class="align-right cost">${fmtCost(s.estimated_cost_usd)}</td>
      <td class="align-right">${formatDuration(s.duration_minutes)}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  if (data.totals) {
    const tfoot = document.createElement('tfoot');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="muted" colspan="4">Showing ${data.sessions.length} of ${data.pagination.total_sessions} sessions</td>
      <td class="align-right">${fmtTokens(data.totals.total_tokens)}</td>
      <td class="align-right cost">${fmtCost(data.totals.estimated_cost_usd)}</td>
      <td></td>
    `;
    tfoot.appendChild(tr);
    table.appendChild(tfoot);
  }

  container.appendChild(table);

  const pagEl = document.getElementById('session-pagination');
  if (pagEl) pagEl.innerHTML = ''; // stale buttons survive when results shrink to one page
  if (pagEl && data.pagination && data.pagination.total_pages > 1) {
    for (let i = 1; i <= data.pagination.total_pages; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      if (i === data.pagination.page) btn.className = 'active';
      btn.addEventListener('click', () => onPageChange(i));
      pagEl.appendChild(btn);
    }
  }
}
