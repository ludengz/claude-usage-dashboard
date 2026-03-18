import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseLogDirectory, parseLogFile, deriveProjectName } from '../server/parser.js';

describe('deriveProjectName', () => {
  it('extracts last segment from encoded directory name', () => {
    expect(deriveProjectName('-Users-ludengzhao-Workspace-passionfruit')).to.equal('passionfruit');
  });

  it('handles project names with hyphens', () => {
    expect(deriveProjectName('-Users-foo-Workspace-my-project')).to.equal('my-project');
  });

  it('handles worktree directory names', () => {
    expect(deriveProjectName('-Users-foo-Workspace-proj--claude-worktrees-branch')).to.equal('proj');
  });
});

describe('parseLogFile', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('extracts assistant records with usage data', () => {
    const logFile = path.join(tmpDir, 'test.jsonl');
    const lines = [
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: '2026-03-10T10:00:00.000Z',
        message: {
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 }
        }
      }),
      JSON.stringify({
        type: 'user',
        sessionId: 'sess-1',
        timestamp: '2026-03-10T10:01:00.000Z',
        message: { role: 'user', content: 'hello' }
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: '2026-03-10T10:02:00.000Z',
        message: {
          model: '<synthetic>',
          usage: { input_tokens: 10, output_tokens: 5 }
        }
      })
    ];
    fs.writeFileSync(logFile, lines.join('\n'));

    const records = parseLogFile(logFile);
    expect(records).to.have.length(1);
    expect(records[0].model).to.equal('claude-sonnet-4-6');
    expect(records[0].input_tokens).to.equal(100);
    expect(records[0].output_tokens).to.equal(50);
    expect(records[0].cache_creation_tokens).to.equal(20);
    expect(records[0].cache_read_tokens).to.equal(30);
    expect(records[0].sessionId).to.equal('sess-1');
  });

  it('skips malformed lines without crashing', () => {
    const logFile = path.join(tmpDir, 'bad.jsonl');
    fs.writeFileSync(logFile, 'not json\n{"type":"user"}\n');
    const records = parseLogFile(logFile);
    expect(records).to.have.length(0);
  });
});

describe('parseLogDirectory', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-dir-test-'));
    const projectDir = path.join(tmpDir, '-Users-test-Workspace-myproject');
    fs.mkdirSync(projectDir);
    const logFile = path.join(projectDir, 'session1.jsonl');
    fs.writeFileSync(logFile, JSON.stringify({
      type: 'assistant',
      sessionId: 'sess-1',
      timestamp: '2026-03-10T10:00:00.000Z',
      message: {
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }
    }));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('scans all project directories and returns records with project name', () => {
    const records = parseLogDirectory(tmpDir);
    expect(records).to.have.length(1);
    expect(records[0].project).to.equal('myproject');
  });
});
