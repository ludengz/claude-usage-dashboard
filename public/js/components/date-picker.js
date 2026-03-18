export function initDatePicker(container, onChange) {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const fmt = d => d.toISOString().slice(0, 10);

  const savedFrom = localStorage.getItem('datePickerFrom') || fmt(thirtyDaysAgo);
  const savedTo = localStorage.getItem('datePickerTo') || fmt(today);

  container.innerHTML = `
    <span>📅</span>
    <input type="date" id="date-from" value="${savedFrom}">
    <span>–</span>
    <input type="date" id="date-to" value="${savedTo}">
  `;

  const fromInput = container.querySelector('#date-from');
  const toInput = container.querySelector('#date-to');
  const emitChange = () => {
    localStorage.setItem('datePickerFrom', fromInput.value);
    localStorage.setItem('datePickerTo', toInput.value);
    onChange({ from: fromInput.value, to: toInput.value });
  };
  fromInput.addEventListener('change', emitChange);
  toInput.addEventListener('change', emitChange);

  return {
    getRange: () => ({ from: fromInput.value, to: toInput.value }),
    setRange: (from, to) => {
      fromInput.value = from;
      toInput.value = to;
      emitChange();
    },
  };
}
