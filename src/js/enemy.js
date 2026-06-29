// 攻撃のライフサイクルと時間モデル 要件 §2.2 §5
import { CONFIG, OPPOSITE } from './config.js';

let _id = 0;

/**
 * 攻撃を生成する。
 * @param {number} now performance.now()
 * @param {number} visibleMs 予兆+接近の合計可視時間
 * @param {string[]} dirs 出現方向の候補（既定 CONFIG.DIRECTIONS）
 */
export function createAttack(now, visibleMs, dirs = CONFIG.DIRECTIONS) {
  const dir = dirs[(Math.random() * dirs.length) | 0];
  return {
    id: ++_id,
    dir,                          // 攻撃の来る方向 L/R/U/UL/UR
    needDir: OPPOSITE[dir],       // 受け流しに必要な入力（反対側）
    spawnAt: now,
    impactAt: now + visibleMs,
    windowEnd: now + visibleMs + CONFIG.GOOD_WINDOW,
    visibleMs,
    resolved: false,
    resolvedAt: 0,
    result: null,
  };
}

// 接近の進捗 0..1（予兆開始→インパクト）。
export function attackProgress(attack, now) {
  const p = (now - attack.spawnAt) / (attack.impactAt - attack.spawnAt);
  return Math.max(0, Math.min(1.4, p));
}

export function nextInterval(intervalMs) {
  const j = CONFIG.INTERVAL_JITTER;
  const factor = 1 + (Math.random() * 2 - 1) * j;
  return intervalMs * factor;
}
