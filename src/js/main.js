// エントリポイント: 起動・rAFループ・状態遷移の配線 要件 §4.1 §6.2
import { CONFIG } from './config.js';
import { Renderer } from './renderer.js';
import { ParticlePool } from './particles.js';
import { Game } from './game.js';
import { setupInput, lockGestures } from './input.js';
import { setHapticsEnabled } from './haptics.js';
import * as ui from './ui.js';
import * as storage from './storage.js';
import { officialGameUrl, shareOrCopy } from './platform.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game-canvas');
const renderer = new Renderer(canvas);
const particles = new ParticlePool();

let settings = storage.getSettings();
setHapticsEnabled(settings.vibrate);
renderer.reducedMotion = !!settings.reducedMotion;

let countdownTimer = null;
let playerName = storage.getPlayerName();

const game = new Game({
  renderer, particles, settings,
  onGameOver: (data) => {
    if (data.practiceDone) {
      // 任意練習の完了後は勝手に本番へ進めず、遊び方へ戻す。
      // 本番はホームの名前入力を通った開始操作だけで始める。
      ui.hideBanner();
      ui.setPlayUIVisible(false);
      ui.showScreen('howto');
      return;
    }
    ui.hideBanner();
    ui.setPlayUIVisible(false);
    ui.setBestLabel(data.best);
    ui.showResult(data);
    renderResultShare(data);
  },
});

// ---------- 入力 ----------
setupInput({
  canHandleAction: () => game.isPlaying(),
  onAction: ({ dir }) => {
    if (game.isPlaying()) game.handleAction(dir);
  },
});
lockGestures({
  targets: [canvas, $('controls')],
  isEnabled: () => game.isPlaying(),
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
    `最大コンボ${data.maxCombo}・PERFECT率${data.perfectRate}%・到達ティア${data.tier}`,
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
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  game.state = 'IDLE';
  game.attack = null;
  ui.hideBanner();
  ui.setPlayUIVisible(false);
  ui.setBestLabel(storage.getBest());
  playerName = storage.getPlayerName() || playerName;
  $('player-name').value = playerName;
  $('name-error').textContent = '';
  renderHomeShare();
  ui.showScreen('title');
}

function startCountdown(onDone) {
  ui.hideAllScreens();
  ui.setPlayUIVisible(false);
  ui.showScreen('ready');
  let n = 3;
  ui.setCountdown(n);
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      ui.hideAllScreens();
      ui.setPlayUIVisible(true);
      onDone();
    } else {
      ui.setCountdown(n);
    }
  }, 700);
}

function beginNormalGame() {
  if (!readPlayerName()) return;
  startCountdown(() => game.start('normal'));
}

function beginRetryGame() {
  // 結果/ポーズからは開始時に確定した名前をそのまま使う。
  if (!playerName) {
    gotoTitle();
    $('name-error').textContent = '名前を入力してから開始してください。';
    return;
  }
  startCountdown(() => game.start('normal'));
}

function beginPractice() {
  ui.hideAllScreens();
  ui.setPlayUIVisible(true);
  game.start('practice');
}

// ---------- DOM ボタン配線 ----------
$('btn-play').addEventListener('click', beginNormalGame);
$('btn-howto').addEventListener('click', () => ui.showScreen('howto'));
$('btn-howto-back').addEventListener('click', () => ui.showScreen('title'));
$('btn-howto-try').addEventListener('click', beginPractice);
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
$('btn-settings').addEventListener('click', () => { ui.reflectSettings(settings); ui.showScreen('settings'); });
$('btn-settings-back').addEventListener('click', () => ui.showScreen('title'));

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
let pausedState = null;
function pauseGame() {
  if (!game.isPlaying()) return;
  pausedState = 'PLAYING';
  game.state = 'IDLE'; // ループ更新を止める（描画は継続）
  ui.showScreen('pause');
}
function resumeGame() {
  if (pausedState === 'PLAYING') {
    ui.hideAllScreens();
    game.state = 'PLAYING';
    // 中断時間ぶん次攻撃を後ろ倒し（理不尽防止）
    pausedState = null;
  }
}

// タブ離脱で自動ポーズ
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.isPlaying()) pauseGame();
});

// ---------- リサイズ / 回転 ----------
function handleResize() {
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
  if (shouldRotate && game.isPlaying()) pauseGame();
}
window.addEventListener('resize', handleResize);
window.addEventListener('orientationchange', () => setTimeout(handleResize, 200));
if (window.visualViewport) window.visualViewport.addEventListener('resize', handleResize);

// ---------- メインループ ----------
let last = performance.now();
function loop(now) {
  let dtMs = now - last;
  last = now;
  if (dtMs > 50) dtMs = 50; // 大きなフレーム飛びをクランプ

  // 演出タイマー（壁時計）と時間スケール
  let scale = 1;
  if (game.hitstopMs > 0) { game.hitstopMs -= dtMs; scale = 0; }
  else if (game.slowmoMs > 0) { game.slowmoMs -= dtMs; scale = CONFIG.SLOWMO_SCALE; }

  const playing = game.isPlaying();
  const dtScaled = dtMs * scale;
  // ゲーム時間はプレイ中のみ進める（ポーズ中の即時タイムアウトを防止）
  if (playing) {
    game.gameTime += dtScaled;
    game.update(dtScaled / 1000);
  }
  // 描画はメニュー/ポーズ中も継続（背景アニメ・余韻）
  const renderDtSec = (playing ? dtScaled : dtMs) / 1000;
  renderer.draw(renderDtSec, game.getRenderState(), particles);

  requestAnimationFrame(loop);
}

// ---------- 起動 ----------
handleResize();
gotoTitle();
requestAnimationFrame(loop);
