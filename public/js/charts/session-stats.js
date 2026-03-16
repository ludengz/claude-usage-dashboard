function formatTokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

const MODEL_DISPLAY = {
  'claude-opus-4-6': 'opus 4.6',
  'claude-sonnet-4-6': 'sonnet 4.6',
  'claude-haiku-4-5': 'haiku 4.5',
  'claude-haiku-4-5-20251001': 'haiku 4.5',
};

function modelTag(model) {
  const shortName = MODEL_DISPLAY[model] || model.replace('claude-', '').replace(/-(\d+)-(\d+)/, ' $1.$2');
  let cls = 'tag-model-sonnet';
  if (model.includes('opus')) cls = 'tag-model-opus';
  else if (model.includes('haiku')) cls = 'tag-model-haiku';
  return `<span class="tag ${cls}">${shortName}</span>`;
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export function renderSessionTable(container, data, { onSort, onPageChange }) {
  container.innerHTML = '';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const columns = [
    { key: 'date', label: 'Date & Time' },
    { key: 'project', label: 'Project' },
    { key: 'models', label: 'Model(s)' },
    { key: 'input', label: 'Input', align: 'right' },
    { key: 'output', label: 'Output', align: 'right' },
    { key: 'cache_read', label: 'Cache Read', align: 'right' },
    { key: 'cache_creation', label: 'Cache Write', align: 'right' },
    { key: 'total', label: 'Total', align: 'right' },
    { key: 'cost', label: 'API Cost', align: 'right' },
    { key: 'duration', label: 'Duration', align: 'right' },
  ];

  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.align) th.className = 'align-right';
    if (['date', 'cost', 'total'].includes(col.key)) {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const sortKey = col.key === 'total' ? 'tokens' : col.key;
        onSort(sortKey);
      });
    }
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const s of data.sessions) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(s.startTime)}</td>
      <td><span class="tag tag-project">${s.project}</span></td>
      <td>${s.models.map(modelTag).join(' ')}</td>
      <td class="align-right" style="color:#60a5fa">${formatTokens(s.input_tokens)}</td>
      <td class="align-right" style="color:#f97316">${formatTokens(s.output_tokens)}</td>
      <td class="align-right" style="color:#4ade80">${formatTokens(s.cache_read_tokens)}</td>
      <td class="align-right" style="color:#f59e0b">${formatTokens(s.cache_creation_tokens)}</td>
      <td class="align-right" style="font-weight:600">${formatTokens(s.total_tokens)}</td>
      <td class="align-right" style="color:#f59e0b;font-weight:600">$${s.estimated_cost_usd.toFixed(2)}</td>
      <td class="align-right">${formatDuration(s.duration_minutes)}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  if (data.totals) {
    const tfoot = document.createElement('tfoot');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="3">Showing ${data.sessions.length} of ${data.pagination.total_sessions} sessions</td>
      <td class="align-right" colspan="4"></td>
      <td class="align-right">${formatTokens(data.totals.total_tokens)}</td>
      <td class="align-right" style="color:#f59e0b">$${data.totals.estimated_cost_usd.toFixed(2)}</td>
      <td></td>
    `;
    tfoot.appendChild(tr);
    table.appendChild(tfoot);
  }

  container.appendChild(table);

  const pagEl = document.getElementById('session-pagination');
  if (pagEl && data.pagination && data.pagination.total_pages > 1) {
    pagEl.innerHTML = '';
    for (let i = 1; i <= data.pagination.total_pages; i++) {
      const btn = document.createElement('button');
      btn.textContent = i;
      if (i === data.pagination.page) btn.className = 'active';
      btn.addEventListener('click', () => onPageChange(i));
      pagEl.appendChild(btn);
    }
  }
}
