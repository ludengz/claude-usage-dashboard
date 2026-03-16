export function renderCacheEfficiency(container, data) {
  container.innerHTML = '';

  const items = [
    { label: 'Cache Read', value: data.cache_read_rate, color: '#4ade80', tokens: data.cache_read_tokens },
    { label: 'Cache Creation', value: data.cache_creation_rate, color: '#f59e0b', tokens: data.cache_creation_tokens },
    { label: 'No Cache', value: data.no_cache_rate, color: '#ef4444', tokens: data.non_cached_input_tokens },
  ];

  for (const item of items) {
    const row = document.createElement('div');
    row.style.marginBottom = '12px';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:4px';
    header.innerHTML = `<span>${item.label}</span><span>${(item.value * 100).toFixed(1)}%</span>`;

    const barBg = document.createElement('div');
    barBg.style.cssText = 'height:8px;background:#334155;border-radius:4px;overflow:hidden';

    const barFill = document.createElement('div');
    barFill.style.cssText = `width:${item.value * 100}%;height:100%;background:${item.color};border-radius:4px;transition:width 0.5s`;

    barBg.appendChild(barFill);
    row.appendChild(header);
    row.appendChild(barBg);
    container.appendChild(row);
  }
}
