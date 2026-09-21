// 入力正規化（pointer/touch/key）と時刻記録 要件 §6.2 §6.3
// 方向ボタンの押下を {dir, time} で通知する。
//
// 入力はゲーム時間を進めず、イベントの生の timeStamp をそのまま共通
// GameClock へ渡す。0、負値、非有限値、古い試合の時刻をどう扱うかは
// GameClock.mapInput の責務であり、この層で現在時刻へ置き換えない。

// PC補助: 受け流し方向（=ボタン）に対応。L/R/D と斜め下DL/DR。
const KEY_DIR = {
  ArrowLeft: 'L', a: 'L', A: 'L',
  ArrowRight: 'R', d: 'R', D: 'R',
  ArrowDown: 'D', s: 'D', S: 'D',
  q: 'DL', Q: 'DL', z: 'DL', Z: 'DL',
  e: 'DR', E: 'DR', c: 'DR', C: 'DR',
};

const EDITABLE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
].join(', ');

function rawEventTime(event) {
  return event ? event.timeStamp : undefined;
}

function targetElement(target) {
  if (!target) return null;
  if (target.nodeType === 1) return target;
  return target.parentElement || null;
}

function isEditingTarget(target) {
  const el = targetElement(target);
  if (!el) return false;
  if (el.isContentEditable) return true;
  return !!(el.closest && el.closest(EDITABLE_SELECTOR));
}

function eventPointerId(event, prefix = 'pointer') {
  const rawId = event && event.pointerId;
  const id = Number(rawId);
  if (rawId != null && Number.isFinite(id)) return `${prefix}:${id}`;
  return `${prefix}:primary`;
}

function touchIdentifier(touch) {
  const rawId = touch && touch.identifier;
  const id = Number(rawId);
  return rawId != null && Number.isFinite(id) ? `touch:${id}` : 'touch:primary';
}

function touchPoints(event) {
  const changed = event && event.changedTouches;
  if (changed && typeof changed.length === 'number' && changed.length > 0) {
    return Array.from(changed);
  }
  const touches = event && event.touches;
  if (touches && typeof touches.length === 'number' && touches.length > 0) {
    return [touches[0]];
  }
  // Synthetic fallback events used by simple WebViews/tests do not always
  // populate TouchList. One event still represents one primary press.
  return [null];
}

function pointInside(element, point, event) {
  if (!element) return false;
  // Coordinates are authoritative. Pointer capture/implicit touch capture can
  // leave event.target pointing at the original button after the pointer has
  // already moved outside it.
  const x = Number(point && point.clientX);
  const y = Number(point && point.clientY);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    if (typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect();
      if (rect && Number.isFinite(rect.left) && Number.isFinite(rect.right)
        && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)) {
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      }
    }
    if (typeof document !== 'undefined' && typeof document.elementFromPoint === 'function') {
      const atPoint = document.elementFromPoint(x, y);
      return !!(atPoint && (atPoint === element || (element.contains && element.contains(atPoint))));
    }
    return false;
  }

  const target = event && targetElement(event.target);
  return !!(target && (target === element || (element.contains && element.contains(target))));
}

// タップ位置に波紋を発生（操作フィードバック）。演出の失敗が入力を壊さない
// ように、DOM APIが制限された埋め込み環境では静かに諦める。
function spawnRipple(btn, event, point = null) {
  if (!btn || typeof btn.getBoundingClientRect !== 'function'
    || typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  const rect = btn.getBoundingClientRect();
  const pt = point || (event && event.touches && event.touches[0]) || event || {};
  const x = (pt.clientX != null ? pt.clientX : rect.left + rect.width / 2) - rect.left;
  const y = (pt.clientY != null ? pt.clientY : rect.top + rect.height / 2) - rect.top;
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.left = x + 'px';
  span.style.top = y + 'px';
  btn.appendChild(span);
  const remove = () => { if (span.parentNode) span.remove(); };
  span.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 600);
}

function safeCanHandleAction(canHandleAction, context) {
  try {
    return canHandleAction(context) !== false;
  } catch (_) {
    // Treat an unavailable game/session as inactive. This also keeps standard
    // button behavior available while a screen transition is in flight.
    return false;
  }
}

export function setupInput({
  onAction,
  onFirstGesture,
  canHandleAction = () => true,
} = {}) {
  let firstGestureDone = false;
  let composing = false;
  const buttons = Array.from(document.querySelectorAll('[data-dir]'));
  const pointerSupported = 'PointerEvent' in window;
  const downEvent = pointerSupported ? 'pointerdown' : 'touchstart';
  const upEvent = pointerSupported ? 'pointerup' : 'touchend';
  const cancelEvent = pointerSupported ? 'pointercancel' : 'touchcancel';
  const activePresses = new Map();
  const listeners = [];

  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };

  const fireFirst = (event) => {
    if (firstGestureDone) return;
    firstGestureDone = true;
    if (typeof onFirstGesture === 'function') onFirstGesture(event);
  };

  const removePressedClass = (button) => {
    if (button && button.classList) button.classList.remove('pressed');
  };

  const clearPressed = () => {
    activePresses.clear();
    buttons.forEach(removePressedClass);
  };

  const releasePress = (id, button = null) => {
    const held = activePresses.get(id);
    if (!held) {
      removePressedClass(button);
      return;
    }
    activePresses.delete(id);
    // Another finger/pointer may still be holding the same direction button.
    if (!Array.from(activePresses.values()).some((entry) => entry.button === held.button)) {
      removePressedClass(held.button);
    }
  };

  const actionContext = (dir, event, source, pointerId = null) => ({
    dir,
    event,
    source,
    pointerId,
  });

  const dispatchAction = (dir, event, source, pointerId = null, button = null, point = null, alreadyAllowed = false) => {
    const context = actionContext(dir, event, source, pointerId);
    if (!alreadyAllowed && !safeCanHandleAction(canHandleAction, context)) return false;

    // The timestamp is intentionally attached before the callback. Game code
    // may enqueue it for a watermarked clock; it must not be replaced by the
    // rAF time at which the callback happens.
    const time = rawEventTime(event);
    // Keep the historical callback shape stable. Source/pointer identity is
    // used internally only for duplicate suppression; the common clock owns
    // delivery timing from this raw {dir, time} record.
    const payload = { dir, time };
    if (button) {
      button.classList.add('pressed');
      spawnRipple(button, event, point);
    }
    if (typeof onAction === 'function') onAction(payload);
    return true;
  };

  const pointerDown = (event) => {
    if (event && event.button != null && event.button !== 0) return;
    const button = event && event.currentTarget;
    const dir = button && button.getAttribute('data-dir');
    if (!button || !dir) return;
    const id = eventPointerId(event);
    // Some browsers/tests can surface the same pointerdown twice. One active
    // pointer ID is one logical press until up/cancel/clearPressed.
    if (activePresses.has(id)) return;
    if (!safeCanHandleAction(canHandleAction, actionContext(dir, event, 'pointer', id))) return;
    event.preventDefault();
    fireFirst(event);
    activePresses.set(id, { button });
    dispatchAction(dir, event, 'pointer', id, button, null, true);
  };

  const touchStart = (event) => {
    const button = event && event.currentTarget;
    const dir = button && button.getAttribute('data-dir');
    if (!button || !dir) return;
    for (const point of touchPoints(event)) {
      const id = touchIdentifier(point);
      if (activePresses.has(id)) continue;
      if (!safeCanHandleAction(canHandleAction, actionContext(dir, event, 'touch', id))) continue;
      event.preventDefault();
      fireFirst(event);
      activePresses.set(id, { button });
      dispatchAction(dir, event, 'touch', id, button, point, true);
    }
  };

  buttons.forEach((button) => {
    // A button's click is deliberately not used as a game action. Browsers
    // may synthesize it after pointer/touch input; leaving it unhandled keeps
    // menu/button click behavior intact and prevents duplicate dispatch.
    listen(button, downEvent, pointerSupported ? pointerDown : touchStart, { passive: false });
    listen(button, upEvent, (event) => {
      if (pointerSupported) releasePress(eventPointerId(event));
      else touchPoints(event).forEach((point) => releasePress(touchIdentifier(point)));
    });
    listen(button, cancelEvent, (event) => {
      if (pointerSupported) releasePress(eventPointerId(event));
      else touchPoints(event).forEach((point) => releasePress(touchIdentifier(point)));
    });

    if (pointerSupported) {
      // pointerleave is the reliable signal when a pointer exits a button's
      // hit area. It also covers a pointer that moves to another control.
      listen(button, 'pointerleave', (event) => releasePress(eventPointerId(event), button));
    }
  });

  // Release even when up/cancel lands outside the original button. This is
  // common when a finger leaves the viewport or a pointer is captured by a
  // browser chrome element.
  if (pointerSupported) {
    listen(window, 'pointerup', (event) => releasePress(eventPointerId(event)));
    listen(window, 'pointercancel', (event) => releasePress(eventPointerId(event)));
    listen(window, 'pointermove', (event) => {
      const id = eventPointerId(event);
      const held = activePresses.get(id);
      if (held && (!pointInside(held.button, event, event) || event.buttons === 0)) {
        releasePress(id, held.button);
      }
    }, { passive: true });
  } else {
    listen(window, 'touchend', (event) => touchPoints(event).forEach((point) => releasePress(touchIdentifier(point))));
    listen(window, 'touchcancel', (event) => touchPoints(event).forEach((point) => releasePress(touchIdentifier(point))));
    listen(window, 'touchmove', (event) => {
      for (const point of touchPoints(event)) {
        const id = touchIdentifier(point);
        const held = activePresses.get(id);
        if (held && !pointInside(held.button, point, event)) releasePress(id, held.button);
      }
    }, { passive: true });
  }

  // Keyboard (PC). Editing/IME checks happen before canHandleAction so the
  // browser retains cursor movement and menu semantics in all non-game states.
  const keydown = (event) => {
    if (event.defaultPrevented || event.repeat) return;
    const dir = KEY_DIR[event.key];
    if (!dir) return;
    if (composing || event.isComposing || event.keyCode === 229 || isEditingTarget(event.target)) return;
    if (!safeCanHandleAction(canHandleAction, actionContext(dir, event, 'key', null))) return;
    event.preventDefault();
    fireFirst(event);
    if (typeof onAction === 'function') {
      onAction({ dir, time: rawEventTime(event) });
    }
  };
  listen(window, 'keydown', keydown);
  listen(window, 'compositionstart', () => { composing = true; });
  listen(window, 'compositionend', () => { composing = false; });

  // Any leave/visibility/orientation transition invalidates a visual pressed
  // state. Session transitions can call the returned clearPressed directly.
  listen(window, 'blur', clearPressed);
  listen(window, 'pagehide', clearPressed);
  listen(window, 'orientationchange', clearPressed);
  listen(window, 'resize', clearPressed);
  listen(document, 'visibilitychange', clearPressed);

  // 任意の最初のタッチでも音声初期化フックを発火。これはゲーム入力を
  // 発生させず、メニューの通常操作も妨げない。
  listen(window, downEvent, fireFirst, { passive: true });

  const destroy = () => {
    clearPressed();
    listeners.splice(0).forEach((remove) => remove());
  };

  return { clearPressed, destroy };
}

// ゲーム領域のズーム/スクロール/バウンス抑止（要件 §6.3 §6.4）。
// メニューや名前・共有欄にはリスナーを付けず、編集とスクロールを妨げない。
export function lockGestures({ targets = [], isEnabled = () => true } = {}) {
  const gestureTargets = Array.from(targets).filter(Boolean);
  let lastTouchEnd = 0;
  const options = { passive: false };

  gestureTargets.forEach((target) => {
    // ダブルタップズーム抑止
    target.addEventListener('touchend', (e) => {
      if (!isEnabled()) { lastTouchEnd = 0; return; }
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    }, options);

    // iOS系のピンチジェスチャー抑止
    target.addEventListener('gesturestart', (e) => {
      if (isEnabled()) e.preventDefault();
    }, options);
    target.addEventListener('gesturechange', (e) => {
      if (isEnabled()) e.preventDefault();
    }, options);

    // タッチ操作中のピンチ/バウンスだけ抑止し、通常のメニュー移動は残す。
    target.addEventListener('touchmove', (e) => {
      if (isEnabled() && e.scale && e.scale !== 1) e.preventDefault();
    }, options);
  });
}
