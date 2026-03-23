import fs from 'fs/promises';
import path from 'path';

const ILLEGAL_CHARS = /[/\\:*?"<>|]/g;

export function sanitizeMachineName(name) {
  let clean = name.replace(ILLEGAL_CHARS, '-').trim().replace(/^\.+|\.+$/g, '').trim();
  return clean || 'unknown-host';
}
