// エントリポイント: 起動・rAFループ・状態遷移の配線 要件 §4.1 §6.2
import { CONFIG } from './config.js';
import { Renderer } from './renderer.js';
import { ParticlePool } from './particles.js';
import { Game } from './game.js';
import { setupInput, lockGestures } from './input.js';
import { setHapticsEnabled } from './haptics.js';
import * as ui from './ui.js';
import * as storage from './storage.js';
import { callRankingRpc, currentGameUrl, escapeHtml, shareOrCopy } from './platform.js';

const $ = (id) => document.getElementById(id);

const canvas = $('game-canvas');
const renderer = new Renderer(canvas);
const particles = new ParticlePool();

let settings = storage.getSettings();
setHapticsEnabled(settings.vibrate);
renderer.reducedMotion = !!settings.reducedMotion;

let pendingResult = null;   // リザルト表示用
let countdownTimer = null;
let pendingMode = 'normal';
let playerName = (localStorage.getItem('paripari.player-name') || '').trim();
let resultSequence = 0;

const GAME_SLUG = 'paripari';
const CLIENT_VERSION = 'paripari-2026-08-31-platform';

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
    renderResultPlatform(data);
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
  showNameScreen('normal');
}

function beginPractice() {
  showNameScreen('practice');
}

function showNameScreen(mode) {
  pendingMode = mode;
  $('player-name').value = playerName;
  $('name-error').textContent = '';
  ui.showScreen('name');
  queueMicrotask(() => $('player-name').focus({ preventScroll: true }));
}

function startNamedGame() {
  playerName = $('player-name').value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
  $('player-name').value = playerName;
  if (!playerName) {
    $('name-error').textContent = '名前を入力してから開始してください。';
    $('player-name').focus();
    return;
  }
  localStorage.setItem('paripari.player-name', playerName);
  if (pendingMode === 'normal') {
    startCountdown(() => game.start('normal'));
    return;
  }
  ui.hideAllScreens();
  ui.setPlayUIVisible(true);
  game.start('practice');
}

function shareTextForResult(data) {
  return `${playerName}さんのパリパリ結果：${data.score.toLocaleString()}点、ランク${data.rank}！\n最大コンボ${data.maxCombo}・PERFECT率${data.perfectRate}%・到達ティア${data.tier}\n${currentGameUrl()}\n#パリパリ #ミニゲーム`;
}

function shareTextForHome() {
  return `パリパリ：来た方向と反対を、ちょうどの瞬間に弾け。\n${currentGameUrl()}\n#パリパリ #ミニゲーム`;
}

function renderRanking(rows) {
  const list = Array.isArray(rows) ? rows.slice(0, 10) : [];
  $('result-ranking-list').innerHTML = list.length
    ? list.map((row) => `<li>${escapeHtml(row.display_name || row.player_name || 'ななし')}：${Number(row.score ?? row.best_score ?? 0).toLocaleString()}点</li>`).join('')
    : '<li>まだランキングがありません。</li>';
}

async function submitAndLoadRanking(data, sequence) {
  const status = $('result-ranking-status');
  status.textContent = 'ランキングを更新中…';
  try {
    await callRankingRpc('submit_score', {
      p_display_name: playerName,
      p_game_slug: GAME_SLUG,
      p_score: Math.trunc(data.score),
      p_client_version: CLIENT_VERSION,
    });
  } catch (_) {
    if (sequence === resultSequence) status.textContent = '今回のスコアを送信できませんでした。ランキングを表示します。';
  }
  try {
    const rows = await callRankingRpc('get_best_score_ranking', { p_game_slug: GAME_SLUG, p_limit: 10 });
    if (sequence !== resultSequence) return;
    renderRanking(rows);
    if (status.textContent === 'ランキングを更新中…') status.textContent = '上位10名を表示しています。';
  } catch (_) {
    if (sequence !== resultSequence) return;
    renderRanking([]);
    status.textContent = 'ランキングを読み込めませんでした。';
  }
}

function renderResultPlatform(data) {
  const sequence = ++resultSequence;
  const text = shareTextForResult(data);
  $('result-player').textContent = `${playerName}さんの結果`;
  $('result-share-text').value = text;
  $('result-share-status').textContent = '';
  $('result-ranking-list').innerHTML = '<li>ランキングを読み込み中…</li>';
  $('result-ranking-status').textContent = '';
  void submitAndLoadRanking(data, sequence);
}

// ---------- DOM ボタン配線 ----------
$('btn-play').addEventListener('click', beginNormalGame);
$('btn-howto').addEventListener('click', () => ui.showScreen('howto'));
$('btn-howto-back').addEventListener('click', () => ui.showScreen('title'));
$('btn-howto-try').addEventListener('click', beginPractice);
$('btn-name-start').addEventListener('click', startNamedGame);
$('btn-name-back').addEventListener('click', () => ui.showScreen('title'));
$('player-name').addEventListener('input', () => { $('name-error').textContent = ''; });
$('btn-home-share').addEventListener('click', () => shareOrCopy({ text: shareTextForHome(), title: 'パリパリ', statusElement: $('home-share-status'), textElement: $('result-share-text') }));
$('btn-result-share').addEventListener('click', () => shareOrCopy({ text: $('result-share-text').value, title: 'パリパリの結果', statusElement: $('result-share-status'), textElement: $('result-share-text') }));
$('btn-settings').addEventListener('click', () => { ui.reflectSettings(settings); ui.showScreen('settings'); });
$('btn-settings-back').addEventListener('click', () => ui.showScreen('title'));

$('btn-pause').addEventListener('click', pauseGame);
$('btn-resume').addEventListener('click', resumeGame);
$('btn-pause-retry').addEventListener('click', beginNormalGame);
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
