// エントリポイント: 起動・rAFループ・状態遷移の配線 要件 §4.1 §6.2
import { CONFIG } from './config.js';
import { Renderer } from './renderer.js';
import { ParticlePool } from './particles.js';
import { Game } from './game.js';
import { setupInput, lockGestures } from './input.js';
import { setHapticsEnabled } from './haptics.js';
import * as ui from './ui.js';
import * as storage from './storage.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game-canvas');
const renderer = new Renderer(canvas);
const particles = new ParticlePool();

let settings = storage.getSettings();
setHapticsEnabled(settings.vibrate);
renderer.reducedMotion = !!settings.reducedMotion;

let pendingResult = null;   // リザルト表示用
let countdownTimer = null;

const game = new Game({
  renderer, particles, settings,
  onGameOver: (data) => {
    if (data.practiceDone) {
      // 練習完了 → 本番カウントダウンへ
      startCountdown(() => game.start('normal'));
      return;
    }
    pendingResult = data;
    ui.setPlayUIVisible(false);
    ui.setBestLabel(data.best);
    ui.showResult(data);
  },
});

// ---------- 入力 ----------
setupInput({
  onAction: ({ dir }) => {
    if (game.isPlaying()) game.handleAction(dir);
  },
});
lockGestures();

// ---------- 画面遷移ヘルパ ----------
function gotoTitle() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  game.state = 'IDLE';
  game.attack = null;
  ui.setPlayUIVisible(false);
  ui.setBestLabel(storage.getBest());
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
$('btn-settings').addEventListener('click', () => { ui.reflectSettings(settings); ui.showScreen('settings'); });
$('btn-settings-back').addEventListener('click', () => ui.showScreen('title'));

$('btn-pause').addEventListener('click', pauseGame);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-pause-retry').addEventListener('click', () => { ui.showScreen('ready'); beginNormalGame(); });
$('btn-pause-home').addEventListener('click', gotoTitle);

$('btn-retry').addEventListener('click', beginNormalGame);
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
function checkOrientation() {
  const landscape = window.innerWidth > window.innerHeight && window.innerWidth > 480;
  $('rotate-hint').classList.toggle('hidden', !landscape);
  if (landscape && game.isPlaying()) pauseGame();
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

// デバッグ/自動テスト用ハンドル（本番動作には影響しない）
window.PariPari = { game, renderer };
