// カメレオンJP実験場の共有ランキング接続設定。
// ブラウザへ置くのは publishable key のみ。service role key は絶対に含めない。

export const SUPABASE_URL = 'https://mlpnjgezrnhdxsxolyzj.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM';

export const RANKING_CONFIG = Object.freeze({
  gameSlug: 'paripari',
  clientVersion: 'paripari-web-20260928-01',
  rpcBaseUrl: `${SUPABASE_URL}/rest/v1/rpc`,
  startRpc: 'start_game_play_v1',
  finishRpc: 'finish_game_play_v1',
  submitRpc: 'submit_score_idempotent_v1',
  rankingRpc: 'get_best_score_ranking',
  rankingLimit: 10,
  timeoutMs: 8_000,
  pendingSubmissionStorageKey: 'paripari:ranking-pending:v1',
});

export default RANKING_CONFIG;
