// 画面・試合・停止をまとめる小さな状態機械。
// DOMやrAFを直接所有せず、main.jsから壁時計の時刻を渡して進める。
// これによりカウントダウンもゲーム進行も同じrAF経路になり、setInterval
// が停止中に試合を進めることを防ぐ。

import { STALL_THRESHOLD_MS as CLOCK_STALL_THRESHOLD_MS } from './clock.js';

export const SESSION_STATES = Object.freeze({
  HOME: 'HOME',
  HOWTO: 'HOWTO',
  SETTINGS: 'SETTINGS',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  PRACTICE: 'PRACTICE',
  PAUSED: 'PAUSED',
  RESUME_COUNTDOWN: 'RESUME_COUNTDOWN',
  RESULT: 'RESULT',
});

export const COUNTDOWN_STEP_MS = 700;
export const COUNTDOWN_STEPS = 3;
export const COUNTDOWN_TOTAL_MS = COUNTDOWN_STEP_MS * COUNTDOWN_STEPS;
export const STALL_THRESHOLD_MS = CLOCK_STALL_THRESHOLD_MS;

const ACTIVE_STATES = new Set([
  SESSION_STATES.COUNTDOWN,
  SESSION_STATES.PLAYING,
  SESSION_STATES.PRACTICE,
  SESSION_STATES.RESUME_COUNTDOWN,
]);

const finiteWall = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

function defaultWallNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function noop() {}

/**
 * SessionController owns transitions that must invalidate old work.
 *
 * The game and clock are deliberately injected. A browser adapter can use
 * GameClock/Game, while unit tests can supply deterministic doubles.
 */
export class SessionController {
  constructor({
    game = null,
    clock = null,
    input = null,
    wallNow = defaultWallNow,
    isVisible = () => true,
    isPortrait = () => true,
    isOperable = () => true,
    onStateChange = noop,
    onCountdown = noop,
    onStart = noop,
    onPause = noop,
    onResult = noop,
    onInvalidate = noop,
    countdownStepMs = COUNTDOWN_STEP_MS,
    stallThresholdMs = STALL_THRESHOLD_MS,
  } = {}) {
    this.game = game;
    this.clock = clock;
    this.input = input;
    this.wallNow = wallNow;
    this.isVisible = isVisible;
    this.isPortrait = isPortrait;
    this.isOperable = isOperable;
    this.onStateChange = onStateChange;
    this.onCountdown = onCountdown;
    this.onStart = onStart;
    this.onPause = onPause;
    this.onResult = onResult;
    this.onInvalidate = onInvalidate;
    this.countdownStepMs = countdownStepMs;
    this.stallThresholdMs = stallThresholdMs;

    this.state = SESSION_STATES.HOME;
    this.mode = null;
    this.matchId = 0;
    this.roundId = null;
    this.result = null;
    this.pauseReason = null;
    this.resumeState = null;
    this.resumeGameStarted = false;
    this._generation = 0;
    this._countdown = null;
    this.lastPresentedWall = null;
  }

  get generation() { return this._generation; }

  get isActive() { return ACTIVE_STATES.has(this.state); }

  canHandleAction() {
    return (this.state === SESSION_STATES.PLAYING || this.state === SESSION_STATES.PRACTICE)
      && this.environmentReady();
  }

  environmentReady() {
    try {
      return !!this.isVisible() && !!this.isPortrait() && !!this.isOperable();
    } catch (_) {
      return false;
    }
  }

  _emitState(next, extra = {}) {
    const previous = this.state;
    this.state = next;
    const context = {
      previous,
      state: next,
      mode: this.mode,
      matchId: this.matchId,
      roundId: this.roundId,
      generation: this._generation,
      ...extra,
    };
    this.onStateChange(next, context);
    return context;
  }

  _clearPressed() {
    if (this.input && typeof this.input.clearPressed === 'function') this.input.clearPressed();
  }

  _clearGameInputs() {
    if (this.game) this.game.clearInputs();
  }

  _stopGame() {
    if (!this.game) return;
    this.game.stop();
  }

  _pauseGame(discardInputs) {
    if (!this.game) return;
    this.game.pause({ discardInputs: !!discardInputs });
  }

  _resumeGame() {
    if (!this.game) return;
    this.game.resume();
  }

  _pauseClock(wall) {
    if (this.clock && finiteWall(wall)) {
      this.clock.pause(wall);
    }
  }

  _startClock(wall) {
    if (this.clock && finiteWall(wall)) {
      this.clock.start(wall);
    }
  }

  _resumeClock(wall) {
    if (this.clock && finiteWall(wall)) {
      this.clock.resume(wall);
    }
  }

  _invalidate(reason) {
    this._generation += 1;
    this._countdown = null;
    this._clearPressed();
    this._clearGameInputs();
    this.onInvalidate({ reason, matchId: this.matchId, generation: this._generation });
  }

  _beginCountdown(mode, wall, resume = false, gameStarted = resume) {
    const generation = this._generation;
    this.lastPresentedWall = wall;
    this._countdown = {
      mode,
      resume,
      gameStarted: !!gameStarted,
      generation,
      startedAt: wall,
      shown: 3,
    };
    this._emitState(resume ? SESSION_STATES.RESUME_COUNTDOWN : SESSION_STATES.COUNTDOWN, {
      count: 3,
    });
    this.onCountdown(3, {
      state: this.state,
      mode,
      matchId: this.matchId,
      generation,
    });
  }

  _activate(mode, wall, resume, generation) {
    if (generation !== this._generation || !this._countdown) return false;
    const countdown = this._countdown;
    this._countdown = null;
    if (resume && countdown.gameStarted) {
      this._resumeClock(wall);
      this._resumeGame();
    } else {
      this._startClock(wall);
      if (this.game) this.game.start(mode);
    }
    this.mode = mode;
    this.lastPresentedWall = wall;
    if (this.game && this.game.roundId != null) this.roundId = this.game.roundId;
    const next = mode === 'practice' ? SESSION_STATES.PRACTICE : SESSION_STATES.PLAYING;
    this._emitState(next, { resumed: resume });
    this.onCountdown(0, {
      state: next,
      mode,
      matchId: this.matchId,
      generation,
    });
    this.onStart(mode, {
      state: next,
      resumed: resume,
      matchId: this.matchId,
      generation,
      roundId: this.roundId,
    });
    return true;
  }

  /** Begin a normal match at a 3-2-1 countdown. */
  start(mode = 'normal', wall = this.wallNow()) {
    if (!finiteWall(wall)) return false;
    if (mode !== 'normal' && mode !== 'practice') mode = 'normal';
    const allowed = mode === 'practice'
      ? this.state === SESSION_STATES.HOWTO
      : [SESSION_STATES.HOME, SESSION_STATES.RESULT, SESSION_STATES.PAUSED].includes(this.state);
    if (!allowed || !this.environmentReady()) return false;
    this._invalidate('start');
    this._stopGame();
    this.matchId += 1;
    this.roundId = null;
    this.mode = mode;
    this.result = null;
    this.pauseReason = null;
    this.resumeState = null;
    this.resumeGameStarted = mode === 'practice';
    this.lastPresentedWall = wall;
    if (mode === 'practice') {
      // Optional practice starts immediately from HOWTO. It is still on the
      // same rAF/game clock and receives the same pause/stall handling.
      this._countdown = { mode, resume: false, generation: this._generation, startedAt: wall, shown: 0 };
      return this._activate(mode, wall, false, this._generation);
    }
    this._beginCountdown(mode, wall, false);
    return true;
  }

  /** A menu action that explicitly enters one of the non-play screens. */
  navigate(next, wall = this.wallNow()) {
    if (![SESSION_STATES.HOME, SESSION_STATES.HOWTO, SESSION_STATES.SETTINGS].includes(next)) return false;
    if (this.isActive || this.state === SESSION_STATES.PAUSED) this.home(wall);
    this._emitState(next);
    return true;
  }

  /** Stop the current match and invalidate callbacks from it. */
  home(wall = this.wallNow()) {
    this._invalidate('home');
    this._pauseClock(wall);
    this._stopGame();
    this.mode = null;
    this.roundId = null;
    this.result = null;
    this.pauseReason = null;
    this.resumeState = null;
    this.resumeGameStarted = false;
    this.lastPresentedWall = wall;
    this.matchId += 1;
    this._emitState(SESSION_STATES.HOME);
    return true;
  }

  /**
   * Pause any countdown or play state. Hidden/pagehide/orientation calls use
   * the same method, so returning to the page never starts a match silently.
   */
  pause(reason = 'manual', {
    wall = this.wallNow(),
    discardInputs = false,
    presentedWall = null,
  } = {}) {
    if (!this.isActive) return false;
    if (!finiteWall(wall)) return false;
    const previousPresented = this.lastPresentedWall;
    const stalled = previousPresented != null && wall - previousPresented > this.stallThresholdMs;
    const wasPlaying = this.state === SESSION_STATES.PLAYING || this.state === SESSION_STATES.PRACTICE;
    const longGap = stalled;
    // For a normal pause, first drain the exact current game-clock horizon so
    // pending input at that horizon can win over an equal timeout. A long gap
    // is a stop boundary: freeze at the last presented frame and discard the
    // undelivered queue without fast-forwarding the game.
    if (wasPlaying && !longGap) {
      const horizon = this.clock && typeof this.clock.now === 'function' ? this.clock.now(wall) : null;
      if (horizon != null && this.game) this.game.update(horizon);
      if (!this.isActive) return false;
    }
    this.resumeState = this.state;
    this.resumeGameStarted = wasPlaying || !!this._countdown?.gameStarted;
    this.pauseReason = reason;
    this._generation += 1;
    this._countdown = null;
    const freezeAt = longGap
      ? previousPresented
      : (finiteWall(presentedWall) ? presentedWall : wall);
    this._pauseClock(freezeAt);
    if (this.resumeGameStarted) this._pauseGame(longGap || discardInputs);
    if (longGap || discardInputs) this._clearGameInputs();
    this._clearPressed();
    this._emitState(SESSION_STATES.PAUSED, {
      reason,
      resumeState: this.resumeState,
      discardInputs: !!discardInputs,
    });
    this.onPause({ reason, matchId: this.matchId, generation: this._generation });
    return true;
  }

  pauseForEnvironment(reason = 'hidden', wall = this.wallNow()) {
    return this.pause(reason, { wall, discardInputs: reason === 'stall' });
  }

  /** Explicit user resume. It always inserts a fresh 3-2-1 countdown. */
  resume(wall = this.wallNow()) {
    if (this.state !== SESSION_STATES.PAUSED || !finiteWall(wall) || !this.environmentReady()) return false;
    const mode = this.mode || (this.resumeState === SESSION_STATES.PRACTICE ? 'practice' : 'normal');
    this._generation += 1;
    this.pauseReason = null;
    this._beginCountdown(mode, wall, true, this.resumeGameStarted);
    return true;
  }

  /** Called by main before drawing a frame; returns true if a stall paused us. */
  observeFrame(wall) {
    if (!finiteWall(wall)) return { stalled: false, previous: this.lastPresentedWall };
    const previous = this.lastPresentedWall;
    if (previous == null || wall - previous <= this.stallThresholdMs || !this.isActive) {
      this.lastPresentedWall = wall;
      return { stalled: false, previous };
    }
    this.pause('stall', {
      wall,
      presentedWall: previous,
      discardInputs: true,
    });
    // Keep the frozen frame as the reference for diagnostics. Subsequent
    // frames are paused and therefore do not create another stall transition.
    this.lastPresentedWall = wall;
    return { stalled: true, previous, wall };
  }

  /** Advance countdown and issue at most one transition per rAF sample. */
  tick(wall = this.wallNow()) {
    if (!finiteWall(wall)) return false;
    if (this.state === SESSION_STATES.PLAYING || this.state === SESSION_STATES.PRACTICE) {
      if (!this.environmentReady()) {
        this.pause('environment', { wall });
        return false;
      }
      return true;
    }
    if (!this._countdown || (this.state !== SESSION_STATES.COUNTDOWN
      && this.state !== SESSION_STATES.RESUME_COUNTDOWN)) return false;
    if (!this.environmentReady()) {
      this.pause('environment', { wall });
      return false;
    }
    const countdown = this._countdown;
    if (countdown.generation !== this._generation) return false;
    const elapsed = Math.max(0, wall - countdown.startedAt);
    const next = Math.max(1, 3 - Math.floor(elapsed / this.countdownStepMs));
    if (next !== countdown.shown && elapsed < this.countdownStepMs * 3) {
      countdown.shown = next;
      this.onCountdown(next, {
        state: this.state,
        mode: countdown.mode,
        matchId: this.matchId,
        generation: this._generation,
      });
    }
    if (elapsed >= this.countdownStepMs * 3) {
      return this._activate(countdown.mode, wall, countdown.resume, countdown.generation);
    }
    return true;
  }

  /** Guard game-over callbacks against a previous match or stale transition. */
  finish(data, roundId = this.roundId) {
    if (!(this.state === SESSION_STATES.PLAYING || this.state === SESSION_STATES.PRACTICE)) return false;
    if (roundId != null && this.roundId != null && roundId !== this.roundId) return false;
    this._generation += 1;
    this._countdown = null;
    this._pauseClock(this.wallNow());
    this._clearGameInputs();
    this._clearPressed();
    this.result = data;
    if (data && data.practiceDone) {
      // 任意練習は本番や結果へ暗黙に進めず、遊び方へ戻す。
      this._emitState(SESSION_STATES.HOWTO, { practiceDone: true });
      return true;
    }
    this._emitState(SESSION_STATES.RESULT, { result: data });
    this.onResult(data, {
      matchId: this.matchId,
      roundId: this.roundId,
      generation: this._generation,
    });
    return true;
  }

  handleVisibility(hidden, wall = this.wallNow()) {
    if (hidden) return this.pauseForEnvironment('hidden', wall);
    return false;
  }

  handlePageHide(wall = this.wallNow()) {
    return this.pauseForEnvironment('pagehide', wall);
  }

  handleOrientation(isPortrait, wall = this.wallNow()) {
    if (!isPortrait) return this.pauseForEnvironment('orientation', wall);
    return false;
  }
}
