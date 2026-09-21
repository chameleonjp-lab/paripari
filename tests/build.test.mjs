import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSingleHtml } from '../build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function fixture(t) {
  const dir = await mkdtemp(resolve(tmpdir(), 'paripari-build-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await cp(resolve(root, 'src'), resolve(dir, 'src'), { recursive: true });
  await cp(resolve(root, 'index.html'), resolve(dir, 'index.html'));
  return dir;
}

test('B01: 必要な依存ファイルが欠けた場合は生成を失敗させる', async (t) => {
  const dir = await fixture(t);
  await rm(resolve(dir, 'src/js/storage.js'));
  await assert.rejects(buildSingleHtml(dir), /Could not resolve.*storage\.js/s);
});

test('B01: 存在しない関数のimportを生成時に検出する', async (t) => {
  const dir = await fixture(t);
  const path = resolve(dir, 'src/js/main.js');
  const source = await readFile(path, 'utf8');
  await writeFile(path, `import { missingFunction } from './storage.js';\nmissingFunction();\n${source}`);
  await assert.rejects(buildSingleHtml(dir), /No matching export.*missingFunction/s);
});

test('B05: 再生成が一致し、同梱リストに手作業で追加しなくても依存を含む', async (t) => {
  const dir = await fixture(t);
  const path = resolve(dir, 'src/js/main.js');
  const source = await readFile(path, 'utf8');
  await writeFile(resolve(dir, 'src/js/new-dependency.js'), "export const marker = 'auto-included-r1';\n");
  await writeFile(path, `import { marker } from './new-dependency.js';\nconsole.info(marker);\n${source}`);
  const first = await buildSingleHtml(dir);
  const second = await buildSingleHtml(dir);
  assert.equal(first.html, second.html);
  assert.ok(first.dependencies.includes('src/js/new-dependency.js'));
  assert.match(first.html, /auto-included-r1/);
  assert.doesNotMatch(first.html, /<script[^>]*src=|<link rel="stylesheet"/);
});

test('B05: 起動タグの欠落を黙って成功にしない', async (t) => {
  const dir = await fixture(t);
  const path = resolve(dir, 'index.html');
  await writeFile(path, (await readFile(path, 'utf8')).replace('src/js/main.js', 'src/js/unknown.js'));
  await assert.rejects(buildSingleHtml(dir), /起動処理/);
});
