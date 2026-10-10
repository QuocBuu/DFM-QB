import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory()
    ? files(path.join(dir, e.name)) : path.join(dir, e.name)))).flat();
}
test('static payload stays below 96 KiB with no remote runtime assets', async () => {
  const all = await files(root);
  let bytes = 0;
  for (const file of all) {
    bytes += (await stat(file)).size;
    if (!/\.(html|js|css)$/.test(file)) continue;
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /(?:https?:)?\/\/[^\s'"<>]+\.(?:js|css|woff2?)(?:[?'"\s]|$)/);
  }
  assert.ok(bytes < 96 * 1024, `dist is ${bytes} bytes; budget is 96 KiB`);
});

test('HTML and module asset links resolve under a GitHub Pages project subpath', async () => {
  const base = new URL('https://example.github.io/drone-web/');
  const visited = new Set();
  async function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const source = await readFile(path.join(root, name), 'utf8');
    const links = name.endsWith('.html')
      ? [...source.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1])
      : name.endsWith('.js')
        ? [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map(m => m[1])
        : [];
    for (const link of links) {
      const resolved = new URL(link, new URL(name, base));
      assert.equal(resolved.origin, base.origin, `External dependency: ${link}`);
      assert.ok(resolved.pathname.startsWith(base.pathname), `Escapes project path: ${link}`);
      await visit(resolved.pathname.slice(base.pathname.length));
    }
  }
  await visit('index.html');
  assert.ok(visited.has('drone.js'));
  assert.ok(visited.has('serial.js'));
});
