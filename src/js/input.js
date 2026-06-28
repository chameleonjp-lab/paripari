// 入力正規化（pointer/touch/key）と時刻記録 要件 §6.2 §6.3
// 方向ボタンの押下を {dir, time} で通知する。

const KEY_DIR = {
  ArrowLeft: 'L', a: 'L', A: 'L',
  ArrowRight: 'R', d: 'R', D: 'R',
  ArrowUp: 'U', w: 'U', W: 'U',
  ArrowDown: 'D', s: 'D', S: 'D',
};

// タップ位置に波紋を発生（操作フィードバック）
function spawnRipple(btn, e) {
  const rect = btn.getBoundingClientRect();
  const pt = (e.touches && e.touches[0]) || e;
  const x = (pt.clientX != null ? pt.clientX : rect.left + rect.width / 2) - rect.left;
  const y = (pt.clientY != null ? pt.clientY : rect.top + rect.height / 2) - rect.top;
  const span = document.createElement('span');
  span.className = 'ripple';
  span.style.left = x + 'px';
  span.style.top = y + 'px';
  btn.appendChild(span);
  span.addEventListener('animationend', () => span.remove());
  setTimeout(() => span.remove(), 600);
}

export function setupInput({ onAction, onFirstGesture }) {
  let firstGestureDone = false;
  const fireFirst = () => {
    if (firstGestureDone) return;
    firstGestureDone = true;
    onFirstGesture && onFirstGesture();
  };

  const buttons = document.querySelectorAll('[data-dir]');
  const pointerSupported = 'PointerEvent' in window;
  const downEvent = pointerSupported ? 'pointerdown' : 'touchstart';

  buttons.forEach((btn) => {
    btn.addEventListener(downEvent, (e) => {
      e.preventDefault();
      fireFirst();
      const dir = btn.getAttribute('data-dir');
      const time = (e.timeStamp && e.timeStamp > 0) ? e.timeStamp : performance.now();
      btn.classList.add('pressed');
      spawnRipple(btn, e);
      onAction({ dir, time });
    }, { passive: false });

    btn.addEventListener(pointerSupported ? 'pointerup' : 'touchend', () => {
      btn.classList.remove('pressed');
    });
    btn.addEventListener(pointerSupported ? 'pointercancel' : 'touchcancel', () => {
      btn.classList.remove('pressed');
    });
    btn.addEventListener('pointerleave', () => btn.classList.remove('pressed'));
  });

  // キーボード（PC）
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const dir = KEY_DIR[e.key];
    if (!dir) return;
    e.preventDefault();
    fireFirst();
    onAction({ dir, time: e.timeStamp || performance.now() });
  });

  // 任意の最初のタッチでも音声初期化フックを発火
  window.addEventListener(downEvent, fireFirst, { passive: true, once: false });
}

// ズーム/スクロール/バウンス抑止（要件 §6.3 §6.4）
export function lockGestures() {
  // ダブルタップズーム抑止
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  // ピンチズーム抑止
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('gesturechange', (e) => e.preventDefault());

  // スクロール/バウンス抑止
  document.addEventListener('touchmove', (e) => {
    if (e.scale && e.scale !== 1) e.preventDefault();
  }, { passive: false });
}
