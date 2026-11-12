import { invalidateThemeTokens } from '../theme.js';

const STORAGE_KEY = 'theme';

const SUN = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/></svg>';
const MOON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1Z"/></svg>';

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Not persisted; the choice still holds for this page view.
  }
  invalidateThemeTokens();
}

/**
 * Wire the header button that flips between the dark default and the light
 * theme. The icon shows the theme a click switches to. `onChange` runs after
 * the switch so charts, which bake resolved colours into SVG, can redraw.
 */
export function initThemeToggle(button, onChange) {
  if (!button) return;
  const sync = () => {
    const light = currentTheme() === 'light';
    button.innerHTML = light ? MOON : SUN;
    button.title = light ? 'Switch to dark theme' : 'Switch to light theme';
    button.setAttribute('aria-pressed', String(light));
  };
  sync();
  button.addEventListener('click', () => {
    applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
    sync();
    onChange?.();
  });
}
