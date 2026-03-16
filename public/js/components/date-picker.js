export function initDatePicker(container, onChange) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const fmt = d => d.toISOString().slice(0, 10);

  container.innerHTML = `
    <span>📅</span>
    <input type="date" id="date-from" value="${fmt(thirtyDaysAgo)}">
    <span>–</span>
    <input type="date" id="date-to" value="${fmt(today)}">
  `;

  const fromInput = container.querySelector('#date-from');
  const toInput = container.querySelector('#date-to');
  const emitChange = () => onChange({ from: fromInput.value, to: toInput.value });
  fromInput.addEventListener('change', emitChange);
  toInput.addEventListener('change', emitChange);

  return { getRange: () => ({ from: fromInput.value, to: toInput.value }) };
}
