// 外部音声ファイルを使わない短い効果音。
// Safariなどの自動再生制限に合わせ、最初のユーザー操作で再開する。
let enabled = true;
let audioContext = null;

function contextConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function getContext() {
  const Constructor = contextConstructor();
  if (!Constructor) return null;
  if (audioContext) return audioContext;
  try {
    audioContext = new Constructor();
    return audioContext;
  } catch {
    return null;
  }
}

function resumeContext(context) {
  if (context && context.state === 'suspended' && typeof context.resume === 'function') {
    context.resume().catch(() => {});
  }
}

function tone(frequency, duration, {
  type = 'sine',
  volume = 0.045,
  delay = 0,
  endFrequency = frequency,
} = {}) {
  if (!enabled) return;
  const context = getContext();
  if (!context || typeof context.createOscillator !== 'function') return;
  resumeContext(context);

  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + Math.max(0, delay);
    const end = start + Math.max(0.025, duration);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), end);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  } catch {
    // 効果音はゲーム進行を止める理由にしない。
  }
}

export function setSoundEnabled(value) {
  enabled = !!value;
}

export function unlockSound() {
  resumeContext(getContext());
}

/**
 * 現在のゲームに必要なSEを1か所にまとめる。
 * attack: 攻撃の出現、countdown/start: 開始、
 * perfect/good/miss/gameover: 判定と終了。
 */
export function playSfx(name, value = 0) {
  if (!enabled) return;
  switch (name) {
    case 'attack':
      tone(430, 0.055, { volume: 0.018, type: 'triangle', endFrequency: 560 });
      break;
    case 'countdown':
      tone(value === 1 ? 560 : 470, 0.09, { volume: 0.035, type: 'sine' });
      break;
    case 'start':
      tone(660, 0.1, { volume: 0.04, type: 'triangle' });
      tone(990, 0.16, { volume: 0.045, type: 'triangle', delay: 0.08 });
      break;
    case 'perfect':
      tone(880, 0.1, { volume: 0.045, type: 'triangle' });
      tone(1320, 0.16, { volume: 0.04, type: 'triangle', delay: 0.06 });
      break;
    case 'good':
      tone(650, 0.11, { volume: 0.035, type: 'sine', endFrequency: 760 });
      break;
    case 'miss':
      tone(180, 0.2, { volume: 0.05, type: 'sawtooth', endFrequency: 90 });
      break;
    case 'gameover':
      tone(260, 0.18, { volume: 0.045, type: 'triangle', endFrequency: 180 });
      tone(150, 0.28, { volume: 0.04, type: 'triangle', delay: 0.14, endFrequency: 90 });
      break;
    default:
      break;
  }
}
