import { C, MIX, fmtTokens } from '../theme.js';

export function renderCacheEfficiency(container, data) {
  container.innerHTML = '';

  const items = [
    { label: 'Cache read', value: data.cache_read_rate, color: C.ok, tokens: data.cache_read_tokens },
    { label: 'Cache creation', value: data.cache_creation_rate, color: MIX.cacheWrite, tokens: data.cache_creation_tokens },
    { label: 'No cache', value: data.no_cache_rate, color: C.danger, tokens: data.non_cached_input_tokens },
  ];

  for (const item of items) {
    const pct = (item.value || 0) * 100;
    const row = document.createElement('div');
    row.className = 'bar-stat cache-row';
    row.title = `${fmtTokens(item.tokens || 0)} tokens`;
    row.innerHTML =
      `<div class="bar-stat-head">` +
        `<span class="bar-stat-label">${item.label}</span>` +
        `<span class="bar-stat-value">${pct.toFixed(1)}%</span>` +
      `</div>` +
      `<div class="bar-stat-track"><div class="bar-stat-fill" style="width:${pct}%;background:${item.color}"></div></div>`;
    container.appendChild(row);
  }

  const readPct = (data.cache_read_rate || 0) * 100;
  const note = document.createElement('div');
  note.className = 'panel-note';
  note.textContent = readPct > 0
    ? `${readPct.toFixed(0)}% of your input arrives from cache at a tenth of the price.`
    : 'No cached input in this range — every token is billed at full input price.';
  container.appendChild(note);
}
