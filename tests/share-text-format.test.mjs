import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/js/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function shareTextForResult(data) {');
const end = source.indexOf('\n}\n\nfunction renderHomeShare', start);
assert.notEqual(start, -1, '結果共有関数が見つかる');
assert.notEqual(end, -1, '結果共有関数の終端が見つかる');

const functionSource = source.slice(start, end + 2);
const bodyStart = functionSource.indexOf('{') + 1;
const body = functionSource.slice(bodyStart, functionSource.lastIndexOf('}'));
const makeShareText = new Function('playerName', `return function shareTextForResult(data) {\${body}};`) ;

test('結果共有文を指定された改行形式で作る', () => {
  const shareTextForResult = makeShareText('カメレオンJP');
  const actual = shareTextForResult({
    score: 5491,
    rank: 'D+',
    maxCombo: 10,
    perfectRate: 93,
    tier: 5,
  });

  assert.equal(actual, [
    'カメレオンJPさんのパリパリ結果',
    '5,491点',
    'ランクD+',
    '最大連続成功10',
    '成功のうち、ぴったりの割合93%',
    '到達した難しさ5',
    '',
    'パリパリ：来た方向と反対を、タイミングよく選べ！',
    'https://chameleonjp-lab.github.io/paripari/',
  ].join('\n'));
});
