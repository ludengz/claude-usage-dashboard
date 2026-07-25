import { C, meterColor, fmtCost } from '../theme.js';

function tzAbbr(date = new Date()) {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(date);
  return parts.find(p => p.type === 'timeZoneName')?.value || '';
}

// "in 2h 21m" — the number people actually act on; the absolute reset time
// stays below as the reference.
function etaFrom(resetsAt) {
  const ms = new Date(resetsAt) - Date.now();
  if (!(ms > 0)) return '';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function formatReset(resetsAt) {
  const d = new Date(resetsAt);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return isToday
    ? `${time} ${tzAbbr(d)}`
    : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time} ${tzAbbr(d)}`;
}

export function renderQuotaGauges(container, data) {
  container.innerHTML = '';

  if (!data || data.available === false) {
    const msg = document.createElement('div');
    msg.className = 'quota-unavailable';
    msg.textContent = data?.error === 'no_credentials'
      ? 'No Claude credentials found. Run the "claude" CLI to authenticate.'
      : data?.error === 'rate_limited'
        ? 'Quota API rate limited. Will retry on next refresh.'
        : 'Quota data unavailable';
    container.appendChild(msg);
    return;
  }

  const items = [];
  if (data.five_hour) items.push({ label: '5-hour window', ...data.five_hour });
  if (data.seven_day) items.push({ label: '7-day total', ...data.seven_day });
  if (data.seven_day_opus) items.push({ label: '7-day opus', ...data.seven_day_opus });
  if (data.seven_day_sonnet) items.push({ label: '7-day sonnet', ...data.seven_day_sonnet });
  if (data.extra_usage?.is_enabled) {
    items.push({
      label: 'Extra usage',
      utilization: data.extra_usage.utilization || 0,
      resets_at: null,
      detail: data.extra_usage.monthly_limit != null
        ? `${fmtCost(data.extra_usage.used_credits || 0)} / ${fmtCost(data.extra_usage.monthly_limit)}`
        : null,
    });
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="quota-unavailable">No quota data available</div>';
    return;
  }

  for (const item of items) {
    const pct = Math.min(100, Math.max(0, item.utilization || 0));
    const color = meterColor(pct);

    const cell = document.createElement('div');
    cell.className = 'quota-item';
    const eta = item.resets_at ? etaFrom(item.resets_at) : '';
    const foot = item.detail
      ? item.detail
      : item.resets_at ? `resets ${formatReset(item.resets_at)}` : '';

    cell.innerHTML =
      `<div class="quota-item-head">` +
        `<span class="quota-item-label">${item.label}</span>` +
        `<span class="quota-item-eta">${eta}</span>` +
      `</div>` +
      `<div class="quota-pct"><span class="num" style="color:${color}">${pct.toFixed(1)}</span><span class="sym">%</span></div>` +
      `<div class="quota-track"><div class="quota-fill" style="width:${pct}%;background:${color}"></div></div>` +
      `<div class="quota-resets">${foot}</div>`;
    container.appendChild(cell);
  }
}

/**
 * The rail's value story: what a subscription dollar buys at full quota.
 * Derived from the 7-day window because that is the only window where the
 * quota API gives both a utilization and a matching API cost.
 *
 * Returns the projections so callers can reuse them (e.g. the break-even line).
 */
export function renderSubscriptionValue(block, { quota, cost7d, subscriptionPrice }) {
  const utilization = quota?.seven_day?.utilization;
  if (!(utilization > 0) || !(cost7d > 0) || !(subscriptionPrice > 0)) {
    block.hidden = true;
    return null;
  }

  const weekly = cost7d / (utilization / 100);
  const monthly = weekly * (30 / 7);
  const multiple = monthly / subscriptionPrice;

  block.hidden = false;
  block.querySelector('#val-multiple').textContent = `${multiple.toFixed(1)}×`;

  const stats = [
    { label: 'Used this cycle', value: fmtCost(cost7d), color: C.text },
    { label: 'Projected weekly', value: fmtCost(weekly), color: C.accent },
    { label: 'Projected monthly', value: fmtCost(monthly), color: C.accent },
  ];
  block.querySelector('#value-stats').innerHTML = stats.map(s =>
    `<div class="value-stat">` +
      `<span class="value-stat-label">${s.label}</span>` +
      `<span class="value-stat-value" style="color:${s.color}">${s.value}</span>` +
    `</div>`
  ).join('');

  return { weekly, monthly, multiple, utilization, cost7d };
}
