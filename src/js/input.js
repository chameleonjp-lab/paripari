// 入力正規化（pointer/touch/key）と時刻記録 要件 §6.2 §6.3
// 方向ボタンの押下を {dir, time} で通知する。

// PC補助: 受け流し方向（=ボタン）に対応。L/R/D と斜め下DL/DR。
const KEY_DIR = {
  ArrowLeft: 'L', a: 'L', A: 'L',
  ArrowRight: 'R', d: 'R', D: 'R',
  ArrowDown: 'D', s: 'D', S: 'D',
  q: 'DL', Q: 'DL', z: 'DL', Z: 'DL',
  e: 'DR', E: 'DR', c: 'DR', C: 'DR',
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

function isEditingTarget(target) {
  const el = target && target.nodeType === 1 ? target : target?.parentElement;
  if (!el) return false;
  return !!(el.closest && el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

export function setupInput({ onAction, onFirstGesture, canHandleAction = () => true }) {
  let firstGestureDone = false;
  let composing = false;
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
    // 名前欄・設定欄・編集可能要素・IME変換中の操作をゲームが奪わない。
    if (composing || e.isComposing || e.keyCode === 229 || isEditingTarget(e.target)) return;
    // メニューやカウントダウン中も、ブラウザ標準のキー操作を止めない。
    if (!canHandleAction()) return;
    e.preventDefault();
    fireFirst();
    onAction({ dir, time: e.timeStamp || performance.now() });
  });

  window.addEventListener('compositionstart', () => { composing = true; });
  window.addEventListener('compositionend', () => { composing = false; });

  // 画面遷移・タブ切替の途中で見た目の押下状態を残さない。
  const clearPressed = () => buttons.forEach((btn) => btn.classList.remove('pressed'));
  window.addEventListener('blur', clearPressed);
  document.addEventListener('visibilitychange', clearPressed);

  // 任意の最初のタッチでも音声初期化フックを発火
  window.addEventListener(downEvent, fireFirst, { passive: true, once: false });
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
