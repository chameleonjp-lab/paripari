import {
  RANKING_CONFIG,
  SUPABASE_PUBLISHABLE_KEY,
} from './ranking-config.js';

export const RANKING_STATES = Object.freeze({
  idle: 'idle',
  starting: 'starting',
  submitting: 'submitting',
  submitted: 'submitted',
  retryableFailed: 'retryable_failed',
  permanentFailed: 'permanent_failed',
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RETRYABLE_REASONS = new Set([
  'play_rate_limited',
  'service_unavailable',
  'timeout',
  'network_error',
  'http_error',
]);

const clone = (value) => {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
};

const finiteInteger = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
};

const storageLike = (value) => value &&
  typeof value.getItem === 'function' &&
  typeof value.setItem === 'function' &&
  typeof value.removeItem === 'function'
  ? value
  : null;

const readGlobalStorage = () => {
  try {
    return storageLike(globalThis.localStorage);
  } catch {
    return null;
  }
};

const reasonFrom = (payload, fallback = 'ranking_request_failed') => {
  if (payload && typeof payload === 'object') {
    for (const key of ['reason', 'code', 'message', 'error']) {
      if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key].trim();
    }
  }
  return fallback;
};

const isRetryableReason = (reason) => RETRYABLE_REASONS.has(String(reason ?? '').toLowerCase());

export class RankingClientError extends Error {
  constructor(message, {
    code = 'ranking_request_failed',
    retryable = true,
    status = 0,
    payload = null,
  } = {}) {
    super(message);
    this.name = 'RankingClientError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
    this.payload = payload;
  }
}

export const createRequestId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new RankingClientError('このブラウザでは安全な開始IDを作成できません。', {
    code: 'uuid_unavailable',
    retryable: false,
  });
};

const requireUuid = (value, label) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new RankingClientError(`${label}が不正です。`, {
      code: 'invalid_uuid',
      retryable: false,
    });
  }
  return value;
};

const requireName = (value) => {
  if (typeof value !== 'string') {
    throw new RankingClientError('プレイヤー名が不正です。', {
      code: 'invalid_name',
      retryable: false,
    });
  }
  const name = value.trim();
  if (name.length < 1 || name.length > 20 || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
    throw new RankingClientError('プレイヤー名が不正です。', {
      code: 'invalid_name',
      retryable: false,
    });
  }
  return name;
};

const acceptedPayload = (payload, label) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RankingClientError(`${label}の応答形式が不正です。`, {
      code: 'invalid_response',
      retryable: true,
      payload,
    });
  }
  if (payload.accepted !== true) {
    const reason = reasonFrom(payload, `${label}_rejected`);
    throw new RankingClientError(`${label}を記録できませんでした。`, {
      code: reason,
      retryable: isRetryableReason(reason),
      payload,
    });
  }
  return payload;
};

export const normalizeRankingRows = (payload, limit = 10) => {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.slice(0, Math.max(0, Math.trunc(Number(limit) || 0))).map((row, index) => ({
    rankNo: Math.max(1, finiteInteger(row?.rank_no, index + 1)),
    name: typeof row?.display_name === 'string' && row.display_name.trim()
      ? row.display_name.trim()
      : '名無し',
    score: Math.max(0, finiteInteger(row?.best_score)),
    firstScore: Math.max(0, finiteInteger(row?.first_score)),
    playCount: Math.max(0, finiteInteger(row?.play_count)),
    updatedAt: typeof row?.updated_at === 'string' ? row.updated_at : '',
  }));
};

export const createPendingSubmissionStore = (
  storage = readGlobalStorage(),
  key = RANKING_CONFIG.pendingSubmissionStorageKey,
) => {
  const backend = storageLike(storage);
  let memory = null;
  let preferMemory = false;
  const read = () => {
    if (!backend || preferMemory) return clone(memory);
    try {
      const raw = backend.getItem(key);
      memory = raw ? JSON.parse(raw) : null;
    } catch {
      preferMemory = true;
    }
    return clone(memory);
  };
  const write = (value) => {
    memory = value && typeof value === 'object' ? clone(value) : null;
    if (backend) {
      try {
        if (memory) backend.setItem(key, JSON.stringify(memory));
        else backend.removeItem(key);
        preferMemory = false;
      } catch {
        preferMemory = true;
      }
    }
    return clone(memory);
  };
  return {
    key,
    load: read,
    save: write,
    clear: () => write(null),
  };
};

const responsePayload = async (response) => {
  if (!response || typeof response.json !== 'function') return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export const createRankingClient = ({
  config = RANKING_CONFIG,
  fetchImpl = null,
  storage = readGlobalStorage(),
  publishableKey = SUPABASE_PUBLISHABLE_KEY,
} = {}) => {
  const fetchFunction = fetchImpl ?? ((...args) => {
    if (typeof globalThis.fetch !== 'function') {
      throw new RankingClientError('通信機能を利用できません。', {
        code: 'fetch_unavailable',
        retryable: false,
      });
    }
    return globalThis.fetch(...args);
  });
  const pendingStore = createPendingSubmissionStore(storage, config.pendingSubmissionStorageKey);

  const requestRpc = async (rpcName, body) => {
    const url = `${config.rpcBaseUrl}/${encodeURIComponent(rpcName)}`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller
      ? globalThis.setTimeout(() => controller.abort(), config.timeoutMs)
      : null;
    let response;
    try {
      response = await fetchFunction(url, {
        method: 'POST',
        headers: {
          apikey: publishableKey,
          Authorization: `Bearer ${publishableKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      const aborted = error?.name === 'AbortError';
      throw new RankingClientError(
        aborted ? 'ランキング通信がタイムアウトしました。' : 'ランキング通信に失敗しました。',
        {
          code: aborted ? 'timeout' : 'network_error',
          retryable: true,
          payload: error?.message ?? null,
        },
      );
    } finally {
      if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    }
    const payload = await responsePayload(response);
    if (!response?.ok) {
      const reason = reasonFrom(payload, response?.status >= 500 ? 'service_unavailable' : 'http_error');
      throw new RankingClientError('ランキング通信が拒否されました。', {
        code: reason,
        status: response?.status ?? 0,
        retryable: response?.status === 408 || response?.status === 409
          || response?.status === 429 || response?.status >= 500,
        payload,
      });
    }
    return payload;
  };

  const startPlay = async ({ startId, displayName }) => {
    const safeStartId = requireUuid(startId, '開始ID');
    const safeName = requireName(displayName);
    const payload = await requestRpc(config.startRpc, {
      p_start_id: safeStartId,
      p_display_name: safeName,
      p_game_slug: config.gameSlug,
      p_client_version: config.clientVersion,
    });
    const accepted = acceptedPayload(payload, 'プレイ開始');
    const playId = requireUuid(accepted.play_id, 'プレイID');
    return {
      accepted: true,
      duplicate: accepted.duplicate === true,
      startId: safeStartId,
      playId,
      displayName: typeof accepted.display_name === 'string' ? accepted.display_name : safeName,
      normalizedName: typeof accepted.normalized_name === 'string' ? accepted.normalized_name : '',
    };
  };

  const finishPlay = async ({ playId, displayName, resultType, reachedWave, score }) => {
    const safePlayId = requireUuid(playId, 'プレイID');
    const safeName = requireName(displayName);
    const safeResultType = String(resultType ?? '').trim().toLowerCase();
    if (!['clear', 'game_over', 'retire'].includes(safeResultType)) {
      throw new RankingClientError('結果種別が不正です。', {
        retryable: false,
        code: 'invalid_result_type',
      });
    }
    const payload = await requestRpc(config.finishRpc, {
      p_play_id: safePlayId,
      p_display_name: safeName,
      p_game_slug: config.gameSlug,
      p_result_type: safeResultType,
      p_reached_wave: Math.max(1, finiteInteger(reachedWave, 1)),
      p_score: Math.max(0, finiteInteger(score)),
      p_client_version: config.clientVersion,
      p_ranking_score: safeResultType === 'game_over' || safeResultType === 'clear'
        ? Math.max(0, finiteInteger(score))
        : null,
    });
    return acceptedPayload(payload, 'プレイ結果');
  };

  const submitScore = async ({ playId, submissionId, displayName, score }) => {
    const safePlayId = requireUuid(playId, 'プレイID');
    const safeSubmissionId = requireUuid(submissionId, '送信ID');
    const safeName = requireName(displayName);
    const payload = await requestRpc(config.submitRpc, {
      p_play_id: safePlayId,
      p_submission_id: safeSubmissionId,
      p_display_name: safeName,
      p_game_slug: config.gameSlug,
      p_score: Math.max(0, finiteInteger(score)),
      p_client_version: config.clientVersion,
    });
    const row = Array.isArray(payload) ? payload[0] : payload;
    if (!row || row.accepted !== true) {
      const reason = reasonFrom(row, 'score_submission_rejected');
      throw new RankingClientError('スコアをランキングへ送信できませんでした。', {
        code: reason,
        retryable: isRetryableReason(reason),
        payload,
      });
    }
    return {
      accepted: true,
      submissionId: requireUuid(row.result_submission_id ?? safeSubmissionId, '送信ID'),
      playId: requireUuid(row.result_play_id ?? safePlayId, 'プレイID'),
      score: Math.max(0, finiteInteger(row.result_best_score ?? score)),
      playCount: Math.max(0, finiteInteger(row.result_play_count)),
      wasDuplicate: row.was_duplicate === true,
    };
  };

  const fetchTopRanking = async (limit = config.rankingLimit ?? 10) => {
    const safeLimit = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 10)));
    const payload = await requestRpc(config.rankingRpc, {
      p_game_slug: config.gameSlug,
      p_limit: safeLimit,
    });
    if (!Array.isArray(payload)) {
      throw new RankingClientError('ランキングの応答形式が不正です。', {
        code: 'invalid_ranking_response',
        retryable: true,
        payload,
      });
    }
    return normalizeRankingRows(payload, safeLimit);
  };

  return {
    config,
    startPlay,
    finishPlay,
    submitScore,
    fetchTopRanking,
    loadPendingSubmission: () => pendingStore.load(),
    savePendingSubmission: (value) => pendingStore.save(value),
    clearPendingSubmission: (submissionId = null) => {
      const current = pendingStore.load();
      if (!submissionId || current?.submissionId === submissionId) pendingStore.clear();
      return current;
    },
  };
};

export default createRankingClient;
