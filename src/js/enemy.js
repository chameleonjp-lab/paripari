// 攻撃のライフサイクルと時間モデル 要件 §2.2 §5
import { CONFIG, OPPOSITE } from './config.js';

let _id = 0;

// tapWeights から必要タップ数(1..3)を抽選
export function pickTaps(weights) {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r < acc) return i + 1;
  }
  return 1;
}

/**
 * 攻撃を生成する。
 * @param {number} now performance.now()
 * @param {object} opts { baseVisibleMs, speedJitter, taps, dirs }
 */
export function createAttack(now, opts) {
  const {
    baseVisibleMs,
    speedJitter = 0,
    taps = 1,
    dirs = CONFIG.DIRECTIONS,
  } = opts;

  const dir = dirs[(Math.random() * dirs.length) | 0];
  // 速度ランダム性: バーごとに可視時間を ±speedJitter で揺らす
  const jitter = 1 + (Math.random() * 2 - 1) * speedJitter;
  const visibleMs = Math.max(300, Math.round(baseVisibleMs * jitter));

  const g = CONFIG.SEGMENT_GAP;
  const gap = Math.min(g.max, Math.max(g.min, visibleMs * g.ratio));

  const segments = [];
  for (let k = 0; k < taps; k++) {
    segments.push({ impactAt: now + visibleMs + k * gap, resolved: false, result: null });
  }

  return {
    id: ++_id,
    dir,
    needDir: OPPOSITE[dir],
    spawnAt: now,
    visibleMs,
    taps,
    segments,
    segIndex: 0,        // 次に判定すべき分割
    hpLost: false,      // この攻撃で既にHPを失ったか（1攻撃あたりHP減は最大1）
    warmup: false,
    resolved: false,    // 全分割が解決済みか
    resolvedAt: 0,
    result: null,       // 直近の分割結果（余韻演出用）
  };
}

export function currentSegment(attack) {
  return attack.segments[Math.min(attack.segIndex, attack.segments.length - 1)];
}

// 次に叩くべき分割への収束進捗 0..1（分割ごとにリングが再収束する）
export function ringProgress(attack, now) {
  const i = attack.segIndex;
  const to = currentSegment(attack).impactAt;
  const from = i > 0 ? attack.segments[i - 1].impactAt : attack.spawnAt;
  const span = Math.max(1, to - from);
  return Math.max(0, Math.min(1.4, (now - from) / span));
}

export function nextInterval(intervalMs) {
  const j = CONFIG.INTERVAL_JITTER;
  const factor = 1 + (Math.random() * 2 - 1) * j;
  return intervalMs * factor;
}
