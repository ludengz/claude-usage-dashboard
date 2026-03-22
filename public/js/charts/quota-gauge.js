export function renderQuotaGauges(container, data, opts = {}) {
  container.innerHTML = '';

  if (!data || data.available === false) {
    const msg = document.createElement('div');
    msg.className = 'quota-unavailable';
    const reason = data?.error === 'no_credentials'
      ? 'No Claude credentials found. Run "claude" CLI to authenticate.'
      : data?.error === 'rate_limited'
        ? 'Quota API rate limited. Will retry on next refresh.'
        : 'Quota data unavailable';
    msg.textContent = reason;
    container.appendChild(msg);
    return;
  }

  const items = [];
  if (data.five_hour) items.push({ label: '5-Hour Window', ...data.five_hour });
  if (data.seven_day) items.push({ label: '7-Day Total', ...data.seven_day });
  if (data.seven_day_opus) items.push({ label: '7-Day Opus', ...data.seven_day_opus });
  if (data.seven_day_sonnet) items.push({ label: '7-Day Sonnet', ...data.seven_day_sonnet });
  if (data.extra_usage?.is_enabled) {
    items.push({
      label: 'Extra Usage',
      utilization: data.extra_usage.utilization || 0,
      resets_at: null,
      extraDetail: data.extra_usage.monthly_limit != null
        ? `$${(data.extra_usage.used_credits || 0).toFixed(2)} / $${data.extra_usage.monthly_limit.toFixed(2)}`
        : null,
    });
  }

  if (items.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'quota-unavailable';
    msg.textContent = 'No quota data available';
    container.appendChild(msg);
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px';

  for (const item of items) {
    const pct = Math.min(100, Math.max(0, item.utilization || 0));
    const color = pct < 50 ? '#4ade80' : pct < 80 ? '#f59e0b' : '#ef4444';

    const cell = document.createElement('div');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-bottom:4px';
    header.innerHTML = `<span>${item.label}</span><span style="color:${color};font-weight:600">${pct.toFixed(1)}%</span>`;

    const barBg = document.createElement('div');
    barBg.style.cssText = 'height:8px;background:#334155;border-radius:4px;overflow:hidden';

    const barFill = document.createElement('div');
    barFill.style.cssText = `width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width 0.5s`;

    barBg.appendChild(barFill);
    cell.appendChild(header);
    cell.appendChild(barBg);

    // Reset time or extra detail
    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10px;color:#64748b;margin-top:2px';
    if (item.extraDetail) {
      sub.textContent = item.extraDetail;
    } else if (item.resets_at) {
      const resetDate = new Date(item.resets_at);
      const now = new Date();
      const isToday = resetDate.getFullYear() === now.getFullYear()
        && resetDate.getMonth() === now.getMonth()
        && resetDate.getDate() === now.getDate();
      const tzParts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(resetDate);
      const tz = tzParts.find(p => p.type === 'timeZoneName')?.value || '';
      const resetStr = isToday
        ? resetDate.toLocaleTimeString()
        : resetDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
      sub.textContent = `Resets ${resetStr} ${tz}`;
    }
    cell.appendChild(sub);

    wrapper.appendChild(cell);
  }

  container.appendChild(wrapper);

  // Project cost at full 7-day quota utilization
  const sevenDay = data.seven_day;
  if (sevenDay && sevenDay.utilization > 0 && opts.cost7d > 0) {
    const pct = sevenDay.utilization / 100;
    const projectedCost = opts.cost7d / pct;

    const proj = document.createElement('div');
    proj.style.cssText = 'margin-top:12px;padding:8px 12px;background:#1e293b;border-radius:6px;font-size:12px;color:#94a3b8';
    const monthlyProjected = projectedCost * (30 / 7);

    // Format the quota window range for display
    const dtFmt = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    const tzParts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date());
    const tz = tzParts.find(p => p.type === 'timeZoneName')?.value || '';
    const windowRange = opts.quotaWindowFrom && opts.quotaWindowTo
      ? ` <span style="color:#64748b">(${opts.quotaWindowFrom.toLocaleString(undefined, dtFmt)} → ${opts.quotaWindowTo.toLocaleString(undefined, dtFmt)} ${tz})</span>`
      : '';

    proj.innerHTML =
      `7-day usage: <strong style="color:#e2e8f0">$${opts.cost7d.toFixed(2)}</strong> API cost at <strong style="color:#e2e8f0">${sevenDay.utilization.toFixed(1)}%</strong> quota${windowRange}` +
      `<br>Projected at 100%: <strong style="color:#fbbf24">$${projectedCost.toFixed(2)}</strong>/week` +
      ` · <strong style="color:#fbbf24">$${monthlyProjected.toFixed(2)}</strong>/month`;
    container.appendChild(proj);
  }
}
