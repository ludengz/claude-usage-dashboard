import { describe, it, beforeEach, afterEach } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { sanitizeMachineName, syncLocalToShared } from '../server/sync.js';

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

describe('syncLocalToShared', () => {
  let localDir, syncDir;

  beforeEach(() => {
    localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-local-'));
    syncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-shared-'));
  });

  afterEach(() => {
    fs.rmSync(localDir, { recursive: true });
    fs.rmSync(syncDir, { recursive: true });
  });

  it('copies new JSONL files to sync-dir/machine-name/', async () => {
    const projDir = path.join(localDir, '-Users-test-Workspace-projA');
    fs.mkdirSync(projDir);
    fs.writeFileSync(path.join(projDir, 'sess1.jsonl'), '{"line":1}\n');

    const { syncedFiles } = await syncLocalToShared(localDir, syncDir, 'my-mac');

    expect(syncedFiles).to.equal(1);
    const copied = fs.readFileSync(
      path.join(syncDir, 'my-mac', '-Users-test-Workspace-projA', 'sess1.jsonl'), 'utf-8'
    );
    expect(copied).to.equal('{"line":1}\n');
  });

  it('skips files when shared size >= local size', async () => {
    const projDir = path.join(localDir, '-Users-test-Workspace-projA');
    fs.mkdirSync(projDir);
    fs.writeFileSync(path.join(projDir, 'sess1.jsonl'), 'small');

    const sharedProj = path.join(syncDir, 'my-mac', '-Users-test-Workspace-projA');
    fs.mkdirSync(sharedProj, { recursive: true });
    fs.writeFileSync(path.join(sharedProj, 'sess1.jsonl'), 'larger-content-here');

    const { syncedFiles } = await syncLocalToShared(localDir, syncDir, 'my-mac');
    expect(syncedFiles).to.equal(0);
  });

  it('copies files when local size > shared size', async () => {
    const projDir = path.join(localDir, '-Users-test-Workspace-projA');
    fs.mkdirSync(projDir);
    fs.writeFileSync(path.join(projDir, 'sess1.jsonl'), 'updated-longer-content');

    const sharedProj = path.join(syncDir, 'my-mac', '-Users-test-Workspace-projA');
    fs.mkdirSync(sharedProj, { recursive: true });
    fs.writeFileSync(path.join(sharedProj, 'sess1.jsonl'), 'short');

    const { syncedFiles } = await syncLocalToShared(localDir, syncDir, 'my-mac');
    expect(syncedFiles).to.equal(1);
  });

  it('handles empty local directory gracefully', async () => {
    const { syncedFiles } = await syncLocalToShared(localDir, syncDir, 'my-mac');
    expect(syncedFiles).to.equal(0);
  });

  it('creates sync-dir if it does not exist', async () => {
    const newSyncDir = path.join(syncDir, 'nested', 'new-dir');
    const projDir = path.join(localDir, '-Users-test-Workspace-proj');
    fs.mkdirSync(projDir);
    fs.writeFileSync(path.join(projDir, 'sess.jsonl'), 'data');

    await syncLocalToShared(localDir, newSyncDir, 'mac');
    expect(fs.existsSync(path.join(newSyncDir, 'mac', '-Users-test-Workspace-proj', 'sess.jsonl'))).to.be.true;
  });

  it('handles unwritable sync-dir gracefully without throwing', async () => {
    const readonlyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-readonly-'));
    const projDir = path.join(localDir, '-Users-test-Workspace-proj');
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, 'sess.jsonl'), 'data');

    fs.chmodSync(readonlyDir, 0o444);

    const { syncedFiles } = await syncLocalToShared(localDir, readonlyDir, 'mac');
    expect(syncedFiles).to.equal(0);

    fs.chmodSync(readonlyDir, 0o755);
    fs.rmSync(readonlyDir, { recursive: true });
  });

  it('skips non-jsonl files', async () => {
    const projDir = path.join(localDir, '-Users-test-Workspace-proj');
    fs.mkdirSync(projDir);
    fs.writeFileSync(path.join(projDir, 'notes.txt'), 'not a log');
    fs.writeFileSync(path.join(projDir, 'sess.jsonl'), 'log data');

    const { syncedFiles } = await syncLocalToShared(localDir, syncDir, 'mac');
    expect(syncedFiles).to.equal(1);
    expect(fs.existsSync(path.join(syncDir, 'mac', '-Users-test-Workspace-proj', 'notes.txt'))).to.be.false;
  });
});
