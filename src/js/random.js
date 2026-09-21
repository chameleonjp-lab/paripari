// ゲーム処理専用の擬似乱数。
// Renderer/ParticlePool が使う Math.random() と状態を共有しないため、
// 描画回数や演出の有無で攻撃列が変わらない。

/**
 * Mulberry32 の小さな決定的 PRNG を作る。
 * @param {number} seed 32bit 整数へ丸められる初期値
 * @returns {() => number} [0, 1) の値を返す関数
 */
export function createRandom(seed = defaultSeed()) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Math.random は使わず、別の時計だけから既定シードを作る。シードは
// 再現性を必要とする検査では createRandom(seed) で明示的に注入できる。
function defaultSeed() {
  const perf = globalThis.performance;
  const now = typeof perf?.now === 'function' ? perf.now() : 0;
  const origin = Number.isFinite(perf?.timeOrigin) ? perf.timeOrigin : Date.now();
  return (Math.floor(now * 1000) ^ Math.floor(origin)) >>> 0;
}

let moduleRandom = null;
function moduleRandomValue() {
  if (!moduleRandom) moduleRandom = createRandom();
  return moduleRandom();
}

export const defaultRandom = moduleRandomValue;
