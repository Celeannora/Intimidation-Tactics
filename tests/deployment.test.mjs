import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const staleRoots = ['.clinerules', 'sonar.md', 'implementation_plan.md',
  'CHANGELOG.md', 'CONTRIBUTING.md', 'main.py', 'docs'];
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `No symlink in payload: ${path}`);
    return entry.isDirectory() ? files(path) : [path];
  });
}

test('local agent workspace is ignored and no planning/history remains tracked', () => {
  const ignored = execFileSync('git', ['check-ignore', '--no-index', '--',
    '.hermes/plans/future.md', '.hermes/archive/example.txt'], { cwd: root, encoding: 'utf8' });
  assert.equal(ignored.trim().split(/\r?\n/).length, 2);
  for (const path of staleRoots) {
    assert.equal(existsSync(resolve(root, path)), false, `Archive ${path}`);
  }
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  assert.equal(tracked.some(path => path.startsWith('.hermes/')), false);
});

test('production payload contains only runtime assets and the license', () => {
  assert.ok(existsSync(dist), 'Run npm run build first');
  const required = ['index.html', 'manifest.webmanifest', 'sw.js', 'LICENSE',
    'icons/icon-192.png', 'icons/icon-512.png'];
  const names = files(dist).map(path => relative(dist, path).replaceAll('\\', '/'));
  for (const path of required) assert.ok(names.includes(path), `Missing ${path}`);
  for (const path of names) {
    assert.ok(required.includes(path) || /^assets\/[A-Za-z0-9_.-]+\.(js|css)$/.test(path),
      `Unexpected deployment file: ${path}`);
  }
  assert.ok(names.some(path => /^assets\/.+\.js$/.test(path)), 'Missing compiled JavaScript');
  assert.ok(names.some(path => /^assets\/.+\.css$/.test(path)), 'Missing compiled CSS');
  assert.deepEqual(readFileSync(resolve(dist, 'LICENSE')), readFileSync(resolve(root, 'LICENSE')));
  const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.webmanifest'), 'utf8'));
  for (const size of [192, 512]) {
    const entry = manifest.icons.find(icon => icon.sizes === `${size}x${size}`);
    assert.ok(entry, `Missing manifest entry ${size}`);
    assert.equal(entry.src, `/icons/icon-${size}.png`);
    const png = readFileSync(resolve(dist, entry.src.slice(1)));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = match[1];
    if (/^(?:https?:|data:)/.test(url)) continue;
    const target = resolve(dist, url.replace(/^\//, '').split(/[?#]/)[0]);
    assert.ok(target.startsWith(dist + '/') || target.startsWith(dist + '\\'));
    assert.ok(existsSync(target), `Broken entrypoint reference: ${url}`);
  }
});
