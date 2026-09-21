import test from 'node:test';
import assert from 'node:assert/strict';
import * as storage from '../src/js/storage.js';
import { shareOrCopy, officialGameUrl } from '../src/js/platform.js';

const bestKey = `paripari.best.${storage.RULE_VERSION}`;
function savedValues(t, entries = {}) {
  const values = new Map(Object.entries(entries));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  t.after(() => original ? Object.defineProperty(globalThis, 'localStorage', original) : delete globalThis.localStorage);
  return values;
}

test('D01: 日本語・合成絵文字の20文字境界、空白・制御文字を扱う', () => {
  assert.equal(storage.normalizePlayerName(' \u0000 masa \n'), 'masa');
  assert.equal(storage.normalizePlayerName('  \t\n '), '');
  const emoji = '👨‍👩‍👧‍👦';
  assert.equal(storage.normalizePlayerName('あ'.repeat(19) + emoji + 'い'), 'あ'.repeat(19) + emoji);
  assert.equal(storage.normalizePlayerName('🇯🇵'.repeat(21)), '🇯🇵'.repeat(20));
});

test('D02/D03: 旧得点を混ぜず、旧キーと名前を残す', (t) => {
  const values = savedValues(t, { 'paripari.best': '999999', 'paripari.player-name': '以前の名前' });
  assert.equal(storage.getBest(), 0);
  assert.equal(storage.getPlayerName(), '以前の名前');
  storage.setBest(350);
  assert.equal(storage.getBest(), 350);
  assert.equal(values.get('paripari.best'), '999999');
  for (const bad of ['broken', '-1', 'null', 'true', '"900"', JSON.stringify({ version: storage.RULE_VERSION, score: '900' })]) {
    values.set(bestKey, bad);
    assert.equal(storage.getBest(), 0, bad);
  }
});

test('D04: 後から低い点を保存しても同じ版の自己ベストが下がらない', (t) => {
  savedValues(t);
  storage.setBest(1000);
  storage.setBest(100);
  assert.equal(storage.getBest(), 1000);
});

test('D02: 保存の読み書きが例外でも名前・設定・得点処理が止まらない', (t) => {
  savedValues(t);
  t.mock.method(localStorage, 'getItem', () => { throw new Error('storage blocked'); });
  t.mock.method(localStorage, 'setItem', () => { throw new Error('storage blocked'); });
  assert.doesNotThrow(() => {
    storage.getPlayerName(); storage.setPlayerName('テスト');
    storage.getSettings(); storage.setSettings({ vibrate: false, reducedMotion: true });
    storage.getBest(); storage.setBest(350);
  });
});

function navigatorFor(t, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'navigator', descriptor) : delete globalThis.navigator);
}

test('H01/H03: URL未確定時に開発URLを共有せず、キャンセルでコピーしない', async (t) => {
  let shared;
  navigatorFor(t, {
    share: async (data) => { shared = data; throw Object.assign(new Error('cancel'), { name: 'AbortError' }); },
    clipboard: { writeText: async () => assert.fail('キャンセル後のコピーは禁止') },
  });
  const status = { textContent: '' };
  assert.equal(officialGameUrl(), null);
  const outcome = await shareOrCopy({ text: 'パリパリ', title: 'パリパリ', statusElement: status });
  assert.equal(outcome, 'cancelled');
  assert.equal(shared.text, 'パリパリ');
  assert.equal('url' in shared, false);
  assert.equal(status.textContent, '');
});

test('H02: 共有がないとコピー、コピー不可なら呼び出し元の欄を選択する', async (t) => {
  let copied = '';
  navigatorFor(t, { clipboard: { writeText: async (text) => { copied = text; } } });
  assert.equal(await shareOrCopy({ text: '結果350点' }), 'copied');
  assert.equal(copied, '結果350点');
  navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  const selected = [];
  const field = { value: '', focus: () => selected.push('focus'), select: () => selected.push('select') };
  assert.equal(await shareOrCopy({ text: 'ホームの文', textElement: field }), 'selected');
  assert.equal(field.value, 'ホームの文');
  assert.deepEqual(selected, ['focus', 'select']);
});
