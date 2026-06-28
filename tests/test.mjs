// 判定/スコアの境界値テスト（要件 §9.1 §9.2）
// 実行: npm test  もしくは  node tests/test.mjs
import { CONFIG } from '../src/js/config.js';
import { judgeTiming } from '../src/js/judge.js';
import { comboMultiplier, timingBonus, calcGain } from '../src/js/scoring.js';

let pass = 0, fail = 0;
function eq(actual, expected, msg) {
  const ok = actual === expected;
  if (ok) { pass++; }
  else { fail++; console.error(`✗ ${msg}\n    expected ${expected}, got ${actual}`); }
}

const { PERFECT_WINDOW: PW, GOOD_WINDOW: GW } = CONFIG;

// --- judgeTiming ---
eq(judgeTiming(0, true), 'PERFECT', 'Δ=0 かつ方向OK → PERFECT');
eq(judgeTiming(PW, true), 'PERFECT', '|Δ|=PERFECT_WINDOW 境界 → PERFECT');
eq(judgeTiming(-PW, true), 'PERFECT', '早側 PERFECT 境界');
eq(judgeTiming(PW + 1, true), 'GOOD', 'PERFECT_WINDOW 超 → GOOD');
eq(judgeTiming(GW, true), 'GOOD', '|Δ|=GOOD_WINDOW 境界 → GOOD');
eq(judgeTiming(GW + 1, true), 'MISS', 'GOOD_WINDOW 超 → MISS（遅すぎ）');
eq(judgeTiming(-(GW + 1), true), 'MISS', '早すぎ → MISS');
eq(judgeTiming(0, false), 'MISS', '方向違いはタイミング完璧でも MISS');
eq(judgeTiming(GW + 9999, true), 'MISS', '無入力相当の大遅延 → MISS');

// --- comboMultiplier ---
eq(comboMultiplier(0), 1, 'combo0 → ×1');
eq(comboMultiplier(4), 1, 'combo4 → ×1');
eq(comboMultiplier(5), 1.5, 'combo5 → ×1.5');
eq(comboMultiplier(9), 1.5, 'combo9 → ×1.5');
eq(comboMultiplier(10), 2, 'combo10 → ×2');
eq(comboMultiplier(1000), CONFIG.COMBO_MAX_MULT, '上限 ×4.0');

// --- timingBonus ---
eq(timingBonus(0), CONFIG.TIMING_BONUS_MAX, 'Δ=0 → ボーナス最大');
eq(timingBonus(GW), 0, '|Δ|=GOOD_WINDOW → ボーナス0');
eq(timingBonus(GW * 2) >= 0, true, '範囲外でも0以上にクランプ');

// --- calcGain ---
eq(calcGain('MISS', 0, 0), 0, 'MISS → 0点');
eq(calcGain('PERFECT', 0, 0), CONFIG.BASE_PERFECT + CONFIG.TIMING_BONUS_MAX,
  'PERFECT combo0 Δ0 → 基礎300+ボーナス50=350');
eq(calcGain('GOOD', 0, GW), CONFIG.BASE_GOOD,
  'GOOD combo0 Δ=GW → 基礎100+ボーナス0=100');
eq(calcGain('PERFECT', 5, 0), Math.round(CONFIG.BASE_PERFECT * 1.5) + CONFIG.TIMING_BONUS_MAX,
  'PERFECT combo5 → 倍率1.5適用');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
