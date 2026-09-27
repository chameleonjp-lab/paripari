import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const pagePath = resolve(root, 'device-check.html');
const scriptPath = resolve(root, 'src/js/device-check.js');
const [page, script] = await Promise.all([
  readFile(pagePath, 'utf8'),
  readFile(scriptPath, 'utf8'),
]);

test('D01: 実機確認ページはモバイル表示と相対リンクを持つ', () => {
  assert.match(page, /<meta[^>]+name="viewport"[^>]+viewport-fit=cover/);
  assert.match(page, /href="\.\/index\.html"/);
  assert.match(page, /href="\.\/dist\/paripari\.html"/);
  assert.match(page, /href="\.\/LICENSE"/);
  assert.match(page, /src="\.\/src\/js\/device-check\.js"/);
  assert.doesNotMatch(page, /(?:href|src|action)="https?:\/\//i);
});

test('D02: 実機確認ページは端末の大きい文字とタップ操作を妨げない', () => {
  assert.match(page, /font-size:\s*1rem/);
  assert.match(page, /min-height:\s*3rem/);
  assert.doesNotMatch(page, /touch-action:\s*none/);
  assert.match(page, /id="notes"[^>]*>/);
  assert.match(page, /id="report"[^>]*readonly/);
});

test('D03: X01/X02/X03の実機確認項目と端末記録欄が揃っている', () => {
  for (const id of ['check-date', 'device', 'ios', 'safari', 'commit', 'overall', 'notes']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  for (const group of ['x01', 'x02', 'x03']) {
    assert.match(page, new RegExp(`data-group="${group}"`));
  }
  assert.match(page, /iPhone 17 Pro/);
  assert.match(page, /VoiceOver/);
  assert.match(page, /150%・200%/);
});

test('D04: 記録は端末内保存に限定し、得点や確認結果を外部送信しない', () => {
  assert.match(script, /localStorage/);
  assert.match(script, /paripari\.device-check\.r6\.v1/);
  assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
  assert.match(page, /外部送信/);
});

test('D05: 実機確認ページのスクリプト構文が有効である', async () => {
  await execFileAsync(process.execPath, ['--check', scriptPath]);
});

test('D06: 記録文の生成とコピー操作がページに用意されている', () => {
  assert.match(script, /function makeReport\(\)/);
  assert.match(script, /navigator\.clipboard/);
  assert.match(script, /document\.execCommand\('copy'\)/);
  assert.match(page, /id="make-report"/);
  assert.match(page, /id="copy-report"/);
});
