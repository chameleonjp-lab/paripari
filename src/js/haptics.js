// 触覚フィードバック（要件 §4.5）。iOS Safari は vibrate 非対応のため安全に無視される。
let enabled = true;

export function setHapticsEnabled(v) { enabled = !!v; }

export function vibrate(pattern) {
  if (!enabled) return;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* ignore */ }
}

export const HAPTICS = {
  perfect: [10, 10, 10],
  good: [15],
  miss: [40],
};
