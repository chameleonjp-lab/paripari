import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRankingClient,
  createRequestId,
  normalizeRankingRows,
} from '../src/js/ranking-client.js';
import { RANKING_CONFIG } from '../src/js/ranking-config.js';

const START_ID = '11111111-1111-4111-8111-111111111111';
const PLAY_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';

function fakeStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function testConfig() {
  return {
    ...RANKING_CONFIG,
    rpcBaseUrl: 'https://example.test/rest/v1/rpc',
    pendingSubmissionStorageKey: 'paripari:test-ranking',
  };
}

test('ranking client follows the start -> finish -> submit -> ranking RPC contract', async () => {
  const calls = [];
  const client = createRankingClient({
    config: testConfig(),
    storage: fakeStorage(),
    publishableKey: 'sb_publishable_test',
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      if (url.endsWith('/start_game_play_v1')) {
        return response({ accepted: true, play_id: PLAY_ID, display_name: 'テスト太郎' });
      }
      if (url.endsWith('/finish_game_play_v1')) {
        return response({ accepted: true, play_id: PLAY_ID });
      }
      if (url.endsWith('/submit_score_idempotent_v1')) {
        return response([{
          accepted: true,
          result_play_id: PLAY_ID,
          result_submission_id: SUBMISSION_ID,
          result_best_score: 1234,
          result_play_count: 2,
          was_duplicate: false,
        }]);
      }
      return response([{ rank_no: 1, display_name: 'テスト太郎', best_score: 1234, play_count: 2 }]);
    },
  });

  const started = await client.startPlay({ startId: START_ID, displayName: 'テスト太郎' });
  assert.equal(started.playId, PLAY_ID);
  await client.finishPlay({
    playId: PLAY_ID,
    displayName: 'テスト太郎',
    resultType: 'game_over',
    reachedWave: 7,
    score: 1234,
  });
  const submitted = await client.submitScore({
    playId: PLAY_ID,
    submissionId: SUBMISSION_ID,
    displayName: 'テスト太郎',
    score: 1234,
  });
  const ranking = await client.fetchTopRanking(10);

  assert.deepEqual(calls.map(({ url }) => url.split('/').at(-1)), [
    'start_game_play_v1',
    'finish_game_play_v1',
    'submit_score_idempotent_v1',
    'get_best_score_ranking',
  ]);
  assert.equal(calls[0].options.headers.apikey, 'sb_publishable_test');
  assert.deepEqual(calls[0].body, {
    p_start_id: START_ID,
    p_display_name: 'テスト太郎',
    p_game_slug: 'paripari',
    p_client_version: RANKING_CONFIG.clientVersion,
  });
  assert.equal(calls[1].body.p_ranking_score, 1234);
  assert.equal(submitted.score, 1234);
  assert.deepEqual(ranking, [{
    rankNo: 1,
    name: 'テスト太郎',
    score: 1234,
    firstScore: 0,
    playCount: 2,
    updatedAt: '',
  }]);
});

test('ranking rows and pending records are normalized safely', () => {
  assert.deepEqual(normalizeRankingRows([
    { rank_no: 0, display_name: '', best_score: -8, first_score: 4.9, play_count: '3' },
    { rank_no: 2, display_name: '長い名前ではない', best_score: '900' },
  ], 1), [{
    rankNo: 1,
    name: '名無し',
    score: 0,
    firstScore: 4,
    playCount: 3,
    updatedAt: '',
  }]);

  const storage = fakeStorage();
  const client = createRankingClient({ config: testConfig(), storage, fetchImpl: async () => response([]) });
  const pending = { version: 1, stage: 'submit', submissionId: SUBMISSION_ID, score: 1234 };
  client.savePendingSubmission(pending);
  assert.deepEqual(client.loadPendingSubmission(), pending);
  client.clearPendingSubmission('44444444-4444-4444-8444-444444444444');
  assert.deepEqual(client.loadPendingSubmission(), pending);
  client.clearPendingSubmission(SUBMISSION_ID);
  assert.equal(client.loadPendingSubmission(), null);
});

test('request failures are classified as retryable network errors', async () => {
  const client = createRankingClient({
    config: testConfig(),
    fetchImpl: async () => { throw new Error('offline'); },
  });
  await assert.rejects(
    client.fetchTopRanking(),
    (error) => error.code === 'network_error' && error.retryable === true,
  );
});

test('request IDs use UUID format', () => {
  assert.match(createRequestId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
});
