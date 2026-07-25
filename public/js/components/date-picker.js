// Range control for the 2b header: a named preset plus the resolved dates,
// rather than two free-form date boxes. The quota window is the default and
// primary state — it is the only range for which utilization-based figures
// (the cost panel's break-even line) are meaningful. Arbitrary ranges stay
// available under "Custom…".

const PRESETS = {
  quota: { label: 'Quota window' },
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  '90d': { label: 'Last 90 days', days: 90 },
  custom: { label: 'Custom…' },
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Local date parts throughout — toISOString() yields the UTC date, which drops
// "today" from a range before 08:00 in UTC+8 etc., while the whole dashboard
// filters by local timezone.
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
// new Date('2026-07-24') parses as UTC midnight; split manually to stay local.
const parseLocal = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function labelFor(from, to) {
  if (!from || !to) return '—';
  const a = parseLocal(from), b = parseLocal(to);
  const sameYear = a.getFullYear() === b.getFullYear();
  const one = d => `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
  return `${one(a)} — ${one(b)}`;
}

export function initDatePicker(container, onChange) {
  let preset = localStorage.getItem('datePickerPreset');
  if (!PRESETS[preset]) {
    // Upgrade path: before presets existed the range was two stored dates.
    // Defaulting those users to "quota" would overwrite the range they chose
    // on the very first load, so keep their dates and call it what it is.
    const legacy = localStorage.getItem('datePickerFrom') && localStorage.getItem('datePickerTo');
    preset = legacy ? 'custom' : 'quota';
  }
  let quotaWindow = null;
  let current = null;

  container.innerHTML = `
    <select id="range-preset" class="range-preset" aria-label="Date range">
      ${Object.entries(PRESETS).map(([key, p]) =>
        `<option value="${key}"${key === preset ? ' selected' : ''}>${p.label}</option>`
      ).join('')}
    </select>
    <span class="range-sep"></span>
    <span id="range-dates" class="range-dates"></span>
    <span id="range-custom" class="range-custom" hidden>
      <input type="date" id="date-from" aria-label="From date">
      <span class="dash">—</span>
      <input type="date" id="date-to" aria-label="To date">
    </span>
  `;

  const select = container.querySelector('#range-preset');
  const datesEl = container.querySelector('#range-dates');
  const customEl = container.querySelector('#range-custom');
  const fromInput = container.querySelector('#date-from');
  const toInput = container.querySelector('#date-to');

  fromInput.value = localStorage.getItem('datePickerFrom') || fmt(daysAgo(30));
  toInput.value = localStorage.getItem('datePickerTo') || fmt(new Date());

  function resolve() {
    if (preset === 'custom') return { from: fromInput.value, to: toInput.value };
    // The quota window arrives with the first /api/quota response. Until then
    // fall back to a week so the dashboard paints immediately instead of
    // waiting on a round-trip to Anthropic.
    if (preset === 'quota') return quotaWindow || { from: fmt(daysAgo(6)), to: fmt(new Date()) };
    // days - 1, because filterByDateRange includes both endpoints: it expands
    // `to` to 23:59:59.999, so today-7 → today would span eight calendar days
    // and quietly inflate every figure a "Last 7 days" preset reports.
    return { from: fmt(daysAgo(PRESETS[preset].days - 1)), to: fmt(new Date()) };
  }

  function apply({ emit = true } = {}) {
    const next = resolve();
    const changed = !current || current.from !== next.from || current.to !== next.to;
    current = next;

    // Keep the inputs in sync even while hidden, so switching to Custom starts
    // from whatever the reader was already looking at.
    fromInput.value = next.from;
    toInput.value = next.to;
    datesEl.textContent = labelFor(next.from, next.to);
    customEl.hidden = preset !== 'custom';
    datesEl.hidden = preset === 'custom';

    localStorage.setItem('datePickerPreset', preset);
    localStorage.setItem('datePickerFrom', next.from);
    localStorage.setItem('datePickerTo', next.to);

    if (emit && changed) onChange(next);
  }

  select.addEventListener('change', () => { preset = select.value; apply(); });
  fromInput.addEventListener('change', () => { if (preset === 'custom') apply(); });
  toInput.addEventListener('change', () => { if (preset === 'custom') apply(); });

  apply({ emit: false });

  return {
    getRange: () => ({ ...current }),
    /**
     * Called on every quota refresh, not just the first: resets_at rolls the
     * window forward, and a pinned range would silently drift out of the
     * window it claims to show.
     */
    setQuotaWindow: (from, to) => {
      quotaWindow = { from, to };
      if (preset === 'quota') apply();
    },
    isQuotaWindow: () => preset === 'quota',
  };
}
