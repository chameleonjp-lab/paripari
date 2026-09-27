// PC用キーバインドの正規化と表示。
// 保存値は KeyboardEvent.code を優先したトークンにする。キー配列や
// キーボード配列が変わっても、設定した物理キーを同じ方向へ使える。

export const KEYBOARD_DIRECTIONS = Object.freeze(['L', 'DL', 'D', 'DR', 'R']);
export const KEYBOARD_HELP_DIRECTIONS = Object.freeze(['L', 'R', 'D', 'DL', 'DR']);
export const KEYBOARD_DIRECTION_LABELS = Object.freeze({
  L: '左',
  R: '右',
  D: '下',
  DL: '左下',
  DR: '右下',
});

const DEFAULT_KEY_TOKENS = Object.freeze({
  L: Object.freeze(['code:ArrowLeft', 'code:KeyA', 'key:ArrowLeft', 'key:a', 'key:A']),
  R: Object.freeze(['code:ArrowRight', 'code:KeyD', 'key:ArrowRight', 'key:d', 'key:D']),
  D: Object.freeze(['code:ArrowDown', 'code:KeyS', 'key:ArrowDown', 'key:s', 'key:S']),
  DL: Object.freeze(['code:KeyQ', 'code:KeyZ', 'key:q', 'key:Q', 'key:z', 'key:Z']),
  DR: Object.freeze(['code:KeyE', 'code:KeyC', 'key:e', 'key:E', 'key:c', 'key:C']),
});

export const DEFAULT_KEY_LABELS = Object.freeze({
  L: '← / A',
  R: '→ / D',
  D: '↓ / S',
  DL: 'Q / Z',
  DR: 'E / C',
});

const DISPLAY_NAMES = Object.freeze({
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Esc',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ShiftLeft: '左Shift',
  ShiftRight: '右Shift',
  ControlLeft: '左Ctrl',
  ControlRight: '右Ctrl',
  AltLeft: '左Alt',
  AltRight: '右Alt',
});

export function normalizeKeyToken(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 80) return null;
  if (raw.startsWith('code:') || raw.startsWith('key:')) return raw;
  // 旧形式や手動編集された設定は code として安全に扱う。
  return `code:${raw}`;
}

export function normalizeKeyBindings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(KEYBOARD_DIRECTIONS.map((dir) => [dir, normalizeKeyToken(source[dir])]));
}

export function keyTokenFromEvent(event) {
  const code = String(event?.code || '');
  if (code && code !== 'Unidentified') return `code:${code}`;
  const key = String(event?.key || '');
  if (key && key !== 'Unidentified') return `key:${key}`;
  return null;
}

export function eventKeyTokens(event) {
  const tokens = [];
  const primary = keyTokenFromEvent(event);
  const key = String(event?.key || '');
  const code = String(event?.code || '');
  for (const token of [primary, code ? `code:${code}` : null, key ? `key:${key}` : null]) {
    if (token && token !== 'code:Unidentified' && token !== 'key:Unidentified'
      && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

export function buildKeyDirectionMap(bindings = {}) {
  const custom = normalizeKeyBindings(bindings);
  const map = new Map();

  // Custom bindings win over the built-in aliases when a physical key overlaps.
  for (const dir of KEYBOARD_DIRECTIONS) {
    if (custom[dir]) map.set(custom[dir], dir);
  }
  for (const dir of KEYBOARD_DIRECTIONS) {
    if (custom[dir]) continue;
    for (const token of DEFAULT_KEY_TOKENS[dir]) {
      if (!map.has(token)) map.set(token, dir);
    }
  }
  return map;
}

export function directionForEvent(event, keyMap) {
  for (const token of eventKeyTokens(event)) {
    const dir = keyMap?.get(token);
    if (dir) return dir;
  }
  return null;
}

export function keyLabelForToken(token) {
  const normalized = normalizeKeyToken(token);
  if (!normalized) return '';
  const value = normalized.replace(/^(code|key):/, '');
  if (DISPLAY_NAMES[value]) return DISPLAY_NAMES[value];
  if (value === ' ') return 'Space';
  if (/^Key[A-Z]$/.test(value)) return value.slice(3);
  if (/^Digit[0-9]$/.test(value)) return value.slice(5);
  if (/^Numpad/.test(value)) return `Num ${value.slice(6)}`;
  if (/^F[0-9]+$/.test(value)) return value;
  return value.length === 1 ? value.toUpperCase() : value;
}

export function keyLabelForDirection(dir, bindings = {}) {
  const custom = normalizeKeyBindings(bindings)[dir];
  return custom ? keyLabelForToken(custom) : (DEFAULT_KEY_LABELS[dir] || '未設定');
}

export function keyboardHelpText(bindings = {}) {
  return KEYBOARD_HELP_DIRECTIONS
    .map((dir) => `${KEYBOARD_DIRECTION_LABELS[dir]} ${keyLabelForDirection(dir, bindings)}`)
    .join('、');
}
