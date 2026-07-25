const PLANS = {
  pro: { label: 'Pro', price: 20 },
  max5x: { label: 'Max 5x', price: 100 },
  max20x: { label: 'Max 20x', price: 200 },
};

export function initPlanSelector(container, onChange) {
  const saved = localStorage.getItem('selectedPlan') || 'max20x';
  const savedPrice = localStorage.getItem('customPrice') || '';
  let detectedPlan = null;

  container.innerHTML = `
    <select id="plan-select" title="Subscription plan — double-click to enter a custom price">
      ${Object.entries(PLANS).map(([key, p]) =>
        `<option value="${key}" ${key === saved ? 'selected' : ''}>${p.label} · $${p.price}/mo</option>`
      ).join('')}
    </select>
    <input type="number" id="custom-price" placeholder="Custom $" value="${savedPrice}" style="display:${savedPrice ? 'inline-block' : 'none'};">
  `;

  const select = container.querySelector('#plan-select');
  const customInput = container.querySelector('#custom-price');
  const emitChange = () => {
    const plan = select.value;
    const customPrice = customInput.value ? parseFloat(customInput.value) : null;
    localStorage.setItem('selectedPlan', plan);
    if (customPrice) localStorage.setItem('customPrice', customInput.value);
    else localStorage.removeItem('customPrice');
    onChange({ plan, customPrice });
  };
  select.addEventListener('change', emitChange);
  customInput.addEventListener('input', emitChange);
  select.addEventListener('dblclick', () => {
    customInput.style.display = customInput.style.display === 'none' ? 'inline-block' : 'none';
  });

  function setDetectedPlan(planKey) {
    if (!planKey || !PLANS[planKey]) return;
    detectedPlan = planKey;
    // Only auto-select if user hasn't manually chosen a plan
    if (!localStorage.getItem('selectedPlan')) {
      select.value = planKey;
      emitChange();
    }
    // Update option labels to show which is detected
    for (const opt of select.options) {
      const p = PLANS[opt.value];
      const suffix = opt.value === planKey ? ' ✓' : '';
      opt.textContent = `${p.label} · $${p.price}/mo${suffix}`;
    }
  }

  return {
    getPlan: () => ({ plan: select.value, customPrice: customInput.value ? parseFloat(customInput.value) : null }),
    setDetectedPlan,
  };
}
