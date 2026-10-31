import test from "node:test";
import assert from "node:assert/strict";
import {
  createSubmissionId,
  queueResult,
  readOutbox,
  acknowledgeResult,
  OUTBOX_KEY,
} from "../src/js/outbox.js";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("two failed results survive reload; acknowledging one removes only that receipt", () => {
  const raw = new Map(),
    storage = {
      getItem: (k) => raw.get(k) ?? null,
      setItem: (k, v) => raw.set(k, v),
      removeItem: (k) => raw.delete(k),
      get length() {
        return raw.size;
      },
      key: (i) => [...raw.keys()][i],
    };
  const a = Object.freeze({
      name: "開始名A",
      submissionId: id(1),
      clientVersion: "original-v1",
    }),
    b = Object.freeze({
      name: "開始名B",
      submissionId: id(2),
      clientVersion: "original-v2",
    });
  queueResult(storage, a, { score: 1234 });
  queueResult(storage, b, { score: 2345 });
  queueResult(storage, a, { score: 1234 });
  assert.equal(readOutbox(storage).length, 2);
  assert.deepEqual(readOutbox(storage)[0].run, a);
  acknowledgeResult(storage, id(2));
  assert.deepEqual(
    readOutbox(storage).map((x) => x.run.submissionId),
    [id(1)],
  );
  queueResult(storage, { ...a, name: "" }, { score: 9 });
  assert.equal(readOutbox(storage).length, 1);
  assert.throws(
    () =>
      queueResult(storage, { ...a, clientVersion: "changed" }, { score: 1234 }),
    /Receipt conflict/,
  );
});
test("unrecognized outbox and storage write errors retain old data", () => {
  let raw = "future data";
  const storage = {
    getItem: () => raw,
    setItem: (value) => {
      raw = value;
    },
  };
  assert.throws(() =>
    queueResult(
      storage,
      { name: "A", submissionId: id(1), clientVersion: "v1" },
      { score: 1 },
    ),
  );
  assert.equal(raw, "future data");
  assert.throws(
    () =>
      queueResult(
        {
          getItem: () => null,
          setItem: () => {
            throw Error("quota");
          },
        },
        { name: "A", submissionId: id(1), clientVersion: "v1" },
        { score: 1 },
      ),
    /quota/,
  );
  assert.equal(OUTBOX_KEY, "paripari.pending-submissions.v1");
});
test("UUID fallback works without randomUUID and lack of crypto never prevents play", () => {
  assert.equal(
    createSubmissionId({ getRandomValues: (bytes) => bytes.fill(7) }),
    "07070707-0707-4707-8707-070707070707",
  );
  assert.equal(createSubmissionId(null), null);
  assert.equal(
    createSubmissionId({
      randomUUID() {
        throw Error("denied");
      },
    }),
    null,
  );
});

test("interleaved writes and acknowledgements from two tabs cannot erase another receipt", () => {
  const values = new Map();
  let interleave = null;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index],
    removeItem: (key) => {
      if (interleave) {
        const action = interleave;
        interleave = null;
        action();
      }
      values.delete(key);
    },
    setItem: (key, value) => {
      if (interleave) {
        const action = interleave;
        interleave = null;
        action();
      }
      values.set(key, value);
    },
  };
  const run = (n) => ({
    name: `P${n}`,
    submissionId: id(n),
    clientVersion: "v1",
  });
  interleave = () => queueResult(storage, run(2), { score: 2 });
  queueResult(storage, run(1), { score: 1 });
  assert.deepEqual(
    readOutbox(storage)
      .map((x) => x.run.submissionId)
      .sort(),
    [id(1), id(2)],
  );
  interleave = () => queueResult(storage, run(3), { score: 3 });
  acknowledgeResult(storage, id(1));
  assert.deepEqual(
    readOutbox(storage)
      .map((x) => x.run.submissionId)
      .sort(),
    [id(2), id(3)],
  );
});
test("legacy array is retained and acknowledged per ID without rewriting it", () => {
  const value = {
    run: { name: "legacy", submissionId: id(1), clientVersion: "old" },
    result: { score: 1234 },
  };
  const raw = JSON.stringify({ version: 1, entries: [value] }),
    values = new Map([[OUTBOX_KEY, raw]]);
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i],
  };
  assert.equal(readOutbox(storage).length, 1);
  acknowledgeResult(storage, id(1));
  assert.equal(readOutbox(storage).length, 0);
  assert.equal(values.get(OUTBOX_KEY), raw);
});
