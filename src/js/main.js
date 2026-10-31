import { initLanguage, t, formatNumber, setMessage } from "./i18n.js";
import { queueResult, readOutbox, acknowledgeResult } from "./outbox.js";
import { GameSound } from "./sound.js";
// エントリポイント: 起動・rAFループ・状態遷移の配線 要件 §4.1 §6.2
import { createRun, startRun, submitRun, loadTopRanking } from "./ranking.js";
import { CONFIG } from "./config.js";
import { Renderer } from "./renderer.js";
import { ParticlePool } from "./particles.js";
import { Game } from "./game.js";
import { setupInput, lockGestures } from "./input.js";
import { setHapticsEnabled } from "./haptics.js";
import * as ui from "./ui.js";
import * as storage from "./storage.js";
import { callRankingRpc, currentGameUrl, shareOrCopy } from "./platform.js";

const $ = (id) => document.getElementById(id);

initLanguage();
const canvas = $("game-canvas");
const renderer = new Renderer(canvas);
const particles = new ParticlePool();

let settings = storage.getSettings();
const sound = new GameSound(settings);
setHapticsEnabled(settings.vibrate);
renderer.reducedMotion = !!settings.reducedMotion;

let pendingResult = null; // リザルト表示用
let countdownTimer = null;
let pendingMode = "normal";
let playerName = "";
try {
  playerName = (localStorage.getItem("paripari.player-name") || "").trim();
} catch (_) {}
let resultSequence = 0;
let activeRun = null;
let resultRun = null;
let rankingRows = null;
let rankingDisplay = "loading";
const PENDING_KEY = "paripari.pending-result:v1";

const game = new Game({
  renderer,
  particles,
  settings,
  onSound: (event) => sound.play(event),
  onGameOver: (data) => {
    if (data.practiceDone) {
      // 練習完了 → 本番カウントダウンへ
      startCountdown(startNormalRun);
      return;
    }
    pendingResult = data;
    resultRun = activeRun;
    $("btn-last-result").hidden = false;
    $("result-save-warning").hidden = true;
    try {
      queueResult(localStorage, resultRun, data);
      localStorage.setItem(
        PENDING_KEY,
        JSON.stringify({ run: resultRun, result: data }),
      );
    } catch (_) {
      $("result-save-warning").hidden = false;
    }
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
  sound.stop();
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  ++resultSequence;
  game.state = "IDLE";
  game.attack = null;
  ui.setPlayUIVisible(false);
  ui.setBestLabel(storage.getBest());
  ui.showScreen("title");
  refreshPendingResults();
}

function startCountdown(onDone) {
  ui.hideAllScreens();
  ui.setPlayUIVisible(false);
  ui.showScreen("ready");
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
  pendingMode = "normal";
  startNamedGame();
}
function beginPractice() {
  pendingMode = "practice";
  startNamedGame();
}
function startNormalRun() {
  activeRun = createRun(playerName);
  void startRun(activeRun, callRankingRpc).catch(() => {});
  game.start("normal");
}
function startNamedGame() {
  void sound.unlock();
  playerName = Array.from(
    $("player-name")
      .value.replace(/[\u0000-\u001f\u007f]/g, "")
      .trim(),
  )
    .slice(0, 20)
    .join("");
  $("player-name").value = playerName;
  try {
    localStorage.setItem("paripari.player-name", playerName);
  } catch (_) {}
  ++resultSequence;
  if (pendingMode === "normal") {
    startCountdown(startNormalRun);
    return;
  }
  ui.hideAllScreens();
  ui.setPlayUIVisible(true);
  game.start("practice");
}

function shareTextForResult(data) {
  return `${t("resultShareText", { score: formatNumber(data.score), rank: data.rank, combo: formatNumber(data.maxCombo), rate: formatNumber(data.perfectRate), tier: formatNumber(data.tier) })}\n${currentGameUrl()}`;
}
function shareTextForHome() {
  return `${t("homeShare")}\n${currentGameUrl()}`;
}
function renderRanking(rows) {
  if (rows !== undefined) {
    rankingRows = Array.isArray(rows) ? rows.slice(0, 30) : [];
    rankingDisplay = "loaded";
  }
  const host = $("result-ranking-list");
  host.replaceChildren();
  if (rankingDisplay === "failed") return;
  if (rankingDisplay === "loading" || !rankingRows?.length) {
    const li = document.createElement("li");
    li.textContent = t(
      rankingDisplay === "loading" ? "loading" : "emptyRanking",
    );
    host.append(li);
    return;
  }
  for (const row of rankingRows) {
    const li = document.createElement("li");
    li.value = Number(row.rank_no ?? row.rank) || 1;
    const name = row.display_name || row.player_name || t("unnamed");
    li.textContent = `${name}: ${t("scorePoints", { score: formatNumber(Number(row.score ?? row.best_score ?? 0)) })}`;
    host.append(li);
  }
}
async function submitAndLoadRanking(data, sequence) {
  const run = resultRun;
  const status = $("result-submit-status");
  setMessage($("result-ranking-status"), "loading");
  setMessage(status, "updating");
  try {
    await submitRun(run, Math.trunc(data.score), callRankingRpc);
    try {
      acknowledgeResult(localStorage, run?.submissionId);
      refreshPendingResults();
    } catch (_) {
      /* A retained receipt can safely be retried. */
    }
    if (sequence === resultSequence) {
      setMessage(status, run?.name ? "sent" : "guest");
    }
  } catch (_) {
    if (sequence === resultSequence) setMessage(status, "submitFailed");
  }
  try {
    const rows = await loadTopRanking(callRankingRpc);
    if (sequence !== resultSequence) return;
    renderRanking(rows);
    setMessage(
      $("result-ranking-status"),
      rows.length ? "showing30" : "emptyRanking",
    );
  } catch (_) {
    if (sequence !== resultSequence) return;
    rankingDisplay = "failed";
    renderRanking();
    setMessage($("result-ranking-status"), "loadFailed");
  }
}

function renderResultPlatform(data) {
  const sequence = ++resultSequence;
  const text = shareTextForResult(data);
  setMessage(
    $("result-player"),
    resultRun?.name ? "playerResult" : "currentResult",
    { name: resultRun?.name ?? "" },
  );
  $("result-share-text").value = text;
  setMessage($("result-share-status"), null);
  rankingDisplay = "loading";
  renderRanking();
  setMessage($("result-ranking-status"), null);
  void submitAndLoadRanking(data, sequence);
}

// ---------- DOM ボタン配線 ----------
$("btn-play").addEventListener("click", beginNormalGame);
$("btn-howto").addEventListener("click", () => ui.showScreen("howto"));
$("btn-howto-back").addEventListener("click", () => ui.showScreen("title"));
$("btn-howto-try").addEventListener("click", beginPractice);
$("player-name").value = playerName;
$("player-name").addEventListener("input", () => {
  try {
    localStorage.setItem("paripari.player-name", $("player-name").value);
  } catch (_) {}
});
$("btn-ranking-retry").addEventListener("click", () => {
  if (pendingResult) void submitAndLoadRanking(pendingResult, ++resultSequence);
});
$("btn-home-share").addEventListener("click", () =>
  shareOrCopy({
    text: shareTextForHome(),
    title: t("gameName"),
    statusElement: $("home-share-status"),
    textElement: $("home-share-text"),
  }),
);
$("btn-result-share").addEventListener("click", () =>
  shareOrCopy({
    text: $("result-share-text").value,
    title: t("currentResult"),
    statusElement: $("result-share-status"),
    textElement: $("result-share-text"),
  }),
);
$("btn-settings").addEventListener("click", () => {
  ui.reflectSettings(settings);
  $("set-sound").checked = sound.enabled;
  $("set-volume").value = sound.volume;
  ui.showScreen("settings");
});
$("btn-settings-back").addEventListener("click", () => ui.showScreen("title"));

$("btn-pause").addEventListener("click", pauseGame);
$("btn-resume").addEventListener("click", resumeGame);
$("btn-pause-retry").addEventListener("click", beginNormalGame);
$("btn-pause-home").addEventListener("click", gotoTitle);

$("btn-retry").addEventListener("click", beginNormalGame);
$("btn-result-home").addEventListener("click", gotoTitle);

// 設定トグル
function bindToggle(id, key, apply) {
  $(id).addEventListener("change", (e) => {
    settings = { ...settings, [key]: e.target.checked };
    storage.setSettings(settings);
    game.setSettings(settings);
    apply && apply(e.target.checked);
  });
}
bindToggle("set-sound", "sound", () => {
  sound.configure(settings);
  if (sound.enabled) void sound.unlock();
});
$("set-volume").addEventListener("input", (e) => {
  settings = { ...settings, volume: Number(e.target.value) };
  storage.setSettings(settings);
  sound.configure(settings);
  if (sound.enabled) void sound.unlock();
});
bindToggle("set-vibrate", "vibrate", (v) => setHapticsEnabled(v));
bindToggle("set-motion", "reducedMotion", (v) => {
  renderer.reducedMotion = v;
});

// ---------- ポーズ ----------
let pausedState = null;
function pauseGame() {
  sound.suspend();
  if (!game.isPlaying()) return;
  pausedState = "PLAYING";
  game.state = "IDLE"; // ループ更新を止める（描画は継続）
  ui.showScreen("pause");
}
function resumeGame() {
  void sound.unlock();
  if (pausedState === "PLAYING") {
    ui.hideAllScreens();
    game.state = "PLAYING";
    // 中断時間ぶん次攻撃を後ろ倒し（理不尽防止）
    pausedState = null;
  }
}

// タブ離脱で自動ポーズ
document.addEventListener("visibilitychange", () => {
  if (document.hidden) sound.suspend();
  if (document.hidden && game.isPlaying()) pauseGame();
});

// ---------- リサイズ / 回転 ----------
function handleResize() {
  renderer.resize();
  checkOrientation();
}
function checkOrientation() {
  const landscape =
    window.innerWidth > window.innerHeight && window.innerWidth > 480;
  $("rotate-hint").classList.toggle("hidden", !landscape);
  if (landscape && game.isPlaying()) pauseGame();
}
window.addEventListener("resize", handleResize);
window.addEventListener("orientationchange", () =>
  setTimeout(handleResize, 200),
);
if (window.visualViewport)
  window.visualViewport.addEventListener("resize", handleResize);

// ---------- メインループ ----------
let last = performance.now();
function loop(now) {
  let dtMs = now - last;
  last = now;
  if (dtMs > 50) dtMs = 50; // 大きなフレーム飛びをクランプ

  // 演出タイマー（壁時計）と時間スケール
  let scale = 1;
  if (game.hitstopMs > 0) {
    game.hitstopMs -= dtMs;
    scale = 0;
  } else if (game.slowmoMs > 0) {
    game.slowmoMs -= dtMs;
    scale = CONFIG.SLOWMO_SCALE;
  }

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

$("btn-last-result").addEventListener("click", () => {
  if (!pendingResult || !resultRun) return;
  ui.showResult(pendingResult);
  renderResultPlatform(pendingResult);
});
try {
  const saved = JSON.parse(localStorage.getItem(PENDING_KEY) || "null");
  if (
    saved?.run &&
    typeof saved.run.name === "string" &&
    typeof saved.run.startId === "string" &&
    typeof saved.run.submissionId === "string" &&
    Number.isSafeInteger(saved.result?.score) &&
    saved.result.score >= 0
  ) {
    pendingResult = saved.result;
    resultRun = Object.freeze({
      ...saved.run,
      clientVersion: saved.run.clientVersion ?? "paripari-20261031-common",
    });
    $("btn-last-result").hidden = false;
  }
} catch (_) {
  /* Keep unreadable or future storage untouched. */
}
// ---------- 起動 ----------
handleResize();
gotoTitle();
requestAnimationFrame(loop);

// デバッグ/自動テスト用ハンドル（本番動作には影響しない）
window.PariPari = { game, renderer };

function refreshPendingResults() {
  const host = $("pending-results");
  host.replaceChildren();
  let entries = [];
  try {
    entries = readOutbox(localStorage);
  } catch {
    return;
  }
  for (const saved of entries) {
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.textContent = t("pendingResult", {
      score: formatNumber(saved.result.score),
    });
    button.addEventListener("click", () => {
      pendingResult = saved.result;
      resultRun = Object.freeze(saved.run);
      ui.showResult(pendingResult);
      renderResultPlatform(pendingResult);
    });
    host.append(button);
  }
}

// Language changes update presentation only; never restart, reroll or submit a run.
document.addEventListener("paripari:language", () => {
  ui.setBestLabel(storage.getBest());
  ui.updateHUD(game);
  if (pendingResult) {
    const showingResult = !$("screen-result").classList.contains("hidden");
    if (showingResult) ui.showResult(pendingResult);
    $("result-share-text").value = shareTextForResult(pendingResult);
  }
  if (!$("home-share-text").hidden)
    $("home-share-text").value = shareTextForHome();
  renderRanking();
  refreshPendingResults();
});
