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

// --- ティア生成（20段階・速度ランダム性→マルチタップ） ---
const T = CONFIG.TIERS;
eq(T.length, 20, 'ティアは20段階');
let inc = true, jit = true;
for (let i = 1; i < T.length; i++) {
  if (T[i].successAt <= T[i - 1].successAt) inc = false;
  if (T[i].speedJitter < T[i - 1].speedJitter - 1e-9) jit = false;
}
eq(inc, true, 'successAt は厳密増加');
eq(jit, true, 'speedJitter は単調非減少');
eq(T[0].speedJitter, 0, '最初のティアは速度ランダム性なし');
eq(T[0].maxTaps, 1, '序盤は単発(1タップ)');
eq(T.some((t) => t.maxTaps === 2), true, '途中で2連が登場');
eq(T.some((t) => t.maxTaps === 3), true, '終盤で3連が登場');
// 速度ランダム性が出揃った後にマルチタップが始まる
const firstMulti = T.findIndex((t) => t.maxTaps >= 2);
eq(T[firstMulti].speedJitter >= 0.34, true, 'マルチタップ開始時には速度ランダム性が最大付近');
// tapWeights は確率分布（合計≈1, 非負）
let distOk = true;
for (const t of T) {
  const sum = t.tapWeights.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6 || t.tapWeights.some((w) => w < -1e-9)) distOk = false;
}
eq(distOk, true, 'tapWeights は合計1の確率分布');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
