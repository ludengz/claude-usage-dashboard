import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

const directory = path.resolve(process.argv[2] || 'release-package');
const [pack] = JSON.parse(await readFile(path.join(directory, 'pack.json'), 'utf8'));
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(pack.name, manifest.name);
assert.equal(pack.version, manifest.version);
assert.match(pack.version, /^\d+\.\d+\.\d+$/);
assert.equal(process.env.GITHUB_REF_NAME, `v${pack.version}`);
assert.equal(path.basename(pack.filename), pack.filename);
const tarball = path.join(directory, pack.filename);
const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
assert.equal(integrity(await readFile(tarball)), pack.integrity);

const registry = 'https://registry.npmjs.org';
const packageUrl = `${registry}/${encodeURIComponent(pack.name)}`;
async function readRegistry(url) {
  const response = await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  assert.equal(response.status, 200, `Registry returned ${response.status}`);
  return response.json();
}

const existing = await readRegistry(`${packageUrl}/${pack.version}`);
if (existing) {
  assert.equal(existing.dist.integrity, pack.integrity, 'Existing version differs from the verified tarball');
  console.log(`${pack.name}@${pack.version} already exists with matching integrity; verifying registry state`);
} else {
  const result = spawnSync('npm', ['publish', tarball, '--access', 'public', '--tag', 'latest', '--provenance', '--registry', registry], { stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'npm publish failed');
}

// npm accepts asynchronous publishes with HTTP 202 before the version is readable.
let published = false;
for (let attempt = 0; attempt < 48; attempt++) {
  const metadata = await readRegistry(packageUrl);
  const version = metadata?.versions?.[pack.version];
  if (version && metadata['dist-tags']?.latest === pack.version) {
    assert.equal(version.dist.integrity, pack.integrity);
    assert.equal(version.dist.shasum, pack.shasum);
    assert.equal(new URL(version.dist.tarball).origin, registry);
    const response = await fetch(version.dist.tarball, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    assert.equal(integrity(Buffer.from(await response.arrayBuffer())), pack.integrity);
    const summary = `Published **${pack.name}@${pack.version}** with OIDC. Verified the latest tag and downloaded tarball SHA-512.\n`;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
    published = true;
    break;
  }
  console.log(`Waiting for ${pack.name}@${pack.version} to become available (${attempt + 1}/48)`);
  await setTimeout(10000);
}
assert.ok(published, 'Registry did not expose the expected version and latest tag within 8 minutes');
