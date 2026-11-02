import { createSubmissionId, validSubmissionId, queueResult, acknowledgeResult, isAcknowledged } from "./outbox.js";
const GAME = "paripari";
const VERSION = "paripari-20261031-common";
const inflight = new Map();
const sent = new Map();
const payloads = new Map();
const starts = new Map();

export function createRun(rawName, uuid = createSubmissionId) {
  const name = Array.from(
    String(rawName)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim(),
  )
    .slice(0, 20)
    .join("");
  return Object.freeze({
    name,
    startId: uuid(),
    submissionId: uuid(),
    clientVersion: VERSION,
  });
}
const isInt4 = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
function accepted(value, table = false) {
  if (table ? !Array.isArray(value) || value.length !== 1 : Array.isArray(value)) throw new Error("Ranking response is malformed");
  const result = table ? value[0] : value;
  if (result?.accepted !== true) throw new Error("Ranking request was rejected");
  return result;
}
export async function startRun(run, rpc) {
  if (!run.name) return null;
  if (!run.startId || !run.submissionId)
    throw Error("Secure receipt ID is unavailable");
  if (!starts.has(run.startId)) {
    const request = rpc("start_game_play_v1", {
      p_start_id: run.startId,
      p_display_name: run.name,
      p_game_slug: GAME,
      p_client_version: run.clientVersion ?? "paripari-20261031-common",
    })
      .then(value => {
        const result = accepted(value);
        if (!validSubmissionId(result.play_id) || result.start_id !== run.startId || result.display_name !== run.name || result.normalized_name !== run.name || typeof result.duplicate !== 'boolean' || result.game_slug !== GAME || result.client_version !== (run.clientVersion ?? VERSION)) throw Error('Ranking start response is malformed');
        return result;
      })
      .catch((error) => {
        starts.delete(run.startId);
        throw error;
      });
    starts.set(run.startId, request);
    // Reopening an evicted entry remains safe: the server owns idempotency.
    if (starts.size > 64) starts.delete(starts.keys().next().value);
  }
  return starts.get(run.startId);
}
export async function submitRun(run, score, rpc) {
  if (!run?.name) return;
  const fingerprint = JSON.stringify([run.name,run.startId,run.submissionId,run.clientVersion,score]);
  if (payloads.has(run.submissionId) && payloads.get(run.submissionId) !== fingerprint) throw Error('Receipt conflict');
  if (sent.has(run.submissionId)) {
    if (sent.get(run.submissionId) !== fingerprint) throw Error('Receipt conflict');
    return;
  }
  payloads.set(run.submissionId, fingerprint);
  if (inflight.has(run.submissionId)) return inflight.get(run.submissionId);
  const task = (async () => {
    const start = await startRun(run, rpc);
    const payload = {
      p_play_id: start.play_id,
      p_display_name: run.name,
      p_game_slug: GAME,
      p_client_version: run.clientVersion ?? "paripari-20261031-common",
    };
    const finished = accepted(
      await rpc("finish_game_play_v1", {
        ...payload,
        p_result_type: "game_over",
        p_reached_wave: 1,
        p_score: score,
        p_ranking_score: score,
      }),
    );
    if (finished.play_id !== start.play_id || finished.game_slug !== GAME || finished.result_type !== 'game_over' || finished.reached_wave !== 1 || finished.score !== score || typeof finished.duplicate !== 'boolean') throw Error('Ranking finish response is malformed');
    const submitted = accepted(
      await rpc("submit_score_idempotent_v1", {
        ...payload,
        p_submission_id: run.submissionId,
        p_score: score,
      }), true,
    );
    if (submitted.result_submission_id !== run.submissionId || submitted.result_play_id !== start.play_id || typeof submitted.was_duplicate !== 'boolean' || submitted.result_normalized_name !== run.name || (typeof submitted.result_display_name !== 'string' || !submitted.result_display_name.trim() || Array.from(submitted.result_display_name).length > 20 || (submitted.was_duplicate === false && submitted.result_display_name !== run.name)) || !isInt4(submitted.result_first_score) || !isInt4(submitted.result_best_score) || !isInt4(submitted.result_play_count) || submitted.result_play_count < 1 || typeof submitted.is_first_play !== 'boolean' || typeof submitted.is_new_best !== 'boolean') throw Error('Ranking submission response is malformed');
    sent.set(run.submissionId, fingerprint);
    starts.delete(run.startId);
    if (sent.size > 1000) sent.delete(sent.keys().next().value);
  })();
  inflight.set(run.submissionId, task);
  try {
    await task;
  } finally {
    inflight.delete(run.submissionId);
    payloads.delete(run.submissionId);
  }
}
export async function loadTopRanking(rpc) {
  const rows = await rpc("get_best_score_ranking", { p_game_slug: GAME, p_limit: 30 });
  if (!Array.isArray(rows) || rows.some(row => !row || !Number.isSafeInteger(row.rank_no) || row.rank_no < 1 || typeof row.display_name !== 'string' || !Number.isSafeInteger(row.best_score)))
    throw Error('Ranking response is malformed');
  return rows.slice(0, 30);
}


// Durable, exact play receipt precedes every public result request.
export async function submitSavedResult(storage, run, result, rpc) {
  if (!run?.name) return;
  queueResult(storage, run, result);
  if (isAcknowledged(storage, run.submissionId)) return;
  await submitRun(run, result.score, rpc);
  acknowledgeResult(storage, run.submissionId, {run,result});
}
