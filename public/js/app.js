import { fetchUsage, fetchModels, fetchProjects, fetchSessions, fetchCost, fetchCache, fetchStatus, fetchQuota, fetchSubscription, fetchQuotaCycles } from './api.js';
import { initDatePicker } from './components/date-picker.js';
import { initPlanSelector } from './components/plan-selector.js';
import { renderTokenTrend } from './charts/token-trend.js';
import { renderCostComparison } from './charts/cost-comparison.js';
import { renderModelDistribution } from './charts/model-distribution.js';
import { renderCacheEfficiency } from './charts/cache-efficiency.js';
import { renderProjectDistribution } from './charts/project-distribution.js';
import { renderSessionTable } from './charts/session-stats.js';
import { renderQuotaGauges } from './charts/quota-gauge.js';
import { renderQuotaCycles } from './charts/quota-cycles.js';

const state = {
  dateRange: { from: null, to: null },
  plan: { plan: 'max20x', customPrice: null },
  granularity: localStorage.getItem('selectedGranularity') || 'hourly',
  trendYAxis: localStorage.getItem('trendYAxis') || 'tokens',
  sessionSort: 'date',
  sessionOrder: 'desc',
  sessionPage: 1,
  sessionProject: '',
  autoRefresh: localStorage.getItem('autoRefresh') !== 'false',
  cycleModel: 'overall',
  autoRefreshInterval: 30,
  _refreshTimer: null,
  quotaRefreshInterval: 120,
  _quotaTimer: null,
};

let datePicker, planSelector;
let _cachedCycleData = null;

/**
 * Find a quota cycle whose period matches the selected date range.
 * Returns the cycle's overall metrics, or null if no match.
 * Tolerance: 25 hours (handles hour-level normalization and timezone offsets).
 */
function findMatchingCycle(dateRange, cycleData) {
  if (!dateRange.from || !dateRange.to || !cycleData) return null;
  const viewFrom = new Date(dateRange.from).getTime();
  const viewTo = new Date(dateRange.to).getTime();
  const tolerance = 25 * 60 * 60 * 1000;

  const candidates = [];
  if (cycleData.currentCycle) candidates.push(cycleData.currentCycle);
  if (cycleData.history) candidates.push(...cycleData.history);

  for (const c of candidates) {
    if (!c.start || !c.resets_at || !c.overall?.tokens) continue;
    const cStart = new Date(c.start).getTime();
    const cEnd = new Date(c.resets_at).getTime();
    if (Math.abs(viewFrom - cStart) < tolerance && Math.abs(viewTo - cEnd) < tolerance) {
      return c.overall;
    }
  }
  return null;
}

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
}

function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (el) {
    const now = new Date();
    el.textContent = `Updated ${now.toLocaleTimeString()} ${getTimezoneAbbr()}`;
  }
}

function getTimezoneAbbr() {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date());
  const tz = parts.find(p => p.type === 'timeZoneName');
  return tz ? tz.value : '';
}

// Derive the 7-day quota window from resets_at, truncated to the hour
function getQuotaWindow(sevenDay) {
  if (!sevenDay?.resets_at) return null;
  const resetsAt = new Date(sevenDay.resets_at);
  resetsAt.setMinutes(0, 0, 0);
  const windowStart = new Date(resetsAt);
  windowStart.setDate(windowStart.getDate() - 7);
  return { from: windowStart, to: resetsAt };
}

async function loadQuota() {
  try {
    const [data, cycleData] = await Promise.all([fetchQuota(), fetchQuotaCycles()]);
    _cachedCycleData = cycleData;

    // Use the actual quota window (resets_at - 7 days → resets_at)
    let cost7dValue = 0;
    let quotaWindowFrom = null;
    let quotaWindowTo = null;
    const sevenDay = data.seven_day;
    const window = getQuotaWindow(sevenDay);
    if (window && sevenDay.utilization > 0) {
      quotaWindowFrom = window.from;
      quotaWindowTo = window.to;
      // Prefer cycle data (multi-machine merged) over cost API (local only)
      cost7dValue = cycleData?.currentCycle?.overall?.actualCost || 0;
      if (cost7dValue === 0) {
        const cost7d = await fetchCost({
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          plan: state.plan.plan,
        });
        cost7dValue = cost7d.api_equivalent_cost_usd;
      }
    }

    renderQuotaGauges(document.getElementById('chart-quota'), data, {
      cost7d: cost7dValue, quotaWindowFrom, quotaWindowTo,
    });
    const el = document.getElementById('quota-last-updated');
    if (el && data.lastFetched) el.textContent = `Updated ${new Date(data.lastFetched).toLocaleTimeString()} ${getTimezoneAbbr()}`;
    renderQuotaCycles(document.getElementById('chart-quota-cycles'), cycleData, {
      modelKey: state.cycleModel,
    });
  } catch { /* silently degrade */ }
}

function loadQuotaCyclesData() {
  if (_cachedCycleData) {
    renderQuotaCycles(document.getElementById('chart-quota-cycles'), _cachedCycleData, {
      modelKey: state.cycleModel,
    });
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  if (state.autoRefresh) {
    state._refreshTimer = setInterval(() => loadAll(), state.autoRefreshInterval * 1000);
    state._quotaTimer = setInterval(() => loadQuota(), state.quotaRefreshInterval * 1000);
  }
}

function stopAutoRefresh() {
  if (state._refreshTimer) {
    clearInterval(state._refreshTimer);
    state._refreshTimer = null;
  }
  if (state._quotaTimer) {
    clearInterval(state._quotaTimer);
    state._quotaTimer = null;
  }
}

async function loadAll() {
  const params = { ...state.dateRange };
  const planParams = { ...state.dateRange, plan: state.plan.plan };
  if (state.plan.customPrice) planParams.customPrice = state.plan.customPrice;

  const [usage, models, projects, sessions, cost, cache] = await Promise.all([
    fetchUsage({ ...params, granularity: state.granularity }),
    fetchModels(params),
    fetchProjects(params),
    fetchSessions({
      ...params,
      project: state.sessionProject,
      sort: state.sessionSort,
      order: state.sessionOrder,
      page: state.sessionPage,
    }),
    fetchCost(planParams),
    fetchCache(params),
  ]);

  // Summary cards — use multi-machine cycle data when date range matches a cycle
  const t = usage.total;
  let tokIn = t.input_tokens, tokOut = t.output_tokens;
  let tokCR = t.cache_read_tokens, tokCW = t.cache_creation_tokens;
  let apiCost = cost.api_equivalent_cost_usd;
  const matchedCycle = findMatchingCycle(state.dateRange, _cachedCycleData);
  if (matchedCycle?.tokens) {
    tokIn = matchedCycle.tokens.input; tokOut = matchedCycle.tokens.output;
    tokCR = matchedCycle.tokens.cacheRead; tokCW = matchedCycle.tokens.cacheCreation;
    apiCost = matchedCycle.actualCost;
  }
  const totalAll = tokIn + tokOut + tokCR + tokCW;
  document.getElementById('val-total-tokens').textContent = formatNumber(totalAll);
  document.getElementById('sub-total-tokens').innerHTML =
    `<span style="color:#4ade80">cache read:${formatNumber(tokCR)}</span> · ` +
    `<span style="color:#f59e0b">cache write:${formatNumber(tokCW)}</span> · ` +
    `<span style="color:#60a5fa">in:${formatNumber(tokIn)}</span> · ` +
    `<span style="color:#f97316">out:${formatNumber(tokOut)}</span>`;
  document.getElementById('val-api-cost').textContent = `$${apiCost.toFixed(2)}`;

  const totalInput = tokIn + tokCR + tokCW;
  document.getElementById('val-cache-rate').textContent = totalInput > 0
    ? `${((tokCR / totalInput) * 100).toFixed(1)}%`
    : `${(cache.cache_read_rate * 100).toFixed(1)}%`;

  // Set active granularity button
  const activeGran = usage.granularity;
  document.querySelectorAll('#granularity-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.granularity === activeGran);
  });

  // Charts
  renderTokenTrend(document.getElementById('chart-token-trend'), usage, { yAxis: state.trendYAxis });
  renderCostComparison(document.getElementById('chart-cost-comparison'), cost);
  renderModelDistribution(document.getElementById('chart-model-distribution'), models);
  renderCacheEfficiency(document.getElementById('chart-cache-efficiency'), cache);
  renderProjectDistribution(document.getElementById('chart-project-distribution'), projects);
  renderSessionTable(document.getElementById('session-table'), sessions, {
    onSort: (key) => {
      if (state.sessionSort === key) {
        state.sessionOrder = state.sessionOrder === 'desc' ? 'asc' : 'desc';
      } else {
        state.sessionSort = key;
        state.sessionOrder = 'desc';
      }
      state.sessionPage = 1;
      loadAll();
    },
    onPageChange: (page) => {
      state.sessionPage = page;
      loadAll();
    },
  });

  updateLastUpdated();
}

// Max bucket limits per granularity to avoid crashing the browser
const GRANULARITY_MAX_DAYS = { hourly: 14, daily: 90, weekly: 365, monthly: 1825 };

function updateGranularityButtons() {
  const { from, to } = state.dateRange;
  const days = (from && to) ? (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24) : 30;
  document.querySelectorAll('#granularity-toggle button').forEach(btn => {
    const gran = btn.dataset.granularity;
    const maxDays = GRANULARITY_MAX_DAYS[gran] || 9999;
    const tooLarge = days > maxDays;
    btn.disabled = tooLarge;
    btn.title = tooLarge ? `Range too large for ${gran} view (max ${maxDays} days)` : '';
  });
  // If currently selected granularity is now disabled, switch to the finest available
  const currentBtn = document.querySelector(`#granularity-toggle button[data-granularity="${state.granularity}"]`);
  if (currentBtn && currentBtn.disabled) {
    const order = ['hourly', 'daily', 'weekly', 'monthly'];
    const available = order.find(g => {
      const b = document.querySelector(`#granularity-toggle button[data-granularity="${g}"]`);
      return b && !b.disabled;
    });
    if (available) {
      state.granularity = available;
      localStorage.setItem('selectedGranularity', state.granularity);
    }
  }
  // Update active class
  document.querySelectorAll('#granularity-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.granularity === state.granularity);
  });
}

function init() {
  datePicker = initDatePicker(document.getElementById('date-picker'), (range) => {
    state.dateRange = range;
    state.sessionPage = 1;
    updateGranularityButtons();
    loadAll();
  });
  state.dateRange = datePicker.getRange();
  updateGranularityButtons();

  planSelector = initPlanSelector(document.getElementById('plan-selector'), (plan) => {
    state.plan = plan;
    loadAll();
  });

  document.getElementById('granularity-toggle').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && !e.target.disabled) {
      state.granularity = e.target.dataset.granularity;
      localStorage.setItem('selectedGranularity', state.granularity);
      loadAll();
    }
  });

  // Y-axis toggle (tokens / dollars)
  const yaxisToggle = document.getElementById('yaxis-toggle');
  yaxisToggle.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.yaxis === state.trendYAxis);
  });
  yaxisToggle.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      state.trendYAxis = e.target.dataset.yaxis;
      localStorage.setItem('trendYAxis', state.trendYAxis);
      yaxisToggle.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.yaxis === state.trendYAxis);
      });
      loadAll();
    }
  });

  const filterInput = document.getElementById('session-filter');
  let filterTimeout;
  filterInput.addEventListener('input', () => {
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
      state.sessionProject = filterInput.value.trim();
      state.sessionPage = 1;
      loadAll();
    }, 300);
  });

  document.getElementById('session-sort').addEventListener('change', (e) => {
    state.sessionSort = e.target.value;
    state.sessionOrder = 'desc';
    state.sessionPage = 1;
    loadAll();
  });

  document.getElementById('btn-refresh').addEventListener('click', () => { loadAll(); loadQuota(); });

  const autoToggle = document.getElementById('auto-refresh-toggle');
  autoToggle.checked = state.autoRefresh;
  autoToggle.addEventListener('change', () => {
    state.autoRefresh = autoToggle.checked;
    localStorage.setItem('autoRefresh', state.autoRefresh);
    if (state.autoRefresh) {
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  document.getElementById('cycle-model-toggle').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      state.cycleModel = e.target.dataset.cycleModel;
      document.querySelectorAll('#cycle-model-toggle button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cycleModel === state.cycleModel);
      });
      loadQuotaCyclesData();
    }
  });

  // Auto-detect subscription tier
  fetchSubscription().then(info => {
    if (info.plan) {
      planSelector.setDetectedPlan(info.plan);
      state.plan = planSelector.getPlan();
    }
    const tierLabels = { pro: 'Pro', max5x: 'Max 5x', max20x: 'Max 20x' };
    const label = tierLabels[info.plan];
    if (label) {
      const h2 = document.querySelector('#quota-section h2');
      if (h2) h2.textContent = `Subscription Quota (${label})`;
    }
  }).catch(() => {});

  // Default date range to the 7-day quota window (resets_at - 7 days → resets_at)
  fetchQuota().then(data => {
    const window = getQuotaWindow(data.seven_day);
    if (window) {
      const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      datePicker.setRange(fmt(window.from), fmt(window.to));
    }
  }).catch(() => {}).finally(() => {
    loadAll();
    loadQuota();
    startAutoRefresh();
  });
}

document.addEventListener('DOMContentLoaded', init);
