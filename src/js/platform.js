// 端末内のシェア補助。スコア送信・ランキング・外部APIは持ち込まない。
// 正式な公開URLは公開工程で確認するまで設定しない。
export const OFFICIAL_GAME_URL = '';

export function officialGameUrl() {
  return OFFICIAL_GAME_URL || null;
}

function setStatus(statusElement, message) {
  if (statusElement) statusElement.textContent = message;
}

/**
 * Web Share → クリップボード → 画面上の選択、の順で共有を試みる。
 * 共有キャンセルはエラー表示にせず、URL未確定時はurlフィールドを送らない。
 */
export async function shareOrCopy({ text, title, statusElement, textElement, url = officialGameUrl() }) {
  setStatus(statusElement, '');
  const shareText = String(text ?? '');

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const data = { title: title || 'パリパリ', text: shareText };
      // 本文に正式URLを含む共有文ではurlフィールドを重ねず、1回だけ渡す。
      if (url && !shareText.includes(url)) data.url = url;
      await navigator.share(data);
      setStatus(statusElement, '共有しました。');
      return 'shared';
    } catch (error) {
      // ユーザーのキャンセルは正常終了。別の共有方法へ自動で進めない。
      if (error && error.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(shareText);
      setStatus(statusElement, 'シェア文をコピーしました。');
      return 'copied';
    }
    throw new Error('clipboard unavailable');
  } catch {
    // 結果画面/ホームに現在見えている欄だけを選択し、隠し要素へ移動しない。
    if (textElement && typeof textElement.focus === 'function') {
      textElement.value = shareText;
      textElement.focus({ preventScroll: true });
      textElement.select();
      setStatus(statusElement, 'シェア文を選択しました。コピーしてご利用ください。');
      return 'selected';
    }
    setStatus(statusElement, 'シェア文を表示できませんでした。');
    return 'unavailable';
  }
}
