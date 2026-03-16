const PLANS = {
  pro: { label: 'Pro', price: 20 },
  max5x: { label: 'Max 5x', price: 100 },
  max20x: { label: 'Max 20x', price: 200 },
};

export function initPlanSelector(container, onChange) {
  container.innerHTML = `
    <select id="plan-select">
      ${Object.entries(PLANS).map(([key, p]) =>
        `<option value="${key}" ${key === 'max5x' ? 'selected' : ''}>${p.label} ($${p.price}/mo)</option>`
      ).join('')}
    </select>
    <input type="number" id="custom-price" placeholder="Custom $" style="width:80px;display:none;">
  `;

  const select = container.querySelector('#plan-select');
  const customInput = container.querySelector('#custom-price');
  const emitChange = () => {
    const plan = select.value;
    const customPrice = customInput.value ? parseFloat(customInput.value) : null;
    onChange({ plan, customPrice });
  };
  select.addEventListener('change', emitChange);
  customInput.addEventListener('input', emitChange);
  select.addEventListener('dblclick', () => {
    customInput.style.display = customInput.style.display === 'none' ? 'inline-block' : 'none';
  });

  return { getPlan: () => ({ plan: select.value, customPrice: customInput.value ? parseFloat(customInput.value) : null }) };
}
