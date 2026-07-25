import { C, MIX, fmtCost } from '../theme.js';

/**
 * Two meters on one scale: what you pay vs. what the same work would cost at
 * API rates. `quotaContext` (optional) adds the break-even line — the share of
 * the 7-day quota at which API cost overtakes the subscription fee.
 */
export function renderCostComparison(container, data, quotaContext = null) {
  container.innerHTML = '';

  const subscription = data.subscription_cost_usd || 0;
  const api = data.api_equivalent_cost_usd || 0;
  const scale = Math.max(subscription, api, 1);

  const bars = [
    { label: 'You pay, per month', value: subscription, color: MIX.cacheRead },
    {
      label: quotaContext ? 'API equivalent, this quota window' : 'API equivalent, selected range',
      value: api,
      color: C.accent,
    },
  ];

  for (const b of bars) {
    const el = document.createElement('div');
    el.className = 'bar-stat';
    el.innerHTML =
      `<div class="bar-stat-head">` +
        `<span class="bar-stat-label">${b.label}</span>` +
        `<span class="bar-stat-value" style="color:${b.color === C.accent ? C.accent : C.text}">${fmtCost(b.value)}</span>` +
      `</div>` +
      `<div class="bar-stat-track"><div class="bar-stat-fill" style="width:${(b.value / scale) * 100}%;background:${b.color}"></div></div>`;
    container.appendChild(el);
  }

  const note = document.createElement('div');
  note.className = 'panel-note';
  if (quotaContext && quotaContext.utilization > 0 && quotaContext.cost7d > 0) {
    // At `utilization`% of the window you burned `cost7d` of API value, so the
    // fee is matched at utilization × price / cost7d.
    const breakEven = quotaContext.utilization * subscription / quotaContext.cost7d;
    const ahead = quotaContext.utilization >= breakEven;
    note.innerHTML =
      `Break even at <b>${breakEven.toFixed(1)}%</b> of the 7-day quota. ` +
      `You are at <b>${quotaContext.utilization.toFixed(1)}%</b>` +
      (ahead ? ` — <span style="color:${C.ok}">the subscription is already paying for itself</span>.` : '.');
  } else {
    // No break-even number here: the selected range is not the quota window, so
    // a "% of quota" figure would mix two different spans. State the two
    // quantities and let the reader judge rather than fabricate a verdict.
    note.innerHTML =
      `<b>${fmtCost(api)}</b> of API value in the selected range, against a <b>${fmtCost(subscription)}</b> monthly fee. ` +
      `Match the range to the quota window for the break-even line.`;
  }
  container.appendChild(note);
}
