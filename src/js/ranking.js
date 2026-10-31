import { createSubmissionId } from "./outbox.js";
const GAME = "paripari";
const VERSION = "paripari-20261031-common";
const inflight = new Map();
const sent = new Set();
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
function accepted(value) {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result?.accepted) throw new Error("Ranking request was rejected");
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
      .then(accepted)
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
  if (!run?.name || sent.has(run.submissionId)) return;
  if (inflight.has(run.submissionId)) return inflight.get(run.submissionId);
  const task = (async () => {
    const start = await startRun(run, rpc);
    const payload = {
      p_play_id: start.play_id,
      p_display_name: run.name,
      p_game_slug: GAME,
      p_client_version: run.clientVersion ?? "paripari-20261031-common",
    };
    accepted(
      await rpc("finish_game_play_v1", {
        ...payload,
        p_result_type: "game_over",
        p_reached_wave: 1,
        p_score: score,
        p_ranking_score: score,
      }),
    );
    accepted(
      await rpc("submit_score_idempotent_v1", {
        ...payload,
        p_submission_id: run.submissionId,
        p_score: score,
      }),
    );
    sent.add(run.submissionId);
    starts.delete(run.startId);
    if (sent.size > 1000) sent.delete(sent.values().next().value);
  })();
  inflight.set(run.submissionId, task);
  try {
    await task;
  } finally {
    inflight.delete(run.submissionId);
  }
}
export function loadTopRanking(rpc) {
  return rpc("get_best_score_ranking", { p_game_slug: GAME, p_limit: 30 });
}
