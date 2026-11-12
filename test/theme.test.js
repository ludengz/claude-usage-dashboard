import { expect } from 'chai';
import { C, MIX, MIX_LEGEND, DARK_FALLBACK, TOKEN_VARS, MIX_VARS, heatColor, invalidateThemeTokens } from '../public/js/theme.js';
import { cssBlock, contrast } from './helpers/theme-css.js';

const dark = cssBlock(':root');
const light = cssBlock(':root[data-theme="light"]');

describe('theme tokens', () => {
  it('keeps the JS fallback identical to the dark :root tokens', () => {
    for (const [name, value] of Object.entries(DARK_FALLBACK)) {
      expect(dark[name], name).to.equal(value);
    }
  });

  it('defines every chart token for the light theme', () => {
    const chartVars = [...Object.values(TOKEN_VARS), ...Object.values(MIX_VARS)];
    for (const name of [...chartVars, ...Object.keys(DARK_FALLBACK)]) {
      expect(light[name], name).to.match(/^#[0-9A-F]{6}$/);
    }
  });

  it('overrides every colour the dark theme defines', () => {
    const colourVars = Object.keys(dark).filter(name => /^(#|rgba?\()/.test(dark[name]));
    expect(colourVars.filter(name => !light[name])).to.deep.equal([]);
  });

  it('keeps light-theme body text readable (WCAG AA 4.5:1) against the panel', () => {
    for (const name of ['--text', '--text-2', '--text-3', '--text-dim']) {
      expect(contrast(light[name], light['--panel']), name).to.be.at.least(4.5);
    }
  });

  it('keeps light-theme accents and chart marks at 3:1 against the panel', () => {
    for (const name of ['--accent', '--ok', '--warn', '--danger', '--mix-in', '--mix-out', '--neutral', '--heat-3']) {
      expect(contrast(light[name], light['--panel']), name).to.be.at.least(3);
    }
  });

  it('resolves to the dark palette where there is no stylesheet', () => {
    invalidateThemeTokens();
    expect(C.text).to.equal(DARK_FALLBACK['--text']);
    expect(C.neutral).to.equal(DARK_FALLBACK['--neutral']);
    expect(MIX.output).to.equal(DARK_FALLBACK['--mix-out']);
    expect(MIX_LEGEND.map(m => m.color)).to.deep.equal([MIX.cacheRead, MIX.cacheWrite, MIX.input, MIX.output]);
    expect([0, 0.1, 0.5, 1].map(heatColor)).to.deep.equal(
      ['--heat-0', '--heat-1', '--heat-2', '--heat-3'].map(name => DARK_FALLBACK[name]),
    );
  });
});
