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
// Unlike getBest's legacy fallback, null means the stored best is unknown.
export function getBestState() {
  let raw;
  try { raw = localStorage.getItem(KEY_BEST); } catch { return { status: 'unavailable', best: null }; }
  if (raw === null) return { status: 'known', best: 0 };
  if (typeof raw !== 'string' || !/^\s*\d+\s*$/.test(raw)) return { status: 'invalid', best: null };
  const best = Number(raw);
  return Number.isSafeInteger(best) && best >= 0
    ? { status: 'known', best }
    : { status: 'invalid', best: null };
}
export function saveBest(n) {
  const before = getBestState();
  if (typeof n !== 'number' || !Number.isFinite(n)) return { ...before, status: 'invalid-score' };
  const score = Math.max(0, Math.floor(n));
  if (!Number.isSafeInteger(score)) return { ...before, status: 'invalid-score' };
  if (before.best === null) return before;
  if (score <= before.best) return { status: 'unchanged', best: before.best };
  try { localStorage.setItem(KEY_BEST, String(score)); }
  catch { return { status: 'write-failed', best: getBestState().best }; }
  const after = getBestState();
  return { status: after.best === score ? 'saved' : 'unconfirmed', best: after.best };
}
export function setBest(n) {
  saveBest(n);
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
