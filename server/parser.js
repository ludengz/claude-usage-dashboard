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

  // Fallback: strip Users-username prefix, return the rest.
  // macOS dir names start with "-" (paths start with "/"), e.g. "-Users-foo-proj".
  const userMatch = clean.match(/^-?Users-[^-]+-(.+)$/);
  if (userMatch) {
    const rest = userMatch[1];
    const wtIdx = rest.indexOf('--claude-worktrees');
    return wtIdx !== -1 ? rest.slice(0, wtIdx) : rest;
  }

  return clean;
}

function recordsFromLines(text) {
  const lines = text.split('\n').filter(line => line.trim());
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

export function parseLogFile(filePath) {
  return recordsFromLines(fs.readFileSync(filePath, 'utf-8'));
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

/**
 * Parse a log file, reusing a previous parse when the file is unchanged.
 * The cache key is the absolute path; a file is considered unchanged when
 * both mtime and size match. Sync-dir reads can sit on slow network/cloud
 * mounts (e.g. Google Drive), where re-reading hundreds of MB per refresh
 * dominates request latency — a stat is orders of magnitude cheaper.
 */
function readBytes(filePath, from, to) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(to - from);
    const read = fs.readSync(fd, buf, 0, to - from, from);
    return buf.toString('utf-8', 0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Cache layout: `records` covers exactly the first `parsedBytes` bytes of the
 * file, which always end at a newline. The tail past `parsedBytes` (a line
 * still being written, or a final line without a trailing newline) is parsed
 * fresh on every call and never cached — a mid-write fragment fails
 * JSON.parse today but must be picked up once its remaining bytes land.
 *
 * Session JSONL files are append-only (and sync copies preserve that), so a
 * grown file re-parses only the appended bytes — this is what keeps refreshes
 * cheap while an active session's log grows into hundreds of MB.
 */
function parseLogFileCached(filePath, fileCache) {
  if (!fileCache) return parseLogFile(filePath);

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return parseLogFile(filePath);
  }

  const prev = fileCache.get(filePath);
  try {
    if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) {
      if (prev.parsedBytes === prev.size) return prev.records;
      return prev.records.concat(recordsFromLines(readBytes(filePath, prev.parsedBytes, prev.size)));
    }

    if (prev && stat.size > prev.size) {
      const text = readBytes(filePath, prev.parsedBytes, stat.size);
      const lastNl = text.lastIndexOf('\n');
      const stable = text.slice(0, lastNl + 1);
      const entry = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        parsedBytes: prev.parsedBytes + Buffer.byteLength(stable, 'utf8'),
        records: stable ? prev.records.concat(recordsFromLines(stable)) : prev.records,
      };
      fileCache.set(filePath, entry);
      const rest = text.slice(lastNl + 1);
      return rest ? entry.records.concat(recordsFromLines(rest)) : entry.records;
    }
  } catch {
    // fall through to a full re-parse
  }

  // Full parse (new file, or shrunk/rewritten — not append-only growth)
  const content = fs.readFileSync(filePath, 'utf-8');
  const lastNl = content.lastIndexOf('\n');
  const stable = content.slice(0, lastNl + 1);
  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    parsedBytes: Buffer.byteLength(stable, 'utf8'),
    records: recordsFromLines(stable),
  };
  fileCache.set(filePath, entry);
  const rest = content.slice(lastNl + 1);
  return rest ? entry.records.concat(recordsFromLines(rest)) : entry.records;
}

export function parseLogDirectory(baseDir, fileCache = null) {
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
      const records = parseLogFileCached(filePath, fileCache);
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
        const subRecords = parseLogFileCached(subFilePath, fileCache);
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

export function parseMultiMachineDirectory(syncDir, fileCache = null) {
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
    const records = parseLogDirectory(machinePath, fileCache);
    allRecords.push(...records);
  }

  return dedupByMessageId(allRecords);
}
