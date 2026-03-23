import { describe, it } from 'mocha';
import { expect } from 'chai';
import { sanitizeMachineName } from '../server/sync.js';

describe('sanitizeMachineName', () => {
  it('passes through clean names unchanged', () => {
    expect(sanitizeMachineName('my-macbook')).to.equal('my-macbook');
  });

  it('replaces illegal filesystem characters with hyphens', () => {
    expect(sanitizeMachineName('my:machine/name')).to.equal('my-machine-name');
    expect(sanitizeMachineName('a\\b*c?d"e<f>g|h')).to.equal('a-b-c-d-e-f-g-h');
  });

  it('trims leading/trailing whitespace and dots', () => {
    expect(sanitizeMachineName('  .my-machine. ')).to.equal('my-machine');
  });

  it('preserves interior dots', () => {
    expect(sanitizeMachineName('my.machine.local')).to.equal('my.machine.local');
  });

  it('falls back to unknown-host for empty result', () => {
    expect(sanitizeMachineName('...')).to.equal('unknown-host');
    expect(sanitizeMachineName('')).to.equal('unknown-host');
    expect(sanitizeMachineName('   ')).to.equal('unknown-host');
  });
});
