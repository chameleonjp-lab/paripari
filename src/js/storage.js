// localStorage ラッパ（ベストスコア・設定） 要件 §3.2 §4.6
const KEY_BEST = 'paripari.best';
const KEY_SETTINGS = 'paripari.settings';

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

export function getBest() {
  return parseInt(safeGet(KEY_BEST) || '0', 10) || 0;
}
export function setBest(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return;
  const score = Math.max(0, Math.floor(n));
  if (!Number.isSafeInteger(score)) return;
  let raw;
  try { raw = localStorage.getItem(KEY_BEST); } catch { return; }
  if (raw !== null) {
    // Preserve unreadable/unknown records rather than treating them as zero.
    if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) return;
    const persisted = Number(raw);
    if (!Number.isSafeInteger(persisted) || persisted < 0 || score <= persisted) return;
  }
  safeSet(KEY_BEST, String(score));
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
