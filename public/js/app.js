import { fetchUsage, fetchModels, fetchProjects, fetchSessions, fetchCost, fetchCache, fetchStatus, fetchQuota, fetchSubscription, fetchQuotaCycles } from './api.js';
import { initDatePicker } from './components/date-picker.js';
import { initPlanSelector } from './components/plan-selector.js';
import { renderTokenTrend } from './charts/token-trend.js';
import { renderCostComparison } from './charts/cost-comparison.js';
import { renderModelDistribution } from './charts/model-distribution.js';
import { renderCacheEfficiency } from './charts/cache-efficiency.js';
import { renderProjectDistribution } from './charts/project-distribution.js';
import { renderSessionTable } from './charts/session-stats.js';
import { renderQuotaGauges, renderSubscriptionValue } from './charts/quota-gauge.js';
import { renderQuotaCycles } from './charts/quota-cycles.js';
import { C, MIX, fmtTokens, fmtCost } from './theme.js';

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
// The break-even line lives in the cost panel but its inputs arrive with the
// quota round-trip, which finishes independently of loadAll(). Cache both
// sides so whichever lands second can repaint the panel.
let _quotaContext = null;
let _quotaWindow = null;
let _lastCost = null;
// Re-running the scrollspy after a render: section heights move when charts
// and tables repaint, which can leave the highlighted anchor pointing at a
// section that is no longer under the trigger line.
let _refreshAnchors = () => {};

function setMeter(id, segments) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = segments
    .filter(s => s.pct > 0)
    .map(s => `<div style="width:${Math.min(100, s.pct)}%;background:${s.color}"></div>`)
    .join('');
}

function getTimezoneAbbr() {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' }).formatToParts(new Date());
  return parts.find(p => p.type === 'timeZoneName')?.value || '';
}

// The header clock reports the last successful refresh, not wall time — a
// ticking clock that keeps ticking after the data went stale is a lie.
function markRefreshed() {
  const el = document.getElementById('last-updated');
  if (el) el.textContent = new Date().toLocaleTimeString();
  const dot = document.querySelector('.clock-dot');
  if (dot) dot.classList.remove('is-stale');
  clearTimeout(markRefreshed._staleTimer);
  markRefreshed._staleTimer = setTimeout(() => {
    document.querySelector('.clock-dot')?.classList.add('is-stale');
  }, state.autoRefreshInterval * 2500);
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

// The break-even line is "where the API bar would cross the subscription bar",
// so it may only be drawn when both bars describe the same span the quota
// utilization does. Widen the date range past the quota window and the two
// stop being comparable — drop the line rather than print a number that
// silently mixes a 90-day cost with a 7-day utilization.
function quotaContextForRange() {
  if (!_quotaContext || !_quotaWindow) return null;
  const { from, to } = state.dateRange;
  return (from === _quotaWindow.from && to === _quotaWindow.to) ? _quotaContext : null;
}

function renderCostPanel() {
  if (!_lastCost) return;
  renderCostComparison(document.getElementById('chart-cost-comparison'), _lastCost, quotaContextForRange());
}

async function loadQuota() {
  try {
    const [data, cycleData] = await Promise.all([fetchQuota(), fetchQuotaCycles()]);
    _cachedCycleData = cycleData;

    let cost7dValue = 0;
    const sevenDay = data.seven_day;
    const window = getQuotaWindow(sevenDay);
    _quotaWindow = null;
    if (window) {
      // Local date-only format (YYYY-MM-DD) matches the date picker's
      // filtering — filterByDateRange treats date-only strings as local
      // midnight boundaries, keeping results consistent across views.
      const fmtD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      _quotaWindow = { from: fmtD(window.from), to: fmtD(window.to) };
      // Snap the "Quota window" preset to the real window on every refresh —
      // resets_at rolls forward and the range must follow it.
      datePicker?.setQuotaWindow(_quotaWindow.from, _quotaWindow.to);
      if (sevenDay.utilization > 0) {
        const cost7d = await fetchCost({
          ..._quotaWindow,
          plan: state.plan.plan,
          customPrice: state.plan.customPrice,
        });
        cost7dValue = cost7d.api_equivalent_cost_usd;
      }
    }

    renderQuotaGauges(document.getElementById('chart-quota'), data);

    const price = state.plan.customPrice || _lastCost?.subscription_cost_usd || 0;
    renderSubscriptionValue(document.getElementById('value-block'), {
      quota: data, cost7d: cost7dValue, subscriptionPrice: price,
    });

    _quotaContext = sevenDay?.utilization > 0 && cost7dValue > 0
      ? { utilization: sevenDay.utilization, cost7d: cost7dValue }
      : null;
    renderCostPanel();

    const el = document.getElementById('quota-last-updated');
    if (el && data.lastFetched) el.textContent = new Date(data.lastFetched).toLocaleTimeString();

    renderQuotaCycles(document.getElementById('chart-quota-cycles'), cycleData, {
      modelKey: state.cycleModel,
    });
    return data;
  } catch { return null; /* silently degrade */ }
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
  if (state._refreshTimer) { clearInterval(state._refreshTimer); state._refreshTimer = null; }
  if (state._quotaTimer) { clearInterval(state._quotaTimer); state._quotaTimer = null; }
}

let _loadSeq = 0;

async function loadAll() {
  // Guard against stale responses: auto-refresh and rapid user input fire
  // concurrent batches; only the most recently started one may render.
  const seq = ++_loadSeq;
  const params = { ...state.dateRange };
  const planParams = { ...state.dateRange, plan: state.plan.plan };
  if (state.plan.customPrice) planParams.customPrice = state.plan.customPrice;

  let usage, models, projects, sessions, cost, cache;
  try {
    [usage, models, projects, sessions, cost, cache] = await Promise.all([
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
  } catch (err) {
    console.error('Failed to load dashboard data:', err);
    return;
  }
  if (seq !== _loadSeq) return;

  _lastCost = cost;

  // ---- KPI row ----
  const t = usage.total;
  const totalAll = t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_creation_tokens;
  document.getElementById('val-total-tokens').textContent = fmtTokens(totalAll);
  document.getElementById('sub-total-tokens').textContent =
    `cr ${fmtTokens(t.cache_read_tokens)} · cw ${fmtTokens(t.cache_creation_tokens)} · ` +
    `in ${fmtTokens(t.input_tokens)} · out ${fmtTokens(t.output_tokens)}`;
  const share = v => (totalAll > 0 ? (v / totalAll) * 100 : 0);
  setMeter('meter-total-tokens', [
    { pct: share(t.cache_read_tokens), color: MIX.cacheRead },
    { pct: share(t.cache_creation_tokens), color: MIX.cacheWrite },
    { pct: share(t.input_tokens), color: MIX.input },
    { pct: share(t.output_tokens), color: MIX.output },
  ]);

  const apiCost = cost.api_equivalent_cost_usd;
  const price = cost.subscription_cost_usd || 0;
  document.getElementById('val-api-cost').textContent = fmtCost(apiCost);
  const feeShare = price > 0 ? (apiCost / price) * 100 : 0;
  setMeter('meter-api-cost', [{ pct: feeShare, color: C.accent }]);
  document.getElementById('sub-api-cost').textContent = price > 0
    ? `${feeShare.toFixed(0)}% of your ${fmtCost(price)} monthly fee`
    : 'at standard API pricing';

  const cacheRate = (cache.cache_read_rate || 0) * 100;
  document.getElementById('val-cache-rate').textContent = `${cacheRate.toFixed(1)}%`;
  setMeter('meter-cache-rate', [{ pct: cacheRate, color: C.ok }]);
  document.getElementById('sub-cache-rate').textContent = 'cache_read / total input · ≈10× cheaper';

  document.querySelectorAll('#granularity-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.granularity === usage.granularity);
  });

  // ---- charts ----
  renderTokenTrend(document.getElementById('chart-token-trend'), usage, { yAxis: state.trendYAxis });
  renderCostPanel();
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

  markRefreshed();
  _refreshAnchors();
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
  document.querySelectorAll('#granularity-toggle button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.granularity === state.granularity);
  });
}

// 2b has no sidebar: the header anchors are the only navigation, so they have
// to track the reader instead of only reacting to clicks.
function initAnchors() {
  const links = [...document.querySelectorAll('.anchor')];
  const sections = links
    .map(a => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if (sections.length === 0) return;

  for (const link of links) {
    link.addEventListener('click', (e) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const setActive = (id) => {
    for (const link of links) {
      link.classList.toggle('is-active', link.getAttribute('href') === `#${id}`);
    }
  };

  // A trigger line just below the sticky header, evaluated against every
  // section on each scroll. IntersectionObserver is the wrong tool here: its
  // callback only carries the sections whose state *changed*, so picking the
  // topmost of that partial batch skips any section shorter than the observed
  // band — Quota cycles (~190px) could never win against Projects entering
  // right behind it.
  const TRIGGER = 120; // must exceed section scroll-margin-top (108px)

  const currentSection = () => {
    // A short trailing section may never reach the trigger line because the
    // page runs out of scroll; at the bottom the last one is unambiguously
    // what the reader is looking at. Requires a scrollable page — on a viewport
    // taller than the document, "at the bottom" is also "at the top".
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll > 0 && window.scrollY >= maxScroll - 2) return sections[sections.length - 1];
    let current = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top <= TRIGGER) current = s;
    }
    return current;
  };

  let frame = 0;
  const update = () => {
    frame = 0;
    setActive(currentSection().id);
  };
  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  _refreshAnchors = onScroll;
  update();
}

function init() {
  initAnchors();

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
    loadQuota();
  });
  // Sync state with the selector's persisted choice — the hardcoded default
  // (max20x) otherwise drives cost math while the dropdown shows e.g. Pro.
  state.plan = planSelector.getPlan();

  document.getElementById('granularity-toggle').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && !e.target.disabled) {
      state.granularity = e.target.dataset.granularity;
      localStorage.setItem('selectedGranularity', state.granularity);
      loadAll();
    }
  });

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
    if (state.autoRefresh) startAutoRefresh();
    else stopAutoRefresh();
  });

  document.getElementById('cycle-model-toggle').addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && !e.target.disabled) {
      state.cycleModel = e.target.dataset.cycleModel;
      document.querySelectorAll('#cycle-model-toggle button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cycleModel === state.cycleModel);
      });
      loadQuotaCyclesData();
    }
  });

  // Machine badge — only meaningful when logs are synced from more than one box
  fetchStatus().then(status => {
    const badge = document.getElementById('machine-badge');
    if (badge && status.machine_count > 1) {
      badge.textContent = `${status.machine_count} machines`;
      badge.hidden = false;
    }
  }).catch(() => {});

  // Auto-detect subscription tier
  fetchSubscription().then(info => {
    if (info.plan) {
      planSelector.setDetectedPlan(info.plan);
      const detected = planSelector.getPlan();
      const changed = detected.plan !== state.plan.plan || detected.customPrice !== state.plan.customPrice;
      state.plan = detected;
      if (changed) loadAll(); // re-render costs if detection updated the plan after the initial load
    }
  }).catch(() => {});

  // Paint immediately with the preset's provisional range — gating the first
  // render on the quota round-trip to Anthropic held the whole dashboard blank
  // for seconds. loadQuota() then hands the real window to the picker, which
  // fires onChange and reloads only if the range actually moved.
  loadAll();
  startAutoRefresh();
  loadQuota();
}

document.addEventListener('DOMContentLoaded', init);
