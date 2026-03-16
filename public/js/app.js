import { fetchUsage, fetchModels, fetchProjects, fetchSessions, fetchCost, fetchCache } from './api.js';
import { initDatePicker } from './components/date-picker.js';
import { initPlanSelector } from './components/plan-selector.js';
import { renderTokenTrend } from './charts/token-trend.js';
import { renderCostComparison } from './charts/cost-comparison.js';
import { renderModelDistribution } from './charts/model-distribution.js';
import { renderCacheEfficiency } from './charts/cache-efficiency.js';
import { renderProjectDistribution } from './charts/project-distribution.js';
import { renderSessionTable } from './charts/session-stats.js';

const state = {
  dateRange: { from: null, to: null },
  plan: { plan: 'max20x', customPrice: null },
  granularity: 'hourly',
  sessionSort: 'date',
  sessionOrder: 'desc',
  sessionPage: 1,
  sessionProject: '',
};

let datePicker, planSelector;

function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toString();
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

  // Summary cards
  const t = usage.total;
  const totalAll = t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_creation_tokens;
  document.getElementById('val-total-tokens').textContent = formatNumber(totalAll);
  document.getElementById('sub-total-tokens').innerHTML =
    `<span style="color:#4ade80">cache read:${formatNumber(t.cache_read_tokens)}</span> · ` +
    `<span style="color:#f59e0b">cache write:${formatNumber(t.cache_creation_tokens)}</span> · ` +
    `<span style="color:#60a5fa">in:${formatNumber(t.input_tokens)}</span> · ` +
    `<span style="color:#f97316">out:${formatNumber(t.output_tokens)}</span>`;
  document.getElementById('val-api-cost').textContent = `$${cost.api_equivalent_cost_usd.toFixed(2)}`;

  const savings = cost.savings_usd;
  const savingsEl = document.getElementById('val-savings');
  savingsEl.textContent = `$${Math.abs(savings).toFixed(2)}`;
  savingsEl.style.color = savings >= 0 ? '#4ade80' : '#ef4444';
  document.getElementById('sub-savings').textContent = savings >= 0 ? 'subscription saved you this much!' : 'API would have been cheaper';

  document.getElementById('val-cache-rate').textContent = `${(cache.cache_read_rate * 100).toFixed(1)}%`;

  // Set active granularity button
  const activeGran = usage.granularity;
  document.querySelectorAll('.granularity-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.granularity === activeGran);
  });

  // Charts
  renderTokenTrend(document.getElementById('chart-token-trend'), usage);
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
}

function init() {
  datePicker = initDatePicker(document.getElementById('date-picker'), (range) => {
    state.dateRange = range;
    state.sessionPage = 1;
    loadAll();
  });
  state.dateRange = datePicker.getRange();

  planSelector = initPlanSelector(document.getElementById('plan-selector'), (plan) => {
    state.plan = plan;
    loadAll();
  });

  document.getElementById('granularity-toggle').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      state.granularity = e.target.dataset.granularity;
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

  loadAll();
}

document.addEventListener('DOMContentLoaded', init);
