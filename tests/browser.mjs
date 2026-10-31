import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium, webkit } from "playwright";
const root = resolve(new URL("..", import.meta.url).pathname);
const server = http.createServer(async (req, res) => {
  const file = resolve(
    root,
    "." +
      decodeURIComponent(
        new URL(req.url, "http://localhost").pathname === "/index.html"
          ? "/index.html"
          : new URL(req.url, "http://localhost").pathname,
      ),
  );
  if (!file.startsWith(root + "/")) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      "content-type",
      { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[
        extname(file)
      ] || "application/octet-stream",
    );
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browserType = process.env.PW_BROWSER === "webkit" ? webkit : chromium;
const browser = await browserType.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    locale: "ja-JP",
  });
  const writes = [],
    reads = [],
    errors = [];
  let loseReceipt = false;
  await context.route(
    "https://mlpnjgezrnhdxsxolyzj.supabase.co/**",
    async (route) => {
      const rpc = route.request().url().split("/").at(-1),
        data = route.request().postDataJSON();
      let response = { accepted: true, play_id: "fixture-play" };
      if (rpc === "get_best_score_ranking") {
        reads.push(data);
        response = Array.from({ length: 30 }, (_, i) => ({
          rank_no: i < 2 ? 1 : i + 1,
          display_name:
            i === 0 ? "<img src=x onerror=alert(1)>" : `名前${i + 1}`,
          best_score: 1000 - i,
        }));
      } else writes.push({ rpc, data });
      if (rpc === "submit_score_idempotent_v1" && loseReceipt) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    window.shared = [];
    window.open = (value) => {
      window.shared.push(value);
      return { opener: null };
    };
  });
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  await page.goto(url);
  await page.waitForFunction(() => window.PariPari);
  assert.equal(await page.locator("#screen-title #player-name").count(), 1);
  await page.fill("#player-name", "   ");
  await page.click("#btn-home-share");
  assert.match(
    await page.evaluate(() =>
      new URL(window.shared[0]).searchParams.get("text"),
    ),
    /https:\/\/chameleonjp-lab.github.io\/paripari\//,
  );
  await page.click("#btn-play");
  await page.waitForFunction(() => window.PariPari.game.isPlaying());
  await page.waitForFunction(() => window.PariPari.game.attack);
  const noReset = await page.evaluate(async () => {
    const { setLanguage } = await import("/src/js/i18n.js");
    const g = window.PariPari.game;
    const before = {
      attack: g.attack,
      time: g.gameTime,
      hp: g.hp,
      score: g.score,
    };
    setLanguage("fr");
    const same =
      before.attack === g.attack &&
      before.time === g.gameTime &&
      before.hp === g.hp &&
      before.score === g.score;
    setLanguage("ja");
    return same;
  });
  assert.equal(
    noReset,
    true,
    "language cannot reroll an attack or reset time/score/lives",
  );
  await page.waitForFunction(
    () => window.PariPari.game.state === "OVER",
    {},
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () => document.querySelectorAll("#result-ranking-list li").length === 30,
  );
  assert.equal(writes.length, 0, "anonymous result never writes public record");
  const localeIDs = [
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
  ];
  for (const locale of localeIDs) {
    const verified = await page.evaluate(async (locale) => {
      const { setLanguage, t, catalogs } = await import("/src/js/i18n.js");
      setLanguage(locale);
      return {
        language: document.documentElement.lang,
        static: [...document.querySelectorAll("[data-i18n]")].every(
          (el) => el.textContent === t(el.dataset.i18n),
        ),
        share: document.querySelector("#result-share-text").value,
        text: catalogs[locale].resultShareText.split("{score}")[0],
      };
    }, locale);
    assert.equal(verified.language, locale);
    assert.equal(verified.static, true, `${locale} all visible static labels`);
    assert.ok(verified.share.startsWith(verified.text));
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `${locale} result width`,
    );
  }
  await page.evaluate(async () => {
    (await import("/src/js/i18n.js")).setLanguage("ja");
  });
  assert.equal(
    writes.length,
    0,
    "changing all15 result languages cannot publish anonymous result",
  );

  assert.equal(
    await page.locator("#result-ranking-list img").count(),
    0,
    "names stay text",
  );
  assert.equal(
    await page.locator("#result-ranking-list li").nth(1).getAttribute("value"),
    "1",
    "server tie rank preserved",
  );
  await page.click("#btn-result-home");
  await page.fill("#player-name", "次の名前");
  await page.click("#btn-last-result");
  await page.waitForFunction(() =>
    document
      .querySelector("#result-submit-status")
      .textContent.includes("公開登録しません"),
  );
  assert.equal(
    writes.length,
    0,
    "adding a name cannot publish an old anonymous result",
  );
  await page.click("#btn-result-home");
  await page.fill("#player-name", "開始時の名前");
  await page.click("#btn-play");
  await page.waitForFunction(() => window.PariPari.game.isPlaying());
  await page.evaluate(() => {
    document.querySelector("#player-name").value = "後から別名";
    window.PariPari.game.score = 42;
    window.PariPari.game._gameOver();
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#result-submit-status")
      .textContent.includes("送信しました"),
  );
  assert.equal(
    writes.filter((x) => x.rpc === "submit_score_idempotent_v1").length,
    1,
  );
  assert.ok(writes.every((x) => x.data.p_display_name === "開始時の名前"));
  const first = writes.find((x) => x.rpc === "submit_score_idempotent_v1").data;
  await page.click("#btn-ranking-retry");
  await page.waitForTimeout(100);
  assert.equal(
    writes.filter((x) => x.rpc === "submit_score_idempotent_v1").length,
    1,
    "result refresh does not resubmit sent play",
  );
  await page.click("#btn-result-share");
  const text = await page.evaluate(() =>
    new URL(window.shared.at(-1)).searchParams.get("text"),
  );
  assert.match(text, /42点/);
  assert.ok(!text.includes("開始時の名前"));
  await page.reload();
  await page.click("#btn-last-result");
  await page.waitForFunction(() =>
    document
      .querySelector("#result-submit-status")
      .textContent.includes("送信しました"),
  );
  assert.deepEqual(
    writes.filter((x) => x.rpc === "submit_score_idempotent_v1").at(-1).data,
    first,
    "reload reuses the original idempotency payload",
  );
  assert.ok(reads.every((x) => x.p_limit === 30));
  loseReceipt = true;
  for (const [name, score] of [
    ["待機A", 1234],
    ["待機B", 2345],
  ]) {
    await page.click("#btn-result-home");
    await page.fill("#player-name", name);
    await page.click("#btn-play");
    await page.waitForFunction(() => window.PariPari.game.isPlaying());
    await page.evaluate((score) => {
      window.PariPari.game.score = score;
      window.PariPari.game._gameOver();
    }, score);
    await page.waitForFunction(() =>
      document
        .querySelector("#result-submit-status")
        .textContent.includes("送信できません"),
    );
  }
  const failedPayload = writes
    .filter(
      (x) => x.rpc === "submit_score_idempotent_v1" && x.data.p_score === 1234,
    )
    .at(-1).data;
  await page.click("#btn-result-home");
  await page.fill("#player-name", "");
  assert.equal(
    await page.locator("#pending-results button").count(),
    2,
    "both failed results remain recoverable",
  );
  loseReceipt = false;
  await page
    .locator("#pending-results button")
    .filter({ hasText: "1,234" })
    .click();
  await page.waitForFunction(() =>
    document
      .querySelector("#result-submit-status")
      .textContent.includes("送信しました"),
  );
  assert.deepEqual(
    writes
      .filter(
        (x) =>
          x.rpc === "submit_score_idempotent_v1" && x.data.p_score === 1234,
      )
      .at(-1).data,
    failedPayload,
    "lost ACK retry freezes original name/version/UUID/score",
  );
  await page.click("#btn-result-home");
  assert.equal(
    await page.locator("#pending-results button").count(),
    1,
    "only acknowledged result removed",
  );
  await page.click("#btn-last-result");

  await page.click("#btn-result-home");
  await page.click("#btn-settings");
  assert.equal(await page.isChecked("#set-sound"), true);
  assert.equal(await page.inputValue("#set-volume"), "0.35");
  await page.uncheck("#set-sound");
  await page.fill("#set-volume", "0");
  await page.reload();
  await page.click("#btn-settings");
  assert.equal(await page.isChecked("#set-sound"), false);
  assert.equal(await page.inputValue("#set-volume"), "0");
  await page.click("#btn-settings-back");
  for (const locale of localeIDs) {
    await page.selectOption("#language", locale);
    for (const id of ["btn-howto", "btn-settings"]) {
      await page.click("#" + id);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `${locale} ${id} width`,
      );
      await page.click(
        id === "btn-howto" ? "#btn-howto-back" : "#btn-settings-back",
      );
    }
    await page.click("#btn-home-share");
    const text = await page.evaluate(() =>
      new URL(window.shared.at(-1)).searchParams.get("text"),
    );
    assert.ok(text.endsWith("https://chameleonjp-lab.github.io/paripari/"));
  }
  await page.selectOption("#language", "de");
  await page.reload();
  assert.equal(await page.inputValue("#language"), "de");
  assert.deepEqual(errors, []);
  for (const size of [
    { width: 393, height: 600 },
    { width: 852, height: 393 },
  ]) {
    await page.setViewportSize(size);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  await page.goto(url.replace("/index.html", "/dist/paripari.html"));
  await page.waitForFunction(() => window.PariPari);
  assert.equal(
    await page.locator("#language option").count(),
    15,
    "standalone bundle includes all catalogs and starts",
  );
  assert.deepEqual(errors, []);
  console.log(
    `${browserType.name()}: 15 languages, actual missed-attack game over, language without reset, optional name, multi-result lost ACK retries, top30 ties, X, sound persistence and viewport checks passed`,
  );
  await context.close();
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
