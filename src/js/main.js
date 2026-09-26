// エントリポイント: 起動・rAFループ・状態遷移の配線 要件 §4.1 §6.2
import { Renderer } from './renderer.js';
import { ParticlePool } from './particles.js';
import { Game } from './game.js';
import { setupInput, lockGestures } from './input.js';
import { GameClock } from './clock.js';
import { SessionController, SESSION_STATES } from './session.js';
import { setHapticsEnabled } from './haptics.js';
import * as ui from './ui.js';
import * as storage from './storage.js';
import { officialGameUrl, shareOrCopy } from './platform.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game-canvas');
const renderer = new Renderer(canvas);
const particles = new ParticlePool();
const clock = new GameClock();

let settings = storage.getSettings();
setHapticsEnabled(settings.vibrate);
renderer.reducedMotion = !!settings.reducedMotion;

let playerName = storage.getPlayerName();
let session = null;
let inputController = null;

const game = new Game({
  renderer, particles, settings,
  onGameOver: (data) => {
    // Game callbacks can arrive while a screen transition is invalidating a
    // match. SessionController checks the current state/round before showing
    // a result, so an old match cannot overwrite a new one.
    if (session) session.finish(data, data.roundId);
  },
});

// ---------- 入力 ----------
inputController = setupInput({
  canHandleAction: () => !!session && session.canHandleAction(),
  onAction: ({ dir, time }) => {
    if (!session || !session.canHandleAction()) return;
    const receivedWall = performance.now();
    const mapped = clock.mapInput(time, receivedWall);
    if (!mapped) return;
    const roundId = session.roundId;
    game.enqueueAction({ dir, ...mapped, roundId });
  },
});

session = new SessionController({
  game,
  clock,
  input: inputController,
  isVisible: () => !document.hidden,
  isPortrait: () => !(isHandheldDevice() && isLandscapeOrientation()),
  // This is an environment check, not the game-input check above. Countdown
  // and pause screens remain operable even though they reject attack input.
  isOperable: () => document.visibilityState !== 'hidden',
  onStateChange: (state, context) => {
    switch (state) {
      case SESSION_STATES.HOME:
        ui.hideBanner();
        ui.setPlayUIVisible(false);
        ui.setBestLabel(storage.getBest());
        playerName = storage.getPlayerName();
        $('player-name').value = playerName;
        $('name-error').textContent = '';
        renderHomeShare();
        ui.showScreen('title');
        break;
      case SESSION_STATES.HOWTO:
        ui.hideBanner();
        ui.setPlayUIVisible(false);
        ui.showScreen('howto');
        break;
      case SESSION_STATES.SETTINGS:
        ui.hideBanner();
        ui.setPlayUIVisible(false);
        ui.reflectSettings(settings);
        ui.showScreen('settings');
        break;
      case SESSION_STATES.COUNTDOWN:
      case SESSION_STATES.RESUME_COUNTDOWN:
        ui.hideBanner();
        ui.setPlayUIVisible(false);
        ui.showScreen('ready');
        break;
      case SESSION_STATES.PLAYING:
      case SESSION_STATES.PRACTICE:
        ui.hideAllScreens();
        ui.setPracticeVisible(state === SESSION_STATES.PRACTICE);
        ui.setPlayUIVisible(true);
        break;
      case SESSION_STATES.PRACTICE_COMPLETE:
        ui.hideBanner();
        ui.setPlayUIVisible(false);
        ui.showScreen('practice-complete');
        break;
      case SESSION_STATES.PAUSED:
        ui.setPlayUIVisible(false);
        $('btn-pause-retry').classList.toggle('hidden', context.mode === 'practice');
        ui.showScreen('pause');
        break;
      case SESSION_STATES.RESULT:
        ui.hideBanner();
        ui.setPlayUIVisible(false);
        ui.showResult(context.result);
        break;
      default:
        break;
    }
  },
  onCountdown: (n) => {
    if (n > 0) ui.setCountdown(n);
    else ui.setCountdown(0);
  },
  onResult: (data) => {
    ui.setBestLabel(data.best);
    renderResultShare(data);
  },
  onPracticeComplete: () => storage.setTutorialCompleted(),
});
lockGestures({
  targets: [canvas, $('controls')],
  isEnabled: () => !!session && session.canHandleAction(),
});

// ---------- 名前とシェア ----------
function shareTextForHome() {
  const url = officialGameUrl();
  return [
    'パリパリ：来た方向と反対を、ちょうどの瞬間に弾け。',
    url || '（正式な公開URLは準備中です）',
    '#パリパリ #ミニゲーム',
  ].join('\n');
}

function shareTextForResult(data) {
  const url = officialGameUrl();
  return [
    `${playerName || 'プレイヤー'}さんのパリパリ結果：${data.score.toLocaleString()}点、ランク${data.rank}！`,
    `最大連続成功${data.maxCombo}・成功のうち、ぴったりの割合${data.perfectRate}%・到達した難しさ${data.tier}`,
    url || '（正式な公開URLは準備中です）',
    '#パリパリ #ミニゲーム',
  ].join('\n');
}

function renderHomeShare() {
  const text = shareTextForHome();
  const el = $('home-share-text');
  if (el) el.value = text;
}

function renderResultShare(data) {
  const text = shareTextForResult(data);
  $('result-player').textContent = playerName ? `${playerName}さんの結果` : 'プレイヤーの結果';
  $('result-share-text').value = text;
  $('result-share-status').textContent = '';
}

function readPlayerName() {
  const input = $('player-name');
  const name = storage.normalizePlayerName(input.value);
  input.value = name;
  if (!name) {
    $('name-error').textContent = '名前を入力してから開始してください。';
    input.focus({ preventScroll: true });
    return false;
  }
  playerName = storage.setPlayerName(name);
  $('name-error').textContent = '';
  return true;
}

// ---------- 画面遷移ヘルパ ----------
function gotoTitle() {
  if (session) session.home(performance.now());
}

function beginNormalGame() {
  if (!readPlayerName()) return;
  $('player-name').blur();
  if (storage.getTutorialCompleted()) session.start('normal', performance.now());
  else session.start('practice', performance.now(), { tutorial: true });
}

function beginRetryGame() {
  // 結果/ポーズからは開始時に確定した名前をそのまま使う。
  if (!playerName) {
    gotoTitle();
    $('name-error').textContent = '名前を入力してから開始してください。';
    return;
  }
  session.start('normal', performance.now());
}

function beginPractice() {
  session.start('practice', performance.now());
}

// ---------- DOM ボタン配線 ----------
$('btn-play').addEventListener('click', beginNormalGame);
$('btn-howto').addEventListener('click', () => session.navigate(SESSION_STATES.HOWTO));
$('btn-howto-back').addEventListener('click', () => session.navigate(SESSION_STATES.HOME));
$('btn-howto-try').addEventListener('click', beginPractice);
$('btn-practice-again').addEventListener('click', beginPractice);
$('btn-practice-done-home').addEventListener('click', gotoTitle);
$('btn-practice-home').addEventListener('click', gotoTitle);
let nameComposing = false;
$('player-name').addEventListener('input', () => { $('name-error').textContent = ''; });
$('player-name').addEventListener('compositionstart', () => { nameComposing = true; });
$('player-name').addEventListener('compositionend', () => {
  // 変換確定直後のEnterは開始操作へ流さない。
  setTimeout(() => { nameComposing = false; }, 0);
});
$('player-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !nameComposing && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    beginNormalGame();
  }
});
$('btn-home-share').addEventListener('click', () => shareOrCopy({
  text: shareTextForHome(),
  title: 'パリパリ',
  statusElement: $('home-share-status'),
  textElement: $('home-share-text'),
}));
$('btn-result-share').addEventListener('click', () => shareOrCopy({
  text: $('result-share-text').value,
  title: 'パリパリの結果',
  statusElement: $('result-share-status'),
  textElement: $('result-share-text'),
}));
$('btn-settings').addEventListener('click', () => session.navigate(SESSION_STATES.SETTINGS));
$('btn-settings-back').addEventListener('click', () => session.navigate(SESSION_STATES.HOME));

$('btn-pause').addEventListener('click', pauseGame);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-pause-retry').addEventListener('click', beginRetryGame);
$('btn-pause-home').addEventListener('click', gotoTitle);

$('btn-retry').addEventListener('click', beginRetryGame);
$('btn-result-home').addEventListener('click', gotoTitle);

// 設定トグル
function bindToggle(id, key, apply) {
  $(id).addEventListener('change', (e) => {
    settings = { ...settings, [key]: e.target.checked };
    storage.setSettings(settings);
    game.setSettings(settings);
    apply && apply(e.target.checked);
  });
}
bindToggle('set-vibrate', 'vibrate', (v) => setHapticsEnabled(v));
bindToggle('set-motion', 'reducedMotion', (v) => { renderer.reducedMotion = v; });

// ---------- ポーズ ----------
function pauseGame() {
  if (session) session.pause('manual', { wall: performance.now() });
}
function resumeGame() {
  if (session) session.resume(performance.now());
}

// タブ離脱で自動ポーズ
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session) session.handleVisibility(true, performance.now());
});
window.addEventListener('pagehide', () => {
  if (session) session.handlePageHide(performance.now());
});

// ---------- リサイズ / 回転 ----------
function handleResize() {
  const viewport = window.visualViewport;
  if (viewport && viewport.scale === 1) {
    document.documentElement.style.setProperty('--visible-height', `${viewport.height}px`);
  }
  renderer.resize();
  checkOrientation();
}
function isHandheldDevice() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = String(nav.userAgent || '');
  const uaDataMobile = nav.userAgentData && nav.userAgentData.mobile === true;
  const mobileUA = /Android|iPhone|iPad|iPod|Windows Phone|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  // iPadOSの「デスクトップ用Webサイト」はMacIntelを名乗るため多点タッチを併用する。
  const iPadOSDesktop = nav.platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1;
  return !!(uaDataMobile || mobileUA || iPadOSDesktop);
}
function isLandscapeOrientation() {
  const orientationType = typeof screen !== 'undefined' && screen.orientation && screen.orientation.type;
  if (orientationType) return /landscape/i.test(orientationType);
  if (window.matchMedia) return window.matchMedia('(orientation: landscape)').matches;
  return window.innerWidth > window.innerHeight;
}
function checkOrientation() {
  // タッチPCをモバイルと混同せず、向きはキーボード表示時の寸法変化に依存しない。
  const shouldRotate = isLandscapeOrientation() && isHandheldDevice();
  $('rotate-hint').classList.toggle('hidden', !shouldRotate);
  if (shouldRotate && session) session.handleOrientation(false, performance.now());
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));
if (window.visualViewport) window.visualViewport.addEventListener('resize', handleResize);

// ---------- メインループ ----------
let lastRenderWall = performance.now();
function loop(now) {
  const previousWall = lastRenderWall;
  const frameMs = Math.max(0, now - previousWall);
  lastRenderWall = now;

  // A long rAF gap is a stop boundary. Session freezes at the last presented
  // wall time and discards only undelivered input; it never fast-forwards a
  // hidden tab into a burst of misses.
  const frame = session && session.observeFrame(now);
  if (!frame || !frame.stalled) {
    session && session.tick(now);
    const active = session && (session.state === SESSION_STATES.PLAYING
      || session.state === SESSION_STATES.PRACTICE);
    if (active) {
      if (!session.environmentReady()) {
        session.pause('environment', { wall: now });
      } else {
        const gameNow = clock.now(now);
        // R2 Game.update receives an absolute game time. Do not cap it to the
        // draw interval or advance it from animation-frame count.
        game.update(gameNow);
      }
    }
  }

  // Rendering may use a small capped delta for decorative particles, but it
  // never feeds that delta into the game clock.
  const renderDtSec = Math.min(frameMs, 50) / 1000;
  renderer.draw(renderDtSec, game.getRenderState(), particles);

  requestAnimationFrame(loop);
}

// ---------- 起動 ----------
handleResize();
gotoTitle();
requestAnimationFrame(loop);
