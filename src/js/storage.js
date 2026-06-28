// localStorage ラッパ（ベストスコア・設定） 要件 §3.2 §4.6
const KEY_BEST = 'paripari.best';
const KEY_SETTINGS = 'paripari.settings';

const DEFAULT_SETTINGS = {
  sound: true,
  vibrate: true,
  reducedMotion: false,
};

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* ignore */ }
}

export function getBest() {
  return parseInt(safeGet(KEY_BEST) || '0', 10) || 0;
}
export function setBest(n) {
  safeSet(KEY_BEST, String(Math.max(0, Math.floor(n))));
}

export function getSettings() {
  try {
    const raw = safeGet(KEY_SETTINGS);
    if (!raw) {
      const prefersReduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      return { ...DEFAULT_SETTINGS, reducedMotion: !!prefersReduced };
    }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function setSettings(s) {
  safeSet(KEY_SETTINGS, JSON.stringify(s));
}
