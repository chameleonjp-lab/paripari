export const OUTBOX_KEY = "paripari.pending-submissions.v1";
const PREFIX = `${OUTBOX_KEY}:`;
const unsaved = new WeakMap();
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
    !Array.isArray(value.entries)
  )
    throw Error("Unrecognized outbox; preserve stored data");
  return value.entries;
}
function sameEntry(a,b) {
 return ['name','startId','submissionId','clientVersion'].every(k=>a.run[k]===b.run[k]) && JSON.stringify(a.result)===JSON.stringify(b.result);
}
function scan(storage) {
 const entries=new Map(), blocked=new Set();
 const add=(entry)=>{
   if(!validEntry(entry)) { if(validSubmissionId(entry?.run?.submissionId))blocked.add(entry.run.submissionId); return; }
   const id=entry.run.submissionId;
   if(entries.has(id)&&!sameEntry(entries.get(id),entry))blocked.add(id);
   else entries.set(id,entry);
 };
 for(const entry of legacyEntries(storage))add(entry);
 const keys=Array.from({length:storage?.length??0},(_,i)=>storage.key(i));
 for(const key of keys){
   if(!key?.startsWith(PREFIX)||!validSubmissionId(key.slice(PREFIX.length)))continue;
   const id=key.slice(PREFIX.length), raw=storage.getItem(key); if(raw==null)continue;
   let value;try{value=JSON.parse(raw)}catch{blocked.add(id);continue}
   if(value?.acknowledged===true){entries.delete(id);blocked.add(id);continue}
   if(!validEntry(value)||value.run.submissionId!==id){blocked.add(id);continue}
   add(value);
 }
 for(const [id,entry] of unsaved.get(storage)??[])if(!blocked.has(id))add(entry);
 for(const id of blocked)entries.delete(id);
 return {entries,blocked};
}
export function readOutbox(storage) { return [...scan(storage).entries.values()]; }
export function queueResult(storage, run, result) {
  if (!run.name || !validSubmissionId(run.submissionId)) return;
  if (!storage) throw Error("Storage unavailable");
  const key = PREFIX + run.submissionId;
  const raw = storage.getItem(key);
  if (raw != null) {
    let value;
    try { value = JSON.parse(raw); } catch { throw Error("Receipt conflict; preserve stored data"); }
    if (value?.acknowledged === true) {
      if (!validEntry(value) || !sameEntry(value,{run,result})) throw Error("Receipt conflict");
      return;
    }
    if (!validEntry(value) || value.run.submissionId !== run.submissionId)
      throw Error("Receipt conflict; preserve stored data");
  }
  const scanned = scan(storage);
  if (scanned.blocked.has(run.submissionId)) throw Error("Receipt conflict");
  const existing = scanned.entries.get(run.submissionId);
  if (existing) {
    if (
      JSON.stringify(existing.run) !== JSON.stringify(run) ||
      existing.result.score !== result.score
    )
      throw Error("Receipt conflict");
    if (raw != null) return;
  }
  // Each play owns one key. Concurrent tabs never rewrite another play's receipt.
  const serialized = JSON.stringify({ run, result });
  if (!unsaved.has(storage)) unsaved.set(storage, new Map());
  unsaved.get(storage).set(run.submissionId, JSON.parse(serialized));
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw Error("Storage did not persist result");
  unsaved.get(storage).delete(run.submissionId);
}
export function acknowledgeResult(storage, id, expected = null) {
  if (!storage || !validSubmissionId(id)) return;
  // Keep both old array data and the exact acknowledged payload for recovery.
  const key = PREFIX + id;
  const raw = storage.getItem(key);
  let prior = null;
  if (raw != null) {
    try { prior = JSON.parse(raw); } catch { throw Error("Receipt conflict"); }
    if (expected && !sameEntry(prior, expected)) throw Error("Receipt conflict");
    if (prior?.acknowledged === true) return;
    if (!validEntry(prior) || prior.run.submissionId !== id) throw Error("Receipt conflict");
  }
  if (!prior) prior = legacyEntries(storage).find(entry => validEntry(entry) && entry.run.submissionId === id) ?? null;
  if (expected && (!prior || !sameEntry(prior,expected))) throw Error("Receipt conflict");
  const serialized = JSON.stringify({ ...(prior || {}), acknowledged: true });
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw Error("Storage did not persist acknowledgement");
}

export function isAcknowledged(storage, id) {
  try { return JSON.parse(storage.getItem(PREFIX + id))?.acknowledged === true; }
  catch { return false; }
}
