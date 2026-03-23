import fs from 'fs/promises';
import path from 'path';

const ILLEGAL_CHARS = /[/\\:*?"<>|]/g;

export function sanitizeMachineName(name) {
  let clean = name.replace(ILLEGAL_CHARS, '-').trim().replace(/^\.+|\.+$/g, '').trim();
  return clean || 'unknown-host';
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
          await fs.copyFile(localFile, sharedFile);
          syncedFiles++;
        }
      } catch (err) {
        console.warn(`Sync warning: failed to sync ${file}: ${err.message}`);
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
