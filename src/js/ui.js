import {t, formatNumber} from './i18n.js';
// DOM HUD / メニュー更新 要件 §4.1 §4.3
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

const SCREENS = ['title', 'howto', 'settings', 'ready', 'pause', 'result'];

export function showScreen(name) {
  SCREENS.forEach((s) => $('screen-' + s).classList.toggle('hidden', s !== name));
}
export function hideAllScreens() {
  SCREENS.forEach((s) => $('screen-' + s).classList.add('hidden'));
}

export function setPlayUIVisible(visible) {
  $('hud').classList.toggle('hidden', !visible);
  $('controls').classList.toggle('hidden', !visible);
}

export function setFourDir(four) {
  $('controls').classList.toggle('four', four);
}

export function updateHUD({ hp, score, combo }) {
  const hearts = '♥'.repeat(hp) + '<span style="opacity:.25">♥</span>'.repeat(CONFIG.MAX_HP - hp);
  $('hearts').innerHTML = hearts;
  $('score').textContent = formatNumber(score);
  const comboEl = $('combo');
  comboEl.textContent = combo >= 2 ? t('combo',{count:formatNumber(combo)}) : '';
}

export function bumpCombo() {
  const el = $('combo');
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

export function popJudge(result, delta) {
  const el = $('judge-pop');
  el.className = 'judge-pop';
  void el.offsetWidth;
  let text = result;
  if (result === 'PERFECT') text = t('perfectJudge');
  else if (result === 'GOOD') text = t(delta < 0 ? 'early' : delta > 0 ? 'late' : 'good');
  else text = t('miss');
  el.textContent = text;
  el.classList.add('show', result.toLowerCase());
}

export function setCountdown(n) {
  const el = $('countdown');
  el.textContent = n > 0 ? formatNumber(n) : t('start');
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
}

export function showResult({ score, best, isBest, maxCombo, perfectRate, tier, rank }) {
  $('result-rank').textContent = rank;
  $('result-score').textContent = formatNumber(score);
  $('result-best-badge').classList.toggle('hidden', !isBest);
  $('result-combo').textContent = formatNumber(maxCombo);
  $('result-perfect').textContent = `${formatNumber(perfectRate)}%`;
  $('result-tier').textContent = formatNumber(tier);
  showScreen('result');
}

export function setBestLabel(best) {
  $('title-best').textContent = formatNumber(best);
}

export function reflectSettings(s) {
  $('set-vibrate').checked = s.vibrate;
  $('set-motion').checked = s.reducedMotion;
}
