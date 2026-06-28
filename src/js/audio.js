// Web Audio による合成SE（アセット不要・軽量） 要件 §4.5 §6.5
let ctx = null;
let masterGain = null;
let enabled = true;

export function setAudioEnabled(v) {
  enabled = !!v;
  if (masterGain) masterGain.gain.value = enabled ? 0.9 : 0;
}

// 初回ユーザー操作で呼ぶ（iOS 自動再生制限対策）
export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = enabled ? 0.9 : 0;
    masterGain.connect(ctx.destination);
  } catch { ctx = null; }
}

function tone({ freq, type = 'sine', dur = 0.12, gain = 0.3, slideTo = null, delay = 0 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst({ dur = 0.12, gain = 0.25, hp = 800 }) {
  if (!ctx || !enabled) return;
  const t0 = ctx.currentTime;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(filt); filt.connect(g); g.connect(masterGain);
  src.start(t0);
}

export function play(name) {
  if (!ctx || !enabled) return;
  if (ctx.state === 'suspended') ctx.resume();
  switch (name) {
    case 'perfect':
      tone({ freq: 1400, type: 'triangle', dur: 0.18, gain: 0.35, slideTo: 2200 });
      tone({ freq: 2100, type: 'sine', dur: 0.22, gain: 0.18, delay: 0.02 });
      noiseBurst({ dur: 0.08, gain: 0.12, hp: 4000 });
      break;
    case 'good':
      tone({ freq: 880, type: 'triangle', dur: 0.12, gain: 0.3, slideTo: 1320 });
      noiseBurst({ dur: 0.06, gain: 0.1, hp: 3000 });
      break;
    case 'miss':
      tone({ freq: 180, type: 'sawtooth', dur: 0.18, gain: 0.3, slideTo: 90 });
      noiseBurst({ dur: 0.12, gain: 0.18, hp: 400 });
      break;
    case 'tap':
      tone({ freq: 440, type: 'square', dur: 0.04, gain: 0.08 });
      break;
    case 'combo':
      tone({ freq: 1600, type: 'sine', dur: 0.1, gain: 0.2, slideTo: 2400 });
      break;
    default: break;
  }
}
