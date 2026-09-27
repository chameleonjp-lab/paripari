import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKeyDirectionMap,
  directionForEvent,
  keyLabelForDirection,
  keyLabelForToken,
  keyTokenFromEvent,
  normalizeKeyBindings,
} from '../src/js/keyboard.js';

test('PC keyboard defaults keep arrow/WASD/QZEC aliases', () => {
  const map = buildKeyDirectionMap();
  assert.equal(directionForEvent({ code: 'ArrowLeft', key: 'ArrowLeft' }, map), 'L');
  assert.equal(directionForEvent({ code: 'KeyA', key: 'a' }, map), 'L');
  assert.equal(directionForEvent({ code: 'KeyQ', key: 'q' }, map), 'DL');
  assert.equal(directionForEvent({ code: 'KeyC', key: 'c' }, map), 'DR');
});

test('custom bindings replace one direction and leave unconfigured directions usable', () => {
  const bindings = normalizeKeyBindings({ L: 'code:Space' });
  const map = buildKeyDirectionMap(bindings);
  assert.equal(directionForEvent({ code: 'Space', key: ' ' }, map), 'L');
  assert.equal(directionForEvent({ code: 'ArrowRight', key: 'ArrowRight' }, map), 'R');
  assert.equal(directionForEvent({ code: 'KeyA', key: 'a' }, map), null,
    'the replaced direction no longer accepts its old alias');
});

test('key tokens and labels are stable for special and ordinary keys', () => {
  assert.equal(keyTokenFromEvent({ code: 'Numpad1', key: '1' }), 'code:Numpad1');
  assert.equal(keyLabelForToken('code:Numpad1'), 'Num 1');
  assert.equal(keyLabelForToken('code:Space'), 'Space');
  assert.equal(keyLabelForDirection('L', {}), '← / A');
  assert.equal(keyLabelForDirection('L', { L: 'code:KeyF' }), 'F');
  assert.equal(normalizeKeyBindings({ L: ' ', R: 3 }).L, null);
});
