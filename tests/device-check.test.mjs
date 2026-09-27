import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  buildReport,
  isPassReady,
  recordFingerprint,
  recordKey,
} from '../src/js/device-check.js';

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
  for (const id of [
    'check-date', 'device', 'ios', 'safari', 'commit', 'viewport', 'game-form', 'overall', 'notes',
    'planned-path', 'public-source', 'official-url', 'preview-status', 'distribution-match',
  ]) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  for (const group of ['x01', 'x02', 'x03']) {
    assert.match(page, new RegExp(`data-group="${group}"`));
  }
  assert.match(page, /iPhone 17 Pro/);
  assert.match(page, /VoiceOver/);
  assert.match(page, /150%・200%/);
  assert.match(page, /id="x02-rotate"/);
  assert.match(page, /id="x02-no-hit"/);
  assert.doesNotMatch(page, /id="x03-hold"/);
  assert.match(page, /option value="合格" disabled/);
});

test('D04: 記録は端末内保存に限定し、得点や確認結果を外部送信しない', () => {
  assert.match(script, /localStorage/);
  assert.match(script, /paripari\.device-check\.r6\.records\.v2/);
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

const requiredChecks = [
  'x01-name', 'x01-practice', 'x01-normal', 'x01-taps', 'x01-result', 'x01-retry',
  'x02-portrait', 'x02-landscape', 'x02-rotate', 'x02-keyboard', 'x02-resume',
  'x02-no-hit', 'x02-text', 'x02-voiceover', 'x02-share',
  'x03-page', 'x03-source', 'x03-single', 'x03-license',
];

function readyRecord() {
  return {
    fields: {
      device: 'iPhone 17 Pro',
      ios: 'iOS 26',
      safari: 'Safari 26',
      commit: 'abc123',
      viewport: '402×874 CSS px',
      'game-form': '両方',
      'planned-path': '/paripari/',
      'public-source': 'GitHub Pages',
      'official-url': 'https://example.test/paripari/',
      'preview-status': '実機画面を確認済み',
      'distribution-match': '一致',
    },
    checks: Object.fromEntries(requiredChecks.map((id) => [id, true])),
  };
}

test('D07: 合格は必要チェック・端末情報・公開前点検が揃った記録だけで成立する', () => {
  const record = readyRecord();
  assert.equal(isPassReady(record, requiredChecks), true);
  record.checks['x02-no-hit'] = false;
  assert.equal(isPassReady(record, requiredChecks), false);
  record.checks['x02-no-hit'] = true;
  record.fields['official-url'] = '';
  assert.equal(isPassReady(record, requiredChecks), false);
  record.fields['official-url'] = 'https://example.test/paripari/';
  record.fields['distribution-match'] = '不一致';
  assert.equal(isPassReady(record, requiredChecks), false);
});

test('D08: 対象コミットごとに記録キーを分け、編集すると記録文の指紋が変わる', () => {
  assert.equal(recordKey(' ABC123 '), 'abc123');
  assert.equal(recordKey(''), '__unspecified__');
  const first = readyRecord();
  const firstFingerprint = recordFingerprint(first);
  first.checks['x01-result'] = false;
  assert.notEqual(recordFingerprint(first), firstFingerprint);
  assert.notEqual(recordKey('abc123'), recordKey('def456'));
});

test('D09: 記録文は編集後のチェックと公開前点検を反映する', () => {
  const record = readyRecord();
  const groups = [{
    id: 'x01',
    items: [{ id: 'x01-result', label: '結果画面を確認した' }],
  }];
  const before = buildReport(record, groups);
  assert.match(before, /X01: 1\/1/);
  assert.match(before, /\[x\] 結果画面を確認した/);
  record.checks['x01-result'] = false;
  record.fields['official-url'] = '';
  const after = buildReport(record, groups);
  assert.match(after, /X01: 0\/1/);
  assert.match(after, /\[ \] 結果画面を確認した/);
  assert.match(after, /正式URL: 未確認/);
});
