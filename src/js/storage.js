// localStorage wrapper (best score, settings, player name, tutorial completion).
// Keep old score keys intact; rule-versioned keys prevent scores from mixing.
export const RULE_VERSION = 'r3-practice-20260927';
const KEY_BEST = `paripari.best.${RULE_VERSION}`;
const KEY_SETTINGS = 'paripari.settings';
const KEY_PLAYER_NAME = 'paripari.player-name';
const KEY_TUTORIAL_COMPLETED = 'paripari.tutorial.v1';

const DEFAULT_SETTINGS = Object.freeze({
  vibrate: true,
  reducedMotion: false,
});

// Caches belong to this application launch, including failed writes.
let cachedBest = 0;
let cachedPlayerName = null;
let cachedSettings = null;
let cachedTutorialCompleted = null;
let nameWriteFailed = false;
let settingsWriteFailed = false;

function safeGet(key) {
  try {
    return { ok: true, value: globalThis.localStorage.getItem(key) };
  } catch {
    return { ok: false, value: null };
  }
}

function safeSet(key, value) {
  try {
    globalThis.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function normalizePlayerName(value) {
  // Remove control characters, trim whitespace, and cap by grapheme where available.
  const cleaned = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim();
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(cleaned), ({ segment }) => segment).slice(0, 20).join('');
    }
  } catch {
    // Fall back for older browsers or an incomplete Intl implementation.
  }
  return Array.from(cleaned).slice(0, 20).join('');
}

function parseBest(raw) {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'number' && Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
    if (parsed && parsed.version === RULE_VERSION &&
        typeof parsed.score === 'number' && Number.isFinite(parsed.score)) {
      return Math.max(0, Math.floor(parsed.score));
    }
  } catch {
    // Corrupt values do not interrupt the game; the in-memory maximum survives.
  }
  return null;
}

export function getBest() {
  const read = safeGet(KEY_BEST);
  if (!read.ok) return cachedBest;
  const persisted = parseBest(read.value);
  if (persisted !== null) cachedBest = Math.max(cachedBest, persisted);
  return cachedBest;
}

export function setBest(n) {
  const score = Number(n);
  if (!Number.isFinite(score)) return getBest();

  // Read immediately before writing so a stale tab cannot replace a persisted
  // higher score. The cache also protects a high score if storage is unavailable.
  const read = safeGet(KEY_BEST);
  const persisted = read.ok ? parseBest(read.value) : null;
  const best = Math.max(cachedBest, persisted ?? 0, Math.floor(score), 0);
  cachedBest = best;
  safeSet(KEY_BEST, JSON.stringify({ version: RULE_VERSION, score: best }));
  return best;
}

export function getPlayerName() {
  if (nameWriteFailed) return cachedPlayerName ?? '';
  const read = safeGet(KEY_PLAYER_NAME);
  if (!read.ok || read.value === null) return cachedPlayerName ?? '';
  cachedPlayerName = normalizePlayerName(read.value);
  return cachedPlayerName;
}

export function setPlayerName(value) {
  const name = normalizePlayerName(value);
  cachedPlayerName = name;
  nameWriteFailed = !safeSet(KEY_PLAYER_NAME, name);
  return name;
}

function copySettings(settings) {
  return { vibrate: settings.vibrate, reducedMotion: settings.reducedMotion };
}

function normalizeSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    vibrate: typeof source.vibrate === 'boolean' ? source.vibrate : DEFAULT_SETTINGS.vibrate,
    reducedMotion: typeof source.reducedMotion === 'boolean'
      ? source.reducedMotion : DEFAULT_SETTINGS.reducedMotion,
  };
}

function preferredDefaults() {
  let reducedMotion = DEFAULT_SETTINGS.reducedMotion;
  try {
    reducedMotion = !!globalThis.window?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    // Use the static default when matchMedia is unavailable or throws.
  }
  return { ...DEFAULT_SETTINGS, reducedMotion };
}

export function getSettings() {
  if (settingsWriteFailed) return copySettings(cachedSettings);
  const read = safeGet(KEY_SETTINGS);
  if (!read.ok) return copySettings(cachedSettings ?? preferredDefaults());
  if (read.value === null) {
    if (cachedSettings) return copySettings(cachedSettings);
    return preferredDefaults();
  }

  try {
    cachedSettings = normalizeSettings(JSON.parse(read.value));
    return copySettings(cachedSettings);
  } catch {
    return copySettings(cachedSettings ?? DEFAULT_SETTINGS);
  }
}

export function setSettings(settings) {
  cachedSettings = normalizeSettings(settings);
  settingsWriteFailed = !safeSet(KEY_SETTINGS, JSON.stringify(cachedSettings));
}

export function getTutorialCompleted() {
  if (cachedTutorialCompleted === true) return true;
  const read = safeGet(KEY_TUTORIAL_COMPLETED);
  if (!read.ok || read.value === null) return cachedTutorialCompleted ?? false;
  if (read.value === 'true') {
    cachedTutorialCompleted = true;
    return true;
  }
  if (read.value === 'false') {
    cachedTutorialCompleted = false;
    return false;
  }
  return false;
}

export function setTutorialCompleted() {
  cachedTutorialCompleted = true;
  safeSet(KEY_TUTORIAL_COMPLETED, 'true');
  return true;
}
