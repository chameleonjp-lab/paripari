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
  $('score').textContent = score.toLocaleString();
  const comboEl = $('combo');
  comboEl.textContent = combo >= 2 ? `${combo} COMBO` : '';
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
  if (result === 'PERFECT') text = 'PERFECT!';
  else if (result === 'GOOD') text = delta < 0 ? 'GOOD (早)' : delta > 0 ? 'GOOD (遅)' : 'GOOD';
  else text = 'MISS';
  el.textContent = text;
  el.classList.add('show', result.toLowerCase());
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
  showScreen('result');
}

export function setBestLabel(best) {
  $('title-best').textContent = best.toLocaleString();
}

export function reflectSettings(s) {
  $('set-sound').checked = s.sound;
  $('set-vibrate').checked = s.vibrate;
  $('set-motion').checked = s.reducedMotion;
}
