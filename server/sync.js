import fs from 'fs/promises';
import path from 'path';

const ILLEGAL_CHARS = /[/\\:*?"<>|]/g;

export function sanitizeMachineName(name) {
  let clean = name.replace(ILLEGAL_CHARS, '-').trim().replace(/^\.+|\.+$/g, '').trim();
  return clean || 'unknown-host';
}

/**
 * Copy via a temp file + rename so readers on other machines never observe a
 * half-written file (fs.copyFile truncates the destination before writing).
 * Temp files don't end in .jsonl, so parsers skip them.
 */
async function atomicCopy(src, dest) {
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    await fs.copyFile(src, tmp);
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  }
}

export async function syncLocalToShared(localDir, syncDir, machineName) {
  const safeName = sanitizeMachineName(machineName);
  const machineDir = path.join(syncDir, safeName);
  let syncedFiles = 0;
  const startTime = Date.now();

  let projectDirs;
  try {
    const entries = await fs.readdir(localDir, { withFileTypes: true });
    projectDirs = entries.filter(d => d.isDirectory());
  } catch {
    return { syncedFiles, machineName: safeName };
  }

  for (const dir of projectDirs) {
    const localProjPath = path.join(localDir, dir.name);
    let files;
    try {
      files = (await fs.readdir(localProjPath)).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const localFile = path.join(localProjPath, file);
      const sharedFile = path.join(machineDir, dir.name, file);

      try {
        const localStat = await fs.stat(localFile);
        let needsSync = false;

        try {
          const sharedStat = await fs.stat(sharedFile);
          needsSync = localStat.size > sharedStat.size;
        } catch {
          needsSync = true;
        }

        if (needsSync) {
          await fs.mkdir(path.join(machineDir, dir.name), { recursive: true });
          await atomicCopy(localFile, sharedFile);
          syncedFiles++;
        }
      } catch (err) {
        console.warn(`Sync warning: failed to sync ${file}: ${err.message}`);
      }

      // Also sync subagent transcript files for this session
      const sessionDirName = file.replace(/\.jsonl$/, '');
      const localSubagentsPath = path.join(localProjPath, sessionDirName, 'subagents');
      let subagentFiles;
      try {
        subagentFiles = (await fs.readdir(localSubagentsPath)).filter(f => f.endsWith('.jsonl'));
      } catch {
        continue;
      }

      for (const subFile of subagentFiles) {
        const localSubFile = path.join(localSubagentsPath, subFile);
        const sharedSubFile = path.join(machineDir, dir.name, sessionDirName, 'subagents', subFile);

        try {
          const localStat = await fs.stat(localSubFile);
          let needsSync = false;

          try {
            const sharedStat = await fs.stat(sharedSubFile);
            needsSync = localStat.size > sharedStat.size;
          } catch {
            needsSync = true;
          }

          if (needsSync) {
            await fs.mkdir(path.join(machineDir, dir.name, sessionDirName, 'subagents'), { recursive: true });
            await atomicCopy(localSubFile, sharedSubFile);
            syncedFiles++;
          }
        } catch (err) {
          console.warn(`Sync warning: failed to sync subagent ${subFile}: ${err.message}`);
        }
      }
    }
  }

  const elapsed = Date.now() - startTime;
  if (syncedFiles > 0) {
    console.log(`Synced ${syncedFiles} files to ${machineDir}`);
  }
  if (elapsed > 30000) {
    console.warn(`Sync took ${Math.round(elapsed / 1000)}s — shared folder may be on a slow mount`);
  }

  return { syncedFiles, machineName: safeName };
}
