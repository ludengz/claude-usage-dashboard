import { describe, it, before, after } from 'mocha';
import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseLogDirectory, parseLogFile, deriveProjectName, parseMultiMachineDirectory, dedupByMessageId } from '../server/parser.js';

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

describe('parseLogDirectory - subagent support', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-subagent-test-'));
    const projectDir = path.join(tmpDir, '-Users-test-Workspace-myproject');
    fs.mkdirSync(projectDir);

    // Main session JSONL
    const sessionId = 'abc12345-6789-0def-abcd-ef0123456789';
    fs.writeFileSync(path.join(projectDir, `${sessionId}.jsonl`), JSON.stringify({
      type: 'assistant',
      sessionId,
      timestamp: '2026-04-01T23:00:00.000Z',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 3000, output_tokens: 24000, cache_creation_input_tokens: 200000, cache_read_input_tokens: 5000000 }
      }
    }));

    // Subagent transcript directory
    const subagentsDir = path.join(projectDir, sessionId, 'subagents');
    fs.mkdirSync(subagentsDir, { recursive: true });

    // Subagent 1
    fs.writeFileSync(path.join(subagentsDir, 'agent-a111.jsonl'), [
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sub-agent-session-1',
        timestamp: '2026-04-01T23:05:00.000Z',
        message: {
          model: 'claude-opus-4-6',
          usage: { input_tokens: 500, output_tokens: 10000, cache_creation_input_tokens: 50000, cache_read_input_tokens: 300000 }
        }
      }),
      JSON.stringify({
        type: 'assistant',
        sessionId: 'sub-agent-session-1',
        timestamp: '2026-04-01T23:06:00.000Z',
        message: {
          model: 'claude-opus-4-6',
          usage: { input_tokens: 600, output_tokens: 12000, cache_creation_input_tokens: 60000, cache_read_input_tokens: 400000 }
        }
      })
    ].join('\n'));

    // Subagent 2
    fs.writeFileSync(path.join(subagentsDir, 'agent-b222.jsonl'), JSON.stringify({
      type: 'assistant',
      sessionId: 'sub-agent-session-2',
      timestamp: '2026-04-01T23:10:00.000Z',
      message: {
        model: 'claude-opus-4-6',
        usage: { input_tokens: 400, output_tokens: 8000, cache_creation_input_tokens: 40000, cache_read_input_tokens: 200000 }
      }
    }));

    // Non-JSONL file (should be ignored)
    fs.writeFileSync(path.join(subagentsDir, 'agent-a111.meta.json'), '{"some":"meta"}');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('includes subagent token usage in session records', () => {
    const records = parseLogDirectory(tmpDir);
    // 1 main + 2 from agent-a111 + 1 from agent-b222 = 4
    expect(records).to.have.length(4);
  });

  it('groups subagent records under the parent session ID', () => {
    const records = parseLogDirectory(tmpDir);
    const sessionIds = [...new Set(records.map(r => r.sessionId))];
    expect(sessionIds).to.have.length(1);
    expect(sessionIds[0]).to.equal('abc12345-6789-0def-abcd-ef0123456789');
  });

  it('aggregates correct total tokens across main + subagents', () => {
    const records = parseLogDirectory(tmpDir);
    const totalInput = records.reduce((sum, r) => sum + r.input_tokens, 0);
    const totalOutput = records.reduce((sum, r) => sum + r.output_tokens, 0);
    const totalCacheCreation = records.reduce((sum, r) => sum + r.cache_creation_tokens, 0);
    const totalCacheRead = records.reduce((sum, r) => sum + r.cache_read_tokens, 0);
    expect(totalInput).to.equal(3000 + 500 + 600 + 400);
    expect(totalOutput).to.equal(24000 + 10000 + 12000 + 8000);
    expect(totalCacheCreation).to.equal(200000 + 50000 + 60000 + 40000);
    expect(totalCacheRead).to.equal(5000000 + 300000 + 400000 + 200000);
  });

  it('assigns correct project name to subagent records', () => {
    const records = parseLogDirectory(tmpDir);
    for (const record of records) {
      expect(record.project).to.equal('myproject');
    }
  });

  it('skips non-JSONL files in subagents directory', () => {
    const records = parseLogDirectory(tmpDir);
    // .meta.json should not produce any records
    expect(records).to.have.length(4);
  });
});

describe('parseMultiMachineDirectory', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-machine-test-'));

    // Machine A
    const machineA = path.join(tmpDir, 'macbook');
    const projA1 = path.join(machineA, '-Users-lu-Workspace-projA');
    fs.mkdirSync(projA1, { recursive: true });
    fs.writeFileSync(path.join(projA1, 'sess1.jsonl'), JSON.stringify({
      type: 'assistant', sessionId: 'a1', timestamp: '2026-03-10T10:00:00.000Z',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
    }));

    // Machine B — same project name via different path
    const machineB = path.join(tmpDir, 'work-pc');
    const projB1 = path.join(machineB, '-Users-john-Workspace-projA');
    fs.mkdirSync(projB1, { recursive: true });
    fs.writeFileSync(path.join(projB1, 'sess2.jsonl'), JSON.stringify({
      type: 'assistant', sessionId: 'b1', timestamp: '2026-03-11T10:00:00.000Z',
      message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 200, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }
    }));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('merges records from multiple machine directories', () => {
    const records = parseMultiMachineDirectory(tmpDir);
    expect(records).to.have.length(2);
    const sessionIds = records.map(r => r.sessionId).sort();
    expect(sessionIds).to.deep.equal(['a1', 'b1']);
  });

  it('derives the same project name from different machine paths', () => {
    const records = parseMultiMachineDirectory(tmpDir);
    const projects = [...new Set(records.map(r => r.project))];
    expect(projects).to.deep.equal(['projA']);
  });

  it('ignores non-directory entries', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'ignore me');
    const records = parseMultiMachineDirectory(tmpDir);
    expect(records).to.have.length(2);
    fs.unlinkSync(path.join(tmpDir, 'README.md'));
  });

  it('ignores symlinks', () => {
    const symlinkPath = path.join(tmpDir, 'bad-link');
    try {
      fs.symlinkSync('/tmp', symlinkPath);
      const records = parseMultiMachineDirectory(tmpDir);
      expect(records).to.have.length(2);
      fs.unlinkSync(symlinkPath);
    } catch {
      // Symlink creation may fail on some systems — skip test
    }
  });

  it('returns empty array for non-existent directory', () => {
    const records = parseMultiMachineDirectory('/nonexistent/path');
    expect(records).to.deep.equal([]);
  });
});

describe('dedupByMessageId', () => {
  it('collapses streaming snapshots to the row with largest output_tokens', () => {
    const records = [
      { messageId: 'msg_A', model: 'claude-opus-4-6', input_tokens: 100, output_tokens: 2,   cache_read_tokens: 5000, cache_creation_tokens: 0 },
      { messageId: 'msg_A', model: 'claude-opus-4-6', input_tokens: 100, output_tokens: 2,   cache_read_tokens: 5000, cache_creation_tokens: 0 },
      { messageId: 'msg_A', model: 'claude-opus-4-6', input_tokens: 100, output_tokens: 218, cache_read_tokens: 5000, cache_creation_tokens: 0 },
    ];
    const out = dedupByMessageId(records);
    expect(out).to.have.length(1);
    expect(out[0].output_tokens).to.equal(218);
  });

  it('collapses the same messageId seen across multiple machines', () => {
    const records = [
      { messageId: 'msg_X', model: 'claude-sonnet-4-6', input_tokens: 50, output_tokens: 500, cache_read_tokens: 1000, cache_creation_tokens: 0, project: 'p', sessionId: 's1' },
      { messageId: 'msg_X', model: 'claude-sonnet-4-6', input_tokens: 50, output_tokens: 500, cache_read_tokens: 1000, cache_creation_tokens: 0, project: 'p', sessionId: 's1' },
    ];
    const out = dedupByMessageId(records);
    expect(out).to.have.length(1);
    expect(out[0].output_tokens).to.equal(500);
  });

  it('passes through records that lack a messageId without deduping', () => {
    const records = [
      { messageId: null, model: 'claude-opus-4-6', input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0 },
      { messageId: null, model: 'claude-opus-4-6', input_tokens: 10, output_tokens: 20, cache_read_tokens: 0, cache_creation_tokens: 0 },
    ];
    const out = dedupByMessageId(records);
    expect(out).to.have.length(2);
  });

  it('keeps distinct messageIds as separate records', () => {
    const records = [
      { messageId: 'msg_1', model: 'claude-opus-4-6', input_tokens: 10, output_tokens: 100, cache_read_tokens: 0, cache_creation_tokens: 0 },
      { messageId: 'msg_2', model: 'claude-opus-4-6', input_tokens: 10, output_tokens: 200, cache_read_tokens: 0, cache_creation_tokens: 0 },
    ];
    const out = dedupByMessageId(records);
    expect(out).to.have.length(2);
  });
});

describe('parseLogDirectory - dedup integration', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parser-dedup-test-'));
    const projectDir = path.join(tmpDir, '-Users-test-Workspace-myproject');
    fs.mkdirSync(projectDir);
    // Same message.id written as three streaming snapshots
    fs.writeFileSync(path.join(projectDir, 'sess.jsonl'), [
      JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T10:00:00.000Z',
        message: { id: 'msg_stream', model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 2,    cache_creation_input_tokens: 0, cache_read_input_tokens: 5000 } } }),
      JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T10:00:01.000Z',
        message: { id: 'msg_stream', model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 50,   cache_creation_input_tokens: 0, cache_read_input_tokens: 5000 } } }),
      JSON.stringify({ type: 'assistant', sessionId: 's1', timestamp: '2026-03-10T10:00:02.000Z',
        message: { id: 'msg_stream', model: 'claude-opus-4-6',
          usage: { input_tokens: 100, output_tokens: 250,  cache_creation_input_tokens: 0, cache_read_input_tokens: 5000 } } }),
    ].join('\n'));
  });

  after(() => { fs.rmSync(tmpDir, { recursive: true }); });

  it('collapses streaming duplicates so each message counts once at its final cumulative usage', () => {
    const records = parseLogDirectory(tmpDir);
    expect(records).to.have.length(1);
    expect(records[0].output_tokens).to.equal(250);
    expect(records[0].input_tokens).to.equal(100);
  });
});
