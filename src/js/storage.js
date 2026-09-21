// localStorage ラッパ（ベストスコア・設定・表示名） 要件 §3.2 §4.6
// ルールが変わった版の点数は旧版と混ぜない。旧キーは削除せず残す。
export const RULE_VERSION = 'r1-5dir-20260922';
const KEY_BEST = `paripari.best.${RULE_VERSION}`;
const KEY_SETTINGS = 'paripari.settings';
const KEY_PLAYER_NAME = 'paripari.player-name';

const DEFAULT_SETTINGS = {
  vibrate: true,
  reducedMotion: false,
};

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* ignore */ }
}

export function normalizePlayerName(value) {
  // 制御文字を除き、前後の空白を取り、書記素単位で上限を適用する。
  // Intl.Segmenter がない環境ではコードポイント単位にフォールバックする。
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(cleaned), ({ segment }) => segment).slice(0, 20).join('');
    }
  } catch {
    // 古いブラウザや不正なIntl実装では下のフォールバックを使う。
  }
  return Array.from(cleaned).slice(0, 20).join('');
}

function parseBest(raw) {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'number') return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    if (parsed && parsed.version === RULE_VERSION && typeof parsed.score === 'number') {
      return Number.isFinite(parsed.score) ? Math.max(0, Math.floor(parsed.score)) : 0;
    }
  } catch {
    // 不正な保存値は無視し、起動を継続する。
  }
  return 0;
}

export function getBest() {
  return parseBest(safeGet(KEY_BEST));
}
export function setBest(n) {
  const score = Number(n);
  if (!Number.isFinite(score)) return getBest();
  const best = Math.max(getBest(), Math.floor(score), 0);
  safeSet(KEY_BEST, JSON.stringify({ version: RULE_VERSION, score: best }));
  return best;
}

export function getPlayerName() {
  return normalizePlayerName(safeGet(KEY_PLAYER_NAME));
}

export function setPlayerName(value) {
  const name = normalizePlayerName(value);
  safeSet(KEY_PLAYER_NAME, name);
  return name;
}

export function getSettings() {
  try {
    const raw = safeGet(KEY_SETTINGS);
    if (!raw) {
      const prefersReduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      return { ...DEFAULT_SETTINGS, reducedMotion: !!prefersReduced };
    }
    const parsed = JSON.parse(raw);
    return {
      vibrate: typeof parsed?.vibrate === 'boolean' ? parsed.vibrate : DEFAULT_SETTINGS.vibrate,
      reducedMotion: typeof parsed?.reducedMotion === 'boolean'
        ? parsed.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function setSettings(s) {
  safeSet(KEY_SETTINGS, JSON.stringify(s));
}
