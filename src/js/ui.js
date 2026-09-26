// DOM HUD / メニュー更新 要件 §4.1 §4.3
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

const SCREENS = ['title', 'howto', 'settings', 'ready', 'pause', 'result', 'practice-complete'];
const DIRECTION_NAMES = {
  L: '左',
  R: '右',
  U: '上',
  UL: '左上',
  UR: '右上',
  DL: '左下',
  D: '下',
  DR: '右下',
};

let _playUIVisible = false;
let _practiceVisible = false;
let _practiceGuide = null;

function focusScreen(screen) {
  const heading = screen.querySelector('h1, h2, h3, [role="heading"]');
  const firstAction = screen.querySelector(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
  );
  const target = heading || firstAction;
  if (target && typeof target.focus === 'function') {
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }
  }
}

export function showScreen(name) {
  const target = $('screen-' + name);
  if (!target) return;

  const active = document.activeElement;
  SCREENS.forEach((screenName) => {
    const screen = $('screen-' + screenName);
    if (!screen) return;
    const willHide = screen !== target;
    if (willHide && active && screen.contains(active) && typeof active.blur === 'function') {
      active.blur();
    }
    screen.classList.toggle('hidden', willHide);
  });

  target.scrollTop = 0;
  focusScreen(target);
}

export function hideAllScreens() {
  const active = document.activeElement;
  const focusedScreen = SCREENS
    .map((name) => $('screen-' + name))
    .find((screen) => screen && active && screen.contains(active));
  if (focusedScreen && typeof active.blur === 'function') active.blur();
  SCREENS.forEach((name) => {
    const screen = $('screen-' + name);
    if (screen) screen.classList.add('hidden');
  });
}

function syncPracticeGuide() {
  const guide = $('practice-guide');
  const shouldShow = _playUIVisible && _practiceVisible && !!_practiceGuide;
  if (guide) guide.classList.toggle('hidden', !shouldShow);

  const buttons = Array.from(document.querySelectorAll('#controls [data-dir]'));
  buttons.forEach((button) => {
    button.classList.remove('tutorial-target');
    button.removeAttribute('aria-describedby');
  });

  if (!shouldShow) return;
  const target = buttons.find((button) => button.dataset.dir === _practiceGuide.needDir);
  if (target) {
    target.classList.add('tutorial-target');
    target.setAttribute('aria-describedby', 'practice-guide');
  }
}

export function setPlayUIVisible(visible) {
  _playUIVisible = !!visible;
  $('hud').classList.toggle('hidden', !_playUIVisible);
  $('controls').classList.toggle('hidden', !_playUIVisible);
  if (!_playUIVisible) {
    const judge = $('judge-pop');
    judge.className = 'judge-pop';
    judge.textContent = '';
  }
  syncPracticeGuide();
}

export function setPracticeVisible(visible) {
  _practiceVisible = !!visible;
  const homeButton = $('btn-practice-home');
  if (homeButton) homeButton.classList.toggle('hidden', !_practiceVisible);
  syncPracticeGuide();
}

export function setPracticeGuide({ step, total, dir, needDir } = {}) {
  const safeTotal = Number.isFinite(Number(total)) && Number(total) > 0 ? Math.floor(Number(total)) : 5;
  const safeStep = Number.isFinite(Number(step))
    ? Math.min(safeTotal, Math.max(1, Math.floor(Number(step))))
    : 1;
  _practiceGuide = {
    step: safeStep,
    total: safeTotal,
    dir: String(dir || ''),
    needDir: String(needDir || ''),
  };

  const stepEl = $('practice-step');
  const instructionEl = $('practice-instruction');
  const incoming = DIRECTION_NAMES[_practiceGuide.dir] || '？';
  const required = DIRECTION_NAMES[_practiceGuide.needDir] || '？';
  if (stepEl) stepEl.textContent = `練習 ${safeStep} / ${safeTotal}　成功すると次へ`;
  if (instructionEl) instructionEl.textContent = `${incoming}からの攻撃 → ${required}を押す`;
  syncPracticeGuide();
}

let _bannerTimer = null;
export function showBanner(main, sub, duration = 1500) {
  const el = $('banner');
  $('banner-main').textContent = main || '';
  $('banner-sub').textContent = sub || '';
  $('banner-sub').style.display = sub ? '' : 'none';
  el.classList.remove('hidden');
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  if (_bannerTimer) clearTimeout(_bannerTimer);
  _bannerTimer = setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('hidden');
  }, duration);
}
export function hideBanner() {
  if (_bannerTimer) clearTimeout(_bannerTimer);
  $('banner').classList.add('hidden');
  $('banner').classList.remove('show');
}

export function updateHUD({ hp, score, combo }) {
  const hearts = '♥'.repeat(hp) + '<span style="opacity:.25">♥</span>'.repeat(CONFIG.MAX_HP - hp);
  $('hearts').innerHTML = hearts;
  $('score').textContent = score.toLocaleString();
  const comboEl = $('combo');
  comboEl.textContent = combo >= 2 ? `${combo} コンボ` : '';
}

export function bumpCombo() {
  const el = $('combo');
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

export function popJudge(result, delta, reason) {
  const el = $('judge-pop');
  el.className = 'judge-pop';
  void el.offsetWidth;

  let text;
  if (result === 'PERFECT') text = 'ぴったり！';
  else if (result === 'GOOD') text = '成功！';
  else {
    const fallbackReason = delta < 0 ? 'early' : delta > 0 ? 'late' : '';
    const missMessage = {
      direction: '逆方向！',
      early: '早すぎ！',
      late: '遅すぎ！',
      timeout: '時間切れ！',
    };
    text = missMessage[reason || fallbackReason] || '失敗！';
  }

  el.textContent = text;
  el.classList.add('show', String(result || 'MISS').toLowerCase());
}

export function setCountdown(n) {
  const el = $('countdown');
  el.textContent = n > 0 ? n : 'START';
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

export function showResult({ score, best, isBest, maxCombo, perfectRate, tier, rank }) {
  $('result-rank').textContent = rank;
  $('result-score').textContent = score.toLocaleString();
  $('result-best-badge').classList.toggle('hidden', !isBest);
  $('result-combo').textContent = maxCombo;
  $('result-perfect').textContent = `${perfectRate}%`;
  $('result-tier').textContent = tier;
  $('result-best').textContent = best.toLocaleString();
  showScreen('result');
}

export function setBestLabel(best) {
  $('title-best').textContent = best.toLocaleString();
}

export function reflectSettings(s) {
  $('set-vibrate').checked = s.vibrate;
  $('set-motion').checked = s.reducedMotion;
}
