import { expect } from 'chai';
import { MODEL_PRICING } from '../server/pricing.js';
import {
  normalizeModelId,
  modelColor,
  modelDisplayName,
  MODEL_COLORS,
  MODEL_DISPLAY,
  UNKNOWN_MODEL_COLOR,
} from '../public/js/model-meta.js';

describe('normalizeModelId', () => {
  it('strips a release-date suffix', () => {
    expect(normalizeModelId('claude-haiku-4-5-20251001')).to.equal('claude-haiku-4-5');
  });

  it('leaves plain model ids untouched', () => {
    expect(normalizeModelId('claude-opus-5')).to.equal('claude-opus-5');
  });

  it('does not mistake a single-digit version segment for a date', () => {
    expect(normalizeModelId('claude-opus-4-8')).to.equal('claude-opus-4-8');
  });

  it('passes through non-strings', () => {
    expect(normalizeModelId(null)).to.equal(null);
    expect(normalizeModelId(undefined)).to.equal(undefined);
  });
});

describe('modelColor', () => {
  it('resolves date-suffixed ids to the base model colour', () => {
    // Regression: this returned the grey fallback, so haiku rendered grey in the
    // donut while its legend label was correct.
    expect(modelColor('claude-haiku-4-5-20251001')).to.equal(MODEL_COLORS['claude-haiku-4-5']);
    expect(modelColor('claude-haiku-4-5-20251001')).to.not.equal(UNKNOWN_MODEL_COLOR);
  });

  it('returns the colour for a plain id', () => {
    expect(modelColor('claude-opus-4-8')).to.equal(MODEL_COLORS['claude-opus-4-8']);
  });

  it('falls back to grey for unknown models', () => {
    expect(modelColor('kling-video-v3_0')).to.equal(UNKNOWN_MODEL_COLOR);
  });

  it('assigns every model a distinct colour', () => {
    const colours = Object.values(MODEL_COLORS);
    expect(new Set(colours).size).to.equal(colours.length);
    expect(colours).to.not.include(UNKNOWN_MODEL_COLOR);
  });
});

describe('modelDisplayName', () => {
  it('resolves date-suffixed ids to the base display name', () => {
    expect(modelDisplayName('claude-haiku-4-5-20251001')).to.equal('haiku 4.5');
  });

  it('returns the mapped name for a plain id', () => {
    expect(modelDisplayName('claude-opus-4-8')).to.equal('opus 4.8');
  });

  it('derives a readable label for unmapped models', () => {
    expect(modelDisplayName('claude-future-9-1')).to.equal('future 9.1');
  });

  it('derives a readable label for unmapped date-suffixed models', () => {
    // Without normalisation the unanchored version regex matched first and left
    // the date attached: 'future 9.1-20260801'.
    expect(modelDisplayName('claude-future-9-1-20260801')).to.equal('future 9.1');
  });
});

describe('model metadata stays in sync with pricing', () => {
  it('gives every priced model a colour', () => {
    const missing = Object.keys(MODEL_PRICING).filter(id => !MODEL_COLORS[id]);
    expect(missing, `models priced but missing from MODEL_COLORS: ${missing.join(', ')}`)
      .to.deep.equal([]);
  });

  it('gives every priced model a display name', () => {
    const missing = Object.keys(MODEL_PRICING).filter(id => !MODEL_DISPLAY[id]);
    expect(missing, `models priced but missing from MODEL_DISPLAY: ${missing.join(', ')}`)
      .to.deep.equal([]);
  });

  it('prices every model it knows how to render', () => {
    const unpriced = Object.keys(MODEL_COLORS).filter(id => !MODEL_PRICING[id]);
    expect(unpriced, `models rendered but missing from MODEL_PRICING: ${unpriced.join(', ')}`)
      .to.deep.equal([]);
  });
});
