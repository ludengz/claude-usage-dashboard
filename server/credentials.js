import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function readFromKeychain() {
  if (process.platform !== 'darwin') return null;
  try {
    const raw = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const data = JSON.parse(raw);
    return data.claudeAiOauth || null;
  } catch {
    return null;
  }
}

function readFromWindowsCredentialManager() {
  if (process.platform !== 'win32') return null;
  try {
    // Use PowerShell with Win32 CredRead API to read from Windows Credential Manager.
    // Encode as UTF-16LE base64 for -EncodedCommand to avoid all shell escaping issues.
    const psScript = [
      'Add-Type -TypeDefinition @"',
      'using System; using System.Runtime.InteropServices;',
      'public class CredManager {',
      '  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]',
      '  public static extern bool CredRead(string target, int type, int flags, out IntPtr credential);',
      '  [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr cred);',
      '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]',
      '  public struct CREDENTIAL {',
      '    public int Flags; public int Type; public string TargetName; public string Comment;',
      '    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;',
      '    public int Persist; public int AttributeCount; public IntPtr Attributes;',
      '    public string TargetAlias; public string UserName;',
      '  }',
      '}',
      '"@',
      '$ptr = [IntPtr]::Zero',
      `if ([CredManager]::CredRead('${KEYCHAIN_SERVICE}', 1, 0, [ref]$ptr)) {`,
      '  $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][CredManager+CREDENTIAL])',
      '  $b = New-Object byte[] $c.CredentialBlobSize',
      '  [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $b, 0, $c.CredentialBlobSize)',
      '  [CredManager]::CredFree($ptr) | Out-Null',
      '  [System.Text.Encoding]::UTF8.GetString($b)',
      '}',
    ].join('\n');
    const buf = Buffer.alloc(psScript.length * 2);
    for (let i = 0; i < psScript.length; i++) buf.writeUInt16LE(psScript.charCodeAt(i), i * 2);
    const raw = execSync(
      `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${buf.toString('base64')}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 }
    ).trim();
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.claudeAiOauth || null;
  } catch {
    return null;
  }
}

function readFromFile(credentialsPath) {
  try {
    const raw = fs.readFileSync(credentialsPath, 'utf-8');
    const data = JSON.parse(raw);
    return data.claudeAiOauth || null;
  } catch {
    return null;
  }
}

function readFromSecureStore() {
  if (process.platform === 'darwin') return readFromKeychain();
  if (process.platform === 'win32') return readFromWindowsCredentialManager();
  return null;
}

export function readCredentials(credentialsPath) {
  if (credentialsPath) {
    // Explicit path provided (e.g. tests) — skip secure store
    return readFromFile(credentialsPath);
  }
  // Try platform secure store first, then fall back to default file
  return readFromSecureStore() || readFromFile(CREDENTIALS_PATH);
}

export function getSubscriptionInfo(credentialsPath) {
  const creds = readCredentials(credentialsPath);
  if (!creds) return null;

  const { subscriptionType, rateLimitTier } = creds;
  const combined = `${subscriptionType || ''} ${rateLimitTier || ''}`.toLowerCase();

  let plan = null;
  if (combined.includes('20x')) plan = 'max20x';
  else if (combined.includes('5x')) plan = 'max5x';
  else if (combined.includes('pro')) plan = 'pro';

  return { subscriptionType: subscriptionType || null, rateLimitTier: rateLimitTier || null, plan };
}

export function getAccessToken(credentialsPath) {
  const creds = readCredentials(credentialsPath);
  if (!creds || !creds.accessToken) return null;
  if (creds.expiresAt && creds.expiresAt < Date.now()) return null;
  return creds.accessToken;
}
