export const OUTBOX_KEY = "paripari.pending-submissions.v1";
const PREFIX = `${OUTBOX_KEY}:`;
export const validSubmissionId = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function createSubmissionId(cryptoObject = globalThis.crypto) {
  try {
    if (typeof cryptoObject?.randomUUID === "function")
      return cryptoObject.randomUUID();
  } catch {
    /* Try the older secure API. */
  }
  try {
    if (typeof cryptoObject?.getRandomValues !== "function") return null;
    const bytes = cryptoObject.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}
function validEntry(entry) {
  return (
    validSubmissionId(entry?.run?.submissionId) &&
    typeof entry.run.name === "string" &&
    entry.run.name.trim() &&
    typeof entry.run.clientVersion === "string" &&
    Number.isSafeInteger(entry.result?.score) &&
    entry.result.score >= 0
  );
}
function legacyEntries(storage) {
  const raw = storage?.getItem(OUTBOX_KEY);
  if (raw == null) return [];
  const value = JSON.parse(raw);
  if (
    value?.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.some((entry) => !validEntry(entry))
  )
    throw Error("Unrecognized outbox; preserve stored data");
  return value.entries;
}
export function readOutbox(storage) {
  const entries = new Map(
    legacyEntries(storage).map((entry) => [entry.run.submissionId, entry]),
  );
  const keys = Array.from({ length: storage?.length ?? 0 }, (_, i) =>
    storage.key(i),
  );
  for (const key of keys) {
    if (
      !key?.startsWith(PREFIX) ||
      !validSubmissionId(key.slice(PREFIX.length))
    )
      continue;
    const raw = storage.getItem(key);
    if (raw == null) continue;
    const value = JSON.parse(raw),
      id = key.slice(PREFIX.length);
    if (value?.acknowledged === true) {
      entries.delete(id);
      continue;
    }
    if (!validEntry(value) || value.run.submissionId !== id)
      throw Error("Unrecognized receipt; preserve stored data");
    entries.set(id, value);
  }
  return [...entries.values()];
}
export function queueResult(storage, run, result) {
  if (!run.name || !validSubmissionId(run.submissionId)) return;
  if (!storage) throw Error("Storage unavailable");
  const key = PREFIX + run.submissionId;
  const existing = readOutbox(storage).find(
    (entry) => entry.run.submissionId === run.submissionId,
  );
  if (existing) {
    if (
      JSON.stringify(existing.run) !== JSON.stringify(run) ||
      existing.result.score !== result.score
    )
      throw Error("Receipt conflict");
    return;
  }
  // Each play owns one key. Concurrent tabs never rewrite another play's receipt.
  storage.setItem(key, JSON.stringify({ run, result }));
}
export function acknowledgeResult(storage, id) {
  if (!storage || !validSubmissionId(id)) return;
  // Keep old array data untouched. A per-ID tombstone acknowledges legacy entries.
  if (legacyEntries(storage).some((entry) => entry.run.submissionId === id))
    storage.setItem(PREFIX + id, JSON.stringify({ acknowledged: true }));
  else storage.removeItem(PREFIX + id);
}
