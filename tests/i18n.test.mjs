import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogs,
  languages,
  chooseLanguage,
  languageFromTag,
  setLanguage,
  t,
  formatNumber,
} from "../src/js/i18n.js";
const placeholders = (text) =>
  [...text.matchAll(/\{[A-Za-z]+\}/g)].map((x) => x[0]).sort();
test("every supported language translates all 77 required keys with matching placeholders", () => {
  assert.deepEqual(
    languages.map(([id]) => id),
    [
      "ja",
      "en",
      "es",
      "pt-BR",
      "zh-Hans",
      "fr",
      "de",
      "ko",
      "ru",
      "it",
      "zh-Hant",
      "id",
      "tr",
      "vi",
      "th",
    ],
  );
  assert.equal(Object.keys(catalogs.en).length, 77);
  for (const [locale, catalog] of Object.entries(catalogs)) {
    assert.deepEqual(
      Object.keys(catalog).sort(),
      Object.keys(catalogs.en).sort(),
      locale,
    );
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, "string");
      assert.ok(value.trim(), `${locale}.${key}`);
      assert.deepEqual(
        placeholders(value),
        placeholders(catalogs.en[key]),
        `${locale}.${key}`,
      );
    }
  }
});
test("saved choice wins, supported browser aliases work, unsupported falls back to English", () => {
  assert.equal(chooseLanguage("de", ["ja"]), "de");
  assert.equal(chooseLanguage(null, ["xx", "pt-PT"]), "pt-BR");
  assert.equal(chooseLanguage(null, ["zh-HK"]), "zh-Hant");
  assert.equal(chooseLanguage(null, ["xx"]), "en");
  assert.equal(languageFromTag("zh-Hans-TW"), "zh-Hans");
  assert.equal(languageFromTag("zh-Hant-CN"), "zh-Hant");
  assert.equal(languageFromTag("toString"), null);
});
test("translations preserve arbitrary player names and do not interpret prototype keys or code", () => {
  for (const [locale] of languages) {
    setLanguage(locale, { persist: false });
    const name = "<img src=x onerror=alert(1)> 日本語";
    assert.ok(t("playerResult", { name }).includes(name));
    assert.equal(t("toString"), "toString");
    const result = t("resultShareText", {
      score: formatNumber(12345),
      rank: "A",
      combo: 2,
      rate: 50,
      tier: 3,
    });
    assert.ok(result.includes("A"));
    assert.ok(result.includes("\n"));
    assert.ok(!result.includes("{"));
    assert.ok(!result.includes(name));
  }
});
test("storage denial does not prevent a language change", () => {
  setLanguage("fr", {
    storage: {
      setItem() {
        throw Error("denied");
      },
    },
  });
  assert.equal(t("play"), catalogs.fr.play);
});

test("ranking requests time out without altering the retry payload", async () => {
  const { callRankingRpc } = await import("../src/js/platform.js");
  const payload = { p_submission_id: "same-id", p_score: 42 };
  let observed;
  await assert.rejects(
    callRankingRpc("fixture", payload, {
      timeoutMs: 5,
      fetchImpl: async (url, options) => {
        observed = JSON.parse(options.body);
        return new Promise((resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(new Error("timed out")),
          ),
        );
      },
    }),
    /timed out/,
  );
  assert.deepEqual(observed, payload);
});
