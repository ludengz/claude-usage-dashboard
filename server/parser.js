import fs from 'fs';
import path from 'path';

export function deriveProjectName(dirName) {
  // Strip drive prefix like "C--" at the start
  const clean = dirName.replace(/^[A-Za-z]--/, '');

  // Known parent directory markers (case-insensitive search)
  // Match the last occurrence of common parent dirs to get the project folder name
  const lower = clean.toLowerCase();
  const markers = ['-workspace-', '-projects-', '-repos-', '-src-', '-home-', '-desktop-', '-documents-', '-downloads-'];
  let bestIdx = -1;
  let bestLen = 0;
  for (const m of markers) {
    const idx = lower.lastIndexOf(m);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestLen = m.length;
    }
  }
  if (bestIdx !== -1) {
    const result = clean.slice(bestIdx + bestLen);
    // Handle worktree subdirs: "project--claude-worktrees-branch-name" → "project"
    const wtIdx = result.indexOf('--claude-worktrees');
    return wtIdx !== -1 ? result.slice(0, wtIdx) : result;
  }

  // Fallback: strip Users-username prefix, return the rest
  const userMatch = clean.match(/^Users-[^-]+-(.+)$/);
  if (userMatch) {
    const rest = userMatch[1];
    const wtIdx = rest.indexOf('--claude-worktrees');
    return wtIdx !== -1 ? rest.slice(0, wtIdx) : rest;
  }

  return clean;
}

export function parseLogFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());
  const records = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== 'assistant') continue;

    const model = entry.message?.model;
    if (!model || model === '<synthetic>') continue;

    const usage = entry.message?.usage;
    if (!usage) continue;

    records.push({
      sessionId: entry.sessionId,
      timestamp: entry.timestamp,
      model,
      messageId: entry.message?.id || null,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_creation_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_tokens: usage.cache_read_input_tokens || 0,
    });
  }

  return records;
}

/**
 * Deduplicate assistant records by `messageId`.
 *
 * Claude Code JSONL contains one line per streaming snapshot, not one per
 * message. Multiple lines can share the same `message.id`, with the early
 * ones reporting partial cumulative `output_tokens` and the final one the
 * full total. Multi-machine sync further multiplies the same message across
 * machines. Anthropic bills the server-side message once, so we keep the
 * record whose `output_tokens` is largest (the final cumulative snapshot)
 * for each `messageId`. Records without a `messageId` pass through — they
 * predate the id field and are assumed to already be one-per-message.
 */
export function dedupByMessageId(records) {
  const best = new Map();
  const passthrough = [];

  for (const r of records) {
    if (!r.messageId) { passthrough.push(r); continue; }
    const prev = best.get(r.messageId);
    if (!prev || r.output_tokens > prev.output_tokens) {
      best.set(r.messageId, r);
    }
  }

  return [...best.values(), ...passthrough];
}

export function parseLogDirectory(baseDir) {
  const allRecords = [];

  let projectDirs;
  try {
    projectDirs = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory());
  } catch {
    return allRecords;
  }

  for (const dir of projectDirs) {
    const projectName = deriveProjectName(dir.name);
    const projectPath = path.join(baseDir, dir.name);

    let files;
    try {
      files = fs.readdirSync(projectPath)
        .filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(projectPath, file);
      const records = parseLogFile(filePath);
      for (const record of records) {
        record.project = projectName;
        record.projectDirName = dir.name;
      }
      allRecords.push(...records);

      // Also parse subagent transcript files for this session
      const sessionDirName = file.replace(/\.jsonl$/, '');
      const subagentsPath = path.join(projectPath, sessionDirName, 'subagents');
      let subagentFiles;
      try {
        subagentFiles = fs.readdirSync(subagentsPath)
          .filter(f => f.endsWith('.jsonl'));
      } catch {
        continue;
      }

      for (const subFile of subagentFiles) {
        const subFilePath = path.join(subagentsPath, subFile);
        const subRecords = parseLogFile(subFilePath);
        for (const record of subRecords) {
          record.project = projectName;
          record.projectDirName = dir.name;
          record.sessionId = sessionDirName; // Group with parent session
        }
        allRecords.push(...subRecords);
      }
    }
  }

  return dedupByMessageId(allRecords);
}

export function parseMultiMachineDirectory(syncDir) {
  const allRecords = [];

  let machineDirs;
  try {
    machineDirs = fs.readdirSync(syncDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.isSymbolicLink());
  } catch {
    return allRecords;
  }

  for (const machineDir of machineDirs) {
    const machinePath = path.join(syncDir, machineDir.name);
    const records = parseLogDirectory(machinePath);
    allRecords.push(...records);
  }

  return dedupByMessageId(allRecords);
}
