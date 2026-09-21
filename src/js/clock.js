// ゲームの時計。演出や描画回数では進めず、停止時間を除いた実時間を使う。
export const INPUT_DELAY_MS = 50;
export const STALL_THRESHOLD_MS = 250;

const validWallTime = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** DOMの押下時刻をperformance.now()と同じ基準へ写す。 */
export function normalizeEventTimestamp(raw, receivedWall, timeOrigin = globalThis.performance?.timeOrigin ?? 0) {
  if (!validWallTime(receivedWall)) return null;
  // 時刻を提供できない環境だけ配送時刻を代用する。古い値や未来の値は代用しない。
  if (raw == null || raw === 0 || (typeof raw === 'number' && !Number.isFinite(raw))) {
    return receivedWall;
  }
  if (typeof raw !== 'number' || raw < 0) return null;

  let time = raw;
  if (raw >= 1e12) {
    if (!validWallTime(timeOrigin) || timeOrigin === 0) return null;
    time -= timeOrigin;
  }
  return validWallTime(time) && time <= receivedWall ? time : null;
}

function requireWallTime(wall) {
  if (!validWallTime(wall)) throw new RangeError('時計には有効な単調時刻が必要です');
}

export class GameClock {
  constructor({ timeOrigin = globalThis.performance?.timeOrigin ?? 0 } = {}) {
    this.timeOrigin = timeOrigin;
    this.running = false;
    this._elapsed = 0;
    this._activeStart = 0;
  }

  start(wall) {
    requireWallTime(wall);
    this._elapsed = 0;
    this._activeStart = wall;
    this.running = true;
    return 0;
  }

  // サンプルするだけで状態を変更しない。長い途絶では最後の描画時刻を指定して停止できる。
  now(wall) {
    requireWallTime(wall);
    return this._elapsed + (this.running ? Math.max(0, wall - this._activeStart) : 0);
  }

  pause(wall) {
    requireWallTime(wall);
    if (this.running) {
      this._elapsed = this.now(wall);
      this.running = false;
    }
    return this._elapsed;
  }

  resume(wall) {
    requireWallTime(wall);
    if (!this.running) {
      this._activeStart = wall;
      this.running = true;
    }
    return this.now(wall);
  }

  /**
   * 現在の実行区間の入力だけをゲーム時刻へ変換する。
   * 再開前のイベント、停止中、保証を超える配送遅れは受け付けない。
   */
  mapInput(raw, receivedWall) {
    if (!this.running || !validWallTime(receivedWall)) return null;
    const eventWall = normalizeEventTimestamp(raw, receivedWall, this.timeOrigin);
    if (eventWall == null || eventWall < this._activeStart) return null;
    const delay = receivedWall - eventWall;
    if (delay < 0 || delay > INPUT_DELAY_MS) return null;
    return {
      time: this._elapsed + eventWall - this._activeStart,
      receivedAt: this.now(receivedWall),
    };
  }
}
