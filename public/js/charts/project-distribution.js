import { MIX, MIX_LEGEND, fmtTokens, fmtCost, escapeHtml } from '../theme.js';

export function renderProjectDistribution(container, data) {
  container.innerHTML = '';

  if (!data.projects || data.projects.length === 0) {
    container.innerHTML = '<p class="empty">No data</p>';
    return;
  }

  // Every row shares one scale, so bar length reads as "how much of my usage
  // is this project" rather than a per-row mix.
  const maxTotal = Math.max(...data.projects.map(p => p.total_tokens), 1);

  for (const p of data.projects) {
    const cr = p.cache_read_tokens || 0;
    const cw = p.cache_creation_tokens || 0;
    const inp = p.total_input_tokens || 0;
    const out = p.total_output_tokens || 0;
    const pct = v => (v / maxTotal) * 100;

    const row = document.createElement('div');
    row.className = 'proj-row';
    row.innerHTML =
      `<span class="proj-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>` +
      `<div class="proj-bar">` +
        `<div style="width:${pct(cr)}%;background:${MIX.cacheRead}"></div>` +
        `<div style="width:${pct(cw)}%;background:${MIX.cacheWrite}"></div>` +
        `<div style="width:${pct(inp)}%;background:${MIX.input}"></div>` +
        `<div style="width:${pct(out)}%;background:${MIX.output}"></div>` +
      `</div>` +
      `<span class="proj-total" title="${p.total_tokens.toLocaleString()} tokens">${fmtTokens(p.total_tokens)}</span>` +
      `<span class="proj-breakdown">cr ${fmtTokens(cr)} · cw ${fmtTokens(cw)} · in ${fmtTokens(inp)} · out ${fmtTokens(out)}</span>` +
      `<span class="proj-cost">${fmtCost(p.estimated_cost_usd)}</span>`;
    container.appendChild(row);
  }

  const legend = document.createElement('div');
  legend.className = 'mix-legend';
  legend.innerHTML = MIX_LEGEND.map(m => `<span><i style="color:${m.color}">■</i>${m.label}</span>`).join('');
  container.appendChild(legend);
}
