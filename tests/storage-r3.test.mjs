import test from 'node:test';
import assert from 'node:assert/strict';

let importId = 0;
async function freshStorage() {
  const url = new URL('../src/js/storage.js', import.meta.url);
  return import(`${url.href}?storage-r3-test=${++importId}`);
}

function installStorage(t, entries = {}) {
  const values = new Map(Object.entries(entries));
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let failReads = false;
  let failWrites = false;
  const local = {
    getItem(key) {
      if (failReads) throw new Error('storage read blocked');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (failWrites) throw new Error('storage write blocked');
      values.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  });
  return {
    values,
    local,
    failReads(value = true) { failReads = value; },
    failWrites(value = true) { failWrites = value; },
  };
}

test('R3 uses a fresh score namespace and leaves old scores and tutorial keys untouched', async (t) => {
  const oldScore = JSON.stringify({ version: 'r2-time-20260922', score: 8800 });
  const oldTutorial = 'true';
  const h = installStorage(t, {
    'paripari.best.r2-time-20260922': oldScore,
    'paripari.best': '99999',
    'paripari.tutorial-completed': oldTutorial,
  });
  const storage = await freshStorage();

  assert.equal(storage.RULE_VERSION, 'r3-practice-20260927');
  assert.equal(storage.getBest(), 0);
  assert.equal(storage.getTutorialCompleted(), false);
  assert.equal(storage.setBest(420), 420);
  assert.equal(storage.getBest(), 420);
  assert.equal(h.values.get('paripari.best.r2-time-20260922'), oldScore);
  assert.equal(h.values.get('paripari.best'), '99999');
  assert.equal(h.values.get('paripari.tutorial-completed'), oldTutorial);
  assert.deepEqual(JSON.parse(h.values.get('paripari.best.r3-practice-20260927')), {
    version: 'r3-practice-20260927',
    score: 420,
  });
});

test('corrupt saved values are safe, and a cached best survives corruption and removal', async (t) => {
  const h = installStorage(t, {
    'paripari.best.r3-practice-20260927': '{broken',
    'paripari.settings': '{broken',
    'paripari.tutorial.v1': 'yes',
  });
  const storage = await freshStorage();

  assert.equal(storage.getBest(), 0);
  assert.deepEqual(storage.getSettings(), { vibrate: true, reducedMotion: false });
  assert.equal(storage.getTutorialCompleted(), false);

  storage.setBest(1750);
  h.values.set('paripari.best.r3-practice-20260927', 'not-json');
  assert.equal(storage.getBest(), 1750);
  h.values.delete('paripari.best.r3-practice-20260927');
  assert.equal(storage.getBest(), 1750);
  assert.equal(storage.setBest(80), 1750);
  assert.equal(storage.getBest(), 1750);
});

test('tutorial completion accepts only explicit booleans and falls back to memory on exceptions', async (t) => {
  const h = installStorage(t);
  const storage = await freshStorage();

  assert.equal(storage.getTutorialCompleted(), false);
  h.values.set('paripari.tutorial.v1', 'false');
  assert.equal(storage.getTutorialCompleted(), false);
  h.values.set('paripari.tutorial.v1', '"true"');
  assert.equal(storage.getTutorialCompleted(), false);
  h.values.set('paripari.tutorial.v1', 'true');
  assert.equal(storage.getTutorialCompleted(), true);

  h.failReads();
  h.failWrites();
  assert.equal(storage.setTutorialCompleted(), true);
  assert.equal(storage.getTutorialCompleted(), true);
  assert.equal(h.values.get('paripari.tutorial.v1'), 'true');
});

test('best scores merge the cached and cross-tab persisted maxima before writing', async (t) => {
  const key = 'paripari.best.r3-practice-20260927';
  const oldKey = 'paripari.best.r2-time-20260922';
  const oldValue = JSON.stringify({ version: 'r2-time-20260922', score: 9000 });
  const h = installStorage(t, {
    [key]: JSON.stringify({ version: 'r3-practice-20260927', score: 1200 }),
    [oldKey]: oldValue,
  });
  const storage = await freshStorage();

  assert.equal(storage.getBest(), 1200);
  assert.equal(storage.setBest(300), 1200);
  h.values.set(key, JSON.stringify({ version: 'r3-practice-20260927', score: 2600 }));
  assert.equal(storage.setBest(1400), 2600);
  assert.equal(storage.getBest(), 2600);

  // A stale/corrupt value cannot lower this launch's cached maximum.
  h.values.set(key, 'corrupt');
  assert.equal(storage.getBest(), 2600);
  assert.equal(storage.setBest(100), 2600);
  assert.equal(JSON.parse(h.values.get(key)).score, 2600);
  assert.equal(h.values.get(oldKey), oldValue);
});

test('name clearing, validated settings, and read/write exception fallbacks keep the API usable', async (t) => {
  const h = installStorage(t, {
    'paripari.settings': JSON.stringify({ vibrate: 'yes', reducedMotion: 1 }),
    'paripari.player-name': '  Hana  ',
  });
  const storage = await freshStorage();

  assert.equal(storage.getPlayerName(), 'Hana');
  assert.deepEqual(storage.getSettings(), { vibrate: true, reducedMotion: false });
  storage.setSettings({ vibrate: false, reducedMotion: true, ignored: true });
  assert.deepEqual(JSON.parse(h.values.get('paripari.settings')), {
    vibrate: false,
    reducedMotion: true,
  });
  storage.setPlayerName('');
  assert.equal(storage.getPlayerName(), '');

  h.failReads();
  h.failWrites();
  assert.equal(storage.setBest(730), 730);
  assert.equal(storage.getBest(), 730);
  assert.equal(storage.setPlayerName('  Kiri  '), 'Kiri');
  assert.equal(storage.getPlayerName(), 'Kiri');
  storage.setSettings({ vibrate: 'false', reducedMotion: 1 });
  assert.deepEqual(storage.getSettings(), { vibrate: true, reducedMotion: false });
  storage.setPlayerName('');
  assert.equal(storage.getPlayerName(), '');
});

test('write-only failure cannot replace this launch\'s completed tutorial, name or settings with stale persisted values', async (t) => {
  const h = installStorage(t, {
    'paripari.tutorial.v1': 'false',
    'paripari.player-name': '古い名前',
    'paripari.settings': JSON.stringify({ vibrate: true, reducedMotion: false }),
  });
  h.failWrites();
  const storage = await freshStorage();
  storage.setTutorialCompleted();
  storage.setPlayerName('新しい名前');
  storage.setSettings({ vibrate: false, reducedMotion: true });
  assert.equal(storage.getTutorialCompleted(), true);
  assert.equal(storage.getPlayerName(), '新しい名前');
  assert.deepEqual(storage.getSettings(), { vibrate: false, reducedMotion: true });
  assert.equal(h.values.get('paripari.tutorial.v1'), 'false');
  storage.setPlayerName('');
  assert.equal(storage.getPlayerName(), '');
});
