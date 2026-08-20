import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('manifest metadata and entry contract are valid', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../parti.room.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, manifest.version);
  assert.equal(manifest.id, 'grand-coven');
  assert.equal(manifest.protocolVersion, 1);
  assert.equal(manifest.entry.ui, 'index.html');
  assert.equal(manifest.entry.worker, 'room.worker.js');
  assert.equal(manifest.entry.style, 'style.css');
  assert.equal(manifest.entry.client, 'client.js');
  assert.equal(manifest.room.minPlayers, 3);
  assert.equal(manifest.room.maxPlayers, 5);
});

test('worker is a canonical single-file Parti worker', async () => {
  const worker = await readFile(new URL('../room.worker.js', import.meta.url), 'utf8');
  assert.match(worker, /import \{ defineRoom \} from '@parti\/worker-sdk';/);
  assert.match(worker, /export default defineRoom\(/);
  assert.doesNotMatch(worker, /from ['"]\.\//);
});

test('UI references declared local assets', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /\.\/client\.js/);
  assert.match(html, /\.\/style\.css/);
});
