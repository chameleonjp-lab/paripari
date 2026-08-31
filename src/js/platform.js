const SUPABASE_URL = 'https://mlpnjgezrnhdxsxolyzj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM';

export function currentGameUrl() {
  return new URL(window.location.href).toString().split('#')[0];
}

export async function callRankingRpc(functionName, payload) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) throw new Error(`${functionName}: ${response.status}`);
  return data;
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[char]));
}

export async function shareOrCopy({ text, title, statusElement, textElement }) {
  statusElement.textContent = '';
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: currentGameUrl() });
      statusElement.textContent = '共有しました。';
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    statusElement.textContent = 'シェア文をコピーしました。';
  } catch (_) {
    textElement.value = text;
    textElement.focus();
    textElement.select();
    statusElement.textContent = 'シェア文を選択しました。コピーしてご利用ください。';
  }
}
