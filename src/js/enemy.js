// 攻撃のライフサイクルと時間モデル 要件 §2.2 §5
import { CONFIG, OPPOSITE } from './config.js';

let _id = 0;

/**
 * 攻撃を生成する。
 * @param {number} now performance.now()
 * @param {object} tier CONFIG.TIERS の1要素
 */
export function createAttack(now, tier) {
  const dirs = tier.directions;
  const dir = dirs[(Math.random() * dirs.length) | 0];
  const visibleMs = tier.visibleMs;
  return {
    id: ++_id,
    dir,                          // 攻撃の来る方向 L/R/U/D
    needDir: OPPOSITE[dir],       // 受け流しに必要な入力（反対側）
    spawnAt: now,                 // 予兆開始
    impactAt: now + visibleMs,    // T（パリィライン到達）
    windowEnd: now + visibleMs + CONFIG.GOOD_WINDOW, // 無入力MISS確定
    visibleMs,
    resolved: false,
    resolvedAt: 0,                // 判定が確定した gameTime
    result: null,                 // 'PERFECT'|'GOOD'|'MISS'
    feint: false,                 // 将来拡張
  };
}

// 接近の進捗 0..1（予兆開始→インパクト）。ease-in。
export function attackProgress(attack, now) {
  const p = (now - attack.spawnAt) / (attack.impactAt - attack.spawnAt);
  return Math.max(0, Math.min(1.4, p));
}

export function nextInterval(tier) {
  const j = CONFIG.INTERVAL_JITTER;
  const factor = 1 + (Math.random() * 2 - 1) * j;
  return tier.intervalMs * factor;
}
