// Synthesized feedback only. Game timing and random state never depend on sound.
export function soundPreferences(settings = {}) {
  return { enabled: typeof settings.sound === 'boolean' ? settings.sound : true,
    volume: Number.isFinite(settings.volume) && settings.volume >= 0 && settings.volume <= 1 ? settings.volume : 0.35 };
}
const NOTES = {
  start: [440, 660], good: [640], perfect: [880, 1100], miss: [180, 110],
  complete: [660, 880], result: [330, 220], best: [660, 880, 1100],
};
export class GameSound {
  constructor(settings = {}, factory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)()) {
    this.factory = factory; this.context = null; this.voices = new Set(); this.lastAt = -Infinity;
    this.configure(settings);
  }
  configure(settings) {
    Object.assign(this, soundPreferences(settings));
    if (!this.enabled || this.volume === 0) this.stop();
  }
  async unlock() {
    if (!this.enabled || this.volume === 0 || globalThis.document?.hidden) return;
    try {
      this.context ??= this.factory();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* Audio is optional; do not delay starting or retry old cues. */ }
  }
  play(event) {
    const context = this.context;
    if (!this.enabled || this.volume === 0 || !context || context.state !== 'running' || globalThis.document?.hidden) return;
    const notes = NOTES[event];
    if (!notes) return;
    const ending = event === 'result' || event === 'best' || event === 'complete';
    if (!ending && context.currentTime - this.lastAt < 0.06) return;
    this.stop(); // A resolved hit has one cue; a result supersedes the final miss.
    this.lastAt = context.currentTime;
    try {
      notes.forEach((frequency, index) => {
        const oscillator = context.createOscillator(), gain = context.createGain();
        const at = context.currentTime + index * 0.075;
        oscillator.type = 'sine'; oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(this.volume * 0.12, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
        oscillator.connect(gain); gain.connect(context.destination);
        const voice = { oscillator, gain }; this.voices.add(voice);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.voices.delete(voice); };
        oscillator.start(at); oscillator.stop(at + 0.15);
      });
    } catch { this.stop(); }
  }
  stop() {
    if (!this.voices) return;
    for (const {oscillator, gain} of this.voices) {
      try { oscillator.stop(); oscillator.disconnect(); gain.disconnect(); } catch { /* Already ended. */ }
    }
    this.voices.clear();
  }
  suspend() {
    this.stop();
    if (this.context?.state === 'running') void this.context.suspend().catch(() => {});
  }
}
