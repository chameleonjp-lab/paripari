// R2/currentブラウザ受入検査（R1の起動・入力・共有回帰を含む）。
//
// 実行:
//   npm run build
//   npm run test:browser
//
// PARIPARI_BROWSERS を指定しない場合は Chromium と WebKit の両方を必ず
// 起動する。ローカルで片方だけを確認するときも、自動でスキップせず、
// PARIPARI_BROWSERS=chromium のように明示する。
// テスト用ゲーム参照はHTTPレスポンスにだけ注入する。配布物・分割ソース・
// file://で開くHTMLは書き換えない。

import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST_FILE = resolve(ROOT, 'dist/paripari.html');
const HOOK_MARKER = 'PARIPARI_R1_TEST_HOOK_BEGIN';
const DEFAULT_TIMEOUT = Number(process.env.PARIPARI_R1_TIMEOUT_MS || 8_000);
const ARTIFACT_DIR = resolve(process.env.PARIPARI_ARTIFACT_DIR || '/tmp/paripari-browser');

const requestedBrowsers = (process.env.PARIPARI_BROWSERS || 'chromium,webkit')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const browserFactories = { chromium, webkit };

if (!requestedBrowsers.length || requestedBrowsers.some((name) => !browserFactories[name])) {
  throw new Error(`PARIPARI_BROWSERS must contain chromium and/or webkit (got ${requestedBrowsers.join(',')})`);
}
if (requestedBrowsers.length < 2) {
  console.warn(`BROWSER_PARTIAL: ${requestedBrowsers.join(',')} のみ明示実行。Chromium+WebKitの完全検査ではありません。`);
}

const results = [];
let currentCaseName = 'browser';
let diagnosticPageId = 0;

// CIの描画途絶を、製品の停止条件を変えずに調査するための観測だけを行う。
// Playwrightのinit scriptなので、配布HTML/通常ソースには含まれない。
async function installFrameDiagnostics(context) {
  await context.addInitScript(() => {
    const history = { maxGap: 0, gaps: [], screens: [], events: [] };
    globalThis.__browserFrameDiagnostics = history;
    const retain = (array, entry) => { array.push(entry); if (array.length > 60) array.shift(); };
    let previous = null;
    function observeFrame(wall) {
      if (previous != null) {
        const gap = wall - previous;
        history.maxGap = Math.max(history.maxGap, gap);
        if (gap > 100) retain(history.gaps, { wall, previous, gap, hidden: document.hidden });
      }
      previous = wall;
      requestAnimationFrame(observeFrame);
    }
    requestAnimationFrame(observeFrame);
    for (const type of ['visibilitychange', 'pagehide', 'orientationchange', 'resize']) {
      const target = type === 'visibilitychange' ? document : window;
      target.addEventListener(type, () => retain(history.events, {
        type, wall: performance.now(), hidden: document.hidden,
        width: innerWidth, height: innerHeight,
      }));
    }
    document.addEventListener('DOMContentLoaded', () => {
      const observer = new MutationObserver((changes) => {
        if (!changes.some((change) => change.target.id?.startsWith('screen-'))) return;
        retain(history.screens, {
          wall: performance.now(),
          visible: [...document.querySelectorAll('[id^="screen-"]')]
            .filter((element) => !element.classList.contains('hidden')).map((element) => element.id),
        });
      });
      observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    }, { once: true });
  });
}

async function closeObservedPage(page) {
  const label = `${currentCaseName}-${++diagnosticPageId}`;
  try {
    const diagnostic = await page.evaluate(() => ({
      url: location.pathname,
      wall: performance.now(),
      frames: globalThis.__browserFrameDiagnostics ?? null,
      screen: [...document.querySelectorAll('[id^="screen-"]')]
        .filter((element) => !element.classList.contains('hidden')).map((element) => element.id),
      session: globalThis.__testSession && {
        state: globalThis.__testSession.state,
        pauseReason: globalThis.__testSession.pauseReason,
        lastPresentedWall: globalThis.__testSession.lastPresentedWall,
      },
      game: globalThis.__testGame && {
        state: globalThis.__testGame.state,
        time: globalThis.__testGame.gameTime,
        hp: globalThis.__testGame.hp,
      },
    }));
    const path = artifactPath(label, 'diagnostic').replace(/\.png$/, '.json');
    await writeFile(path, JSON.stringify(diagnostic, null, 2));
    if (diagnostic.screen.includes('screen-pause')) {
      console.log(`BROWSER_PAUSED ${label} ${JSON.stringify(diagnostic)}`);
      await saveScreenshot(page, label, 'paused');
    }
  } catch (error) {
    console.log(`BROWSER_DIAGNOSTIC_UNAVAILABLE ${label}: ${String(error)}`);
  } finally {
    await page.close();
  }
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function describeError(error) {
  if (error && error.stack) return error.stack;
  return String(error);
}

function mimeFor(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  }[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function splitHook(source) {
  if (source.includes(HOOK_MARKER)) return source;
  return `${source}
/* ${HOOK_MARKER} */
globalThis.__testGame = typeof game === 'undefined' ? null : game;
globalThis.__testRenderer = typeof renderer === 'undefined' ? null : renderer;
globalThis.__testClock = typeof clock === 'undefined' ? null : clock;
globalThis.__testSession = typeof session === 'undefined' ? null : session;
globalThis.__testHookReady = true;
/* PARIPARI_R1_TEST_HOOK_END */
`;
}

function bundleHook(html) {
  if (html.includes(HOOK_MARKER)) return html;

  // esbuildのIIFEではmain.jsのローカル変数も同じIIFE内にある。main.jsの
  // 初期化処理を全て終えた直後、外側の})();の内側にだけフックを差し込む。
  // source / dist のファイル自体には書き込まない。
  const end = html.lastIndexOf('\n})();');
  if (end < 0 || !html.slice(0, end).includes('// src/js/main.js')) {
    fail('単一HTMLのesbuild IIFE末尾またはmain.js markerが見つかりません');
  }
  const hook = `
  /* ${HOOK_MARKER} */
  globalThis.__testGame = typeof game === 'undefined' ? null : game;
  globalThis.__testRenderer = typeof renderer === 'undefined' ? null : renderer;
  globalThis.__testClock = typeof clock === 'undefined' ? null : clock;
  globalThis.__testSession = typeof session === 'undefined' ? null : session;
  globalThis.__testHookReady = true;
  /* PARIPARI_R1_TEST_HOOK_END */`;
  return `${html.slice(0, end)}${hook}${html.slice(end)}`;
}

function createStaticServer({ inject = false } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    requests.push({ method: request.method, url: request.url });

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Method Not Allowed');
      return;
    }

    try {
      const incoming = new URL(request.url || '/', 'http://127.0.0.1');
      let relative = incoming.pathname === '/'
        ? 'index.html'
        : incoming.pathname === '/dist.html'
          ? 'dist/paripari.html'
          : incoming.pathname.replace(/^\/+/, '');
      relative = decodeURIComponent(relative);
      const filePath = resolve(ROOT, relative);
      if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${sep}`)) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Forbidden');
        return;
      }

      let body = await readFile(filePath);
      if (inject && relative === 'src/js/main.js') {
        body = Buffer.from(splitHook(body.toString('utf8')));
      } else if (inject && relative === 'dist/paripari.html') {
        body = Buffer.from(bundleHook(body.toString('utf8')));
      }

      response.writeHead(200, {
        'content-type': mimeFor(filePath),
        'content-length': body.byteLength,
        'cache-control': 'no-store',
      });
      if (request.method === 'HEAD') response.end();
      else response.end(body);
    } catch (error) {
      const status = error?.code === 'ENOENT' ? 404 : 500;
      response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(status === 404 ? 'Not Found' : `Server error: ${error.message}`);
    }
  });

  return {
    server,
    requests,
    async start() {
      await new Promise((resolveStart, rejectStart) => {
        const onError = (error) => {
          server.off('listening', onListening);
          rejectStart(error);
        };
        const onListening = () => {
          server.off('error', onError);
          resolveStart();
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(0, '127.0.0.1');
      });
      const address = server.address();
      assert(address && typeof address === 'object', 'テストサーバーの待受アドレスを取得できません');
      return `http://127.0.0.1:${address.port}`;
    },
    async close() {
      if (!server.listening) return;
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    },
  };
}

function launchOptions(browserName) {
  const envName = `PARIPARI_${browserName.toUpperCase()}_EXECUTABLE_PATH`;
  const options = { headless: true };
  if (process.env[envName]) options.executablePath = process.env[envName];
  if (browserName === 'chromium') {
    options.args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
  }
  return options;
}

async function launchBrowser(browserName) {
  const factory = browserFactories[browserName];
  try {
    return await factory.launch(launchOptions(browserName));
  } catch (error) {
    fail(`${browserName}を起動できません（未導入を成功扱いにしません）: ${describeError(error)}`);
  }
}

function addStorageAndShareBlock(context) {
  context.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage']) {
      try {
        Object.defineProperty(window, key, {
          configurable: true,
          get() { throw new Error(`${key} disabled by R1 test`); },
        });
      } catch (_) { /* ブラウザが固有の非構成プロパティなら後続の実行で検査する */ }
    }
    try {
      Object.defineProperty(Navigator.prototype, 'share', {
        configurable: true,
        value: undefined,
      });
    } catch (_) { /* 未実装ブラウザでは元からundefined */ }
    try {
      Object.defineProperty(Navigator.prototype, 'clipboard', {
        configurable: true,
        get() {
          return { writeText: async () => { throw new Error('clipboard disabled by R1 test'); } };
        },
      });
    } catch (_) { /* 後でページ側からも上書きを試みる */ }
  });
}

async function newContext(browser, { mobile = false, short = false, blocked = false } = {}) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 375, height: short ? 500 : 667 }
      : { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    userAgent: mobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });
  await installFrameDiagnostics(context);
  if (blocked) addStorageAndShareBlock(context);
  return context;
}

function observe(page, origin) {
  const state = { pageErrors: [], consoleErrors: [], externalRequests: [] };
  page.on('pageerror', (error) => {
    state.pageErrors.push(describeError(error));
    console.error(`BROWSER_PAGE_ERROR ${currentCaseName}: ${describeError(error)}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      state.consoleErrors.push(message.text());
      console.error(`BROWSER_CONSOLE_ERROR ${currentCaseName}: ${message.text()}`);
    }
  });
  page.on('request', (request) => {
    try {
      const url = new URL(request.url());
      if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origin) {
        state.externalRequests.push(request.url());
      }
    } catch (_) { /* data:, blob: 等は外部通信ではない */ }
  });
  return state;
}

function assertHealthy(observation, label) {
  assert(observation.pageErrors.length === 0,
    `${label}: pageerror: ${observation.pageErrors.join('\n')}`);
  assert(observation.consoleErrors.length === 0,
    `${label}: console.error: ${observation.consoleErrors.join('\n')}`);
  assert(observation.externalRequests.length === 0,
    `${label}: 外部HTTP通信が発生: ${observation.externalRequests.join(', ')}`);
}

async function firstVisible(page, selectors, label, timeout = DEFAULT_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let lastError = '';
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count() && await locator.isVisible()) return locator;
      } catch (error) {
        lastError = String(error);
      }
    }
    await page.waitForTimeout(40);
  }
  fail(`${label}が表示されません${lastError ? `: ${lastError}` : ''}`);
}

async function assertTitleScreen(page, label) {
  const title = page.locator('#screen-title').first();
  const visibleTitle = await title.count() && await title.isVisible();
  const logo = page.getByText('パリパリ', { exact: true }).first();
  assert(visibleTitle || (await logo.count() && await logo.isVisible()), `${label}: ホーム画面が表示されません`);
}

async function assertNoRotationHint(page, label) {
  const hint = page.locator('#rotate-hint').first();
  if (await hint.count() && await hint.isVisible()) fail(`${label}: PC横長画面に回転案内が表示されました`);
  const visibleText = await page.locator('body').innerText();
  assert(!/縦向きでプレイしてください/.test(visibleText), `${label}: 回転案内の文言が残っています`);
}

async function waitForPlaying(page, { hook = false, label = 'ゲーム' } = {}) {
  if (hook) {
    await page.waitForFunction(() => {
      const game = globalThis.__testGame;
      const state = game && String(game.state || '').toUpperCase();
      return state === 'PLAYING' || state === 'RUNNING';
    }, undefined, { timeout: DEFAULT_TIMEOUT });
  } else {
    await page.waitForFunction(() => {
      const controls = document.querySelector('#controls');
      if (!controls) return false;
      const style = getComputedStyle(controls);
      return !controls.classList.contains('hidden') && style.display !== 'none' && style.visibility !== 'hidden';
    }, undefined, { timeout: DEFAULT_TIMEOUT });
  }
  const buttons = page.locator('[data-dir]');
  assert(await buttons.count() === 5, `${label}: ゲーム中の方向ボタンが5個ではありません`);
}

async function waitForReady(page, label) {
  await page.waitForFunction(() => document.readyState !== 'loading', undefined, { timeout: DEFAULT_TIMEOUT });
  await firstVisible(page, ['#screen-title', 'h1'], `${label}のホーム`, DEFAULT_TIMEOUT);
}

async function startByName(page, { hook = false, label = 'ゲーム' } = {}) {
  const nameSelectors = [
    '#player-name',
    '[data-testid="player-name"]',
    'input[name="playerName"]',
    'input[name="name"]',
    'input[type="text"]',
  ];

  // B版移植後のR1画面はホームに名前欄を置ける。旧画面のように
  // 「プレイ」後に名前画面へ遷移する実装も検査できるよう、まず現在表示中の
  // 欄を探し、なければプレイを押してから探す。
  let input = null;
  try {
    input = await firstVisible(page, nameSelectors, `${label}の名前入力欄`, 700);
  } catch (_) {
    const play = await firstVisible(page, [
      '#btn-play',
      'button:has-text("プレイ")',
      'button:has-text("開始")',
    ], `${label}のプレイボタン`);
    await play.click();
    input = await firstVisible(page, nameSelectors, `${label}の名前入力欄`);
  }

  const name = 'R1テスト';
  await input.fill(name);
  const beforeArrows = await input.inputValue();

  await page.evaluate(() => {
    globalThis.__r1KeyEvents = [];
    window.addEventListener('keydown', (event) => {
      globalThis.__r1KeyEvents.push({ key: event.key, defaultPrevented: event.defaultPrevented });
    });
  });

  // 方向キーとPC操作キーを入力欄へ送っても、ゲーム側が奪わないことを
  // defaultPreventedで確認する。文字キーは入力欄の文字自体を変えうるため、
  // 各回の後に名前を戻す。
  for (const key of ['ArrowLeft', 'ArrowRight', 'a', 'd', 'q', 'z', 'e', 'c']) {
    await page.keyboard.press(key);
    const event = await page.evaluate((keyName) => {
      const list = globalThis.__r1KeyEvents || [];
      return [...list].reverse().find((item) => item.key === keyName) || null;
    }, key);
    assert(event && event.defaultPrevented === false,
      `${label}: 名前入力中の${key}をゲームが奪いました`);
    await input.fill(name);
  }
  await input.fill(beforeArrows);
  assert(await input.inputValue() === name, `${label}: 名前入力値が保持されません`);

  if (hook) {
    const stateBefore = await page.evaluate(() => String(globalThis.__testGame?.state || '').toUpperCase());
    assert(stateBefore !== 'PLAYING' && stateBefore !== 'RUNNING', `${label}: 名前入力中にゲームが開始されました`);
  }

  // ホーム直置き型はプレイ、旧名前画面型は名前開始ボタンを使う。
  let start;
  try {
    start = await firstVisible(page, [
      '#btn-name-start',
      '[data-testid="name-start"]',
      'button:has-text("この名前で開始")',
      'button:has-text("名前で開始")',
    ], `${label}の名前開始ボタン`, 700);
  } catch (_) {
    start = await firstVisible(page, [
      '#btn-play',
      'button:has-text("プレイ")',
      'button:has-text("開始")',
    ], `${label}のプレイボタン`);
  }
  await start.click();
  await waitForPlaying(page, { hook, label });
}

async function prepareAttack(page, {
  needDir = 'R',
  taps = 1,
  hp = 3,
  mode = 'normal',
  impactOffset = 80,
  gapMs = 180,
} = {}) {
  return page.evaluate(({
    needDir: wanted,
    taps: count,
    hp: requestedHp,
    mode: requestedMode,
    impactOffset: firstOffset,
    gapMs: segmentGap,
  }) => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    if (!game || !clock || typeof clock.now !== 'function') {
      throw new Error('R2 test hookのGame/Clockがありません');
    }
    const now = clock.now(performance.now());
    if (!Number.isFinite(now)) throw new Error('R2 test clockの現在時刻を取得できません');
    if (typeof game.clearInputs === 'function') game.clearInputs();
    game.mode = requestedMode === 'practice' ? 'practice' : 'normal';
    game.state = 'PLAYING';
    if ('warmupRemaining' in game) {
      game.warmupRemaining = requestedMode === 'practice'
        ? Math.max(1, Number(game.warmupRemaining) || 5)
        : 0;
    }
    if ('hp' in game) game.hp = requestedHp;
    game.nextSpawnAt = Number.POSITIVE_INFINITY;
    const opposite = { L: 'R', R: 'L', D: 'U', DL: 'UR', DR: 'UL' };
    const impacts = Array.from({ length: count }, (_, index) => now + firstOffset + index * segmentGap);
    const attack = {
      id: `r2-browser-fixture-${(globalThis.__r2FixtureId || 0) + 1}`,
      dir: opposite[wanted] || 'L',
      needDir: wanted,
      spawnAt: now,
      visibleMs: firstOffset,
      taps: count,
      segments: impacts.map((impactAt) => ({
        impactAt,
        resolved: false,
        result: null,
        resolvedAt: 0,
        inputTime: null,
      })),
      segIndex: 0,
      hpLost: false,
      warmup: requestedMode === 'practice',
      resolved: false,
      resolvedAt: 0,
      result: null,
    };
    globalThis.__r2FixtureId = (globalThis.__r2FixtureId || 0) + 1;
    game.attack = attack;
    return { now, impacts, hp: game.hp, taps: attack.segments.length, needDir: attack.needDir };
  }, { needDir, taps, hp, mode, impactOffset, gapMs });
}

async function pressFixtureSegment(page, index, label) {
  await page.waitForFunction((segmentIndex) => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    const segment = game?.attack?.segments?.[segmentIndex];
    return !!segment && !!clock && clock.now(performance.now()) >= segment.impactAt - 20;
  }, index, { timeout: DEFAULT_TIMEOUT });
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((segmentIndex) => {
    const segment = globalThis.__testGame?.attack?.segments?.[segmentIndex];
    return !!segment?.resolved;
  }, index, { timeout: DEFAULT_TIMEOUT });
  if (label) await page.waitForTimeout(0);
}

async function currentGameStats(page) {
  return page.evaluate(() => {
    const game = globalThis.__testGame;
    if (!game) return null;
    return {
      state: String(game.state || '').toUpperCase(),
      hp: game.hp,
      score: game.score,
      successCount: game.successCount,
      attackResult: game.attack?.result || null,
      attackResolved: !!game.attack?.resolved,
    };
  });
}

async function runInputAndResultFlow(page, label) {
  await waitForPlaying(page, { hook: true, label });

  // 単発の成功はGameの内部状態だけを準備し、判定そのものは実キー配線で行う。
  await prepareAttack(page, { needDir: 'R', taps: 1, hp: 3 });
  const beforeSuccess = await currentGameStats(page);
  await pressFixtureSegment(page, 0, label);
  await page.waitForFunction((previous) => {
    const game = globalThis.__testGame;
    return game && Number(game.successCount) > Number(previous);
  }, beforeSuccess.successCount, { timeout: DEFAULT_TIMEOUT });

  // 方向違いは同じ実キー配線からMISSになり、ライフを1だけ失う。
  await prepareAttack(page, { needDir: 'R', taps: 1, hp: 3 });
  await page.waitForFunction(() => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    return game?.attack?.segments?.[0] && clock
      && clock.now(performance.now()) >= game.attack.segments[0].impactAt - 20;
  }, undefined, { timeout: DEFAULT_TIMEOUT });
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => globalThis.__testGame && globalThis.__testGame.hp === 2,
    undefined, { timeout: DEFAULT_TIMEOUT });

  // timeoutも更新ループの実時間で確認する（予定時刻境界の厳密な検査はR2）。
  await prepareAttack(page, { needDir: 'R', taps: 1, hp: 3 });
  await page.waitForFunction(() => globalThis.__testGame && globalThis.__testGame.hp === 2,
    undefined, { timeout: DEFAULT_TIMEOUT });

  // 3分割の成功も内部オブジェクトだけを準備し、3回のキー入力は実配線を通す。
  await prepareAttack(page, { needDir: 'R', taps: 3, hp: 3 });
  const beforeThree = await currentGameStats(page);
  for (let i = 0; i < 3; i++) await pressFixtureSegment(page, i, label);
  await page.waitForFunction((previous) => {
    const game = globalThis.__testGame;
    return game && Number(game.successCount) >= Number(previous) + 3;
  }, beforeThree.successCount, { timeout: DEFAULT_TIMEOUT });

  // ライフ0→リザルトを確認する。結果生成は1試合につき1回だけでよいが、
  // ここでは表示到達と直後のリトライ導線を受入条件にする。
  await prepareAttack(page, { needDir: 'R', taps: 1, hp: 1 });
  await page.waitForFunction(() => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    return game?.attack?.segments?.[0] && clock
      && clock.now(performance.now()) >= game.attack.segments[0].impactAt - 20;
  }, undefined, { timeout: DEFAULT_TIMEOUT });
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => {
    const game = globalThis.__testGame;
    const result = document.querySelector('#screen-result');
    return game && String(game.state || '').toUpperCase() === 'OVER'
      && result && !result.classList.contains('hidden')
      && getComputedStyle(result).display !== 'none';
  }, undefined, { timeout: DEFAULT_TIMEOUT });
  await page.screenshot({ path: artifactPath(label, 'result') });

  const retry = await firstVisible(page, [
    '#btn-retry',
    '[data-testid="retry"]',
    'button:has-text("もう一回")',
    'button:has-text("リトライ")',
  ], `${label}のリトライ`);
  await retry.click();
  await waitForPlaying(page, { hook: true, label: `${label} retry` });
}

function artifactPath(label, suffix) {
  const safe = `${label}-${suffix}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
  return resolve(ARTIFACT_DIR, `${safe}.png`);
}

async function saveScreenshot(page, label, suffix) {
  await page.screenshot({ path: artifactPath(label, suffix) });
}

async function runDesktopSmoke(browser, browserName, origin, label) {
  const context = await newContext(browser);
  try {
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
      for (const [variant, path] of [['split', '/'], ['dist', '/dist.html']]) {
        const page = await context.newPage();
        const observation = observe(page, origin);
        try {
          const pageLabel = `${browserName}-${label}-${variant}-${viewport.width}x${viewport.height}`;
          await page.setViewportSize(viewport);
          await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
          await waitForReady(page, pageLabel);
          await assertTitleScreen(page, pageLabel);
          await assertNoRotationHint(page, pageLabel);
          const hook = await page.evaluate(() => globalThis.__testGame);
          assert(hook === undefined, `${pageLabel}: 通常起動にテスト用Gameハンドルが混入しています`);
          await saveScreenshot(page, pageLabel, 'home');
          // 通常起動の配線でも、名前からプレイ画面まで到達できることを確認する。
          await startByName(page, { hook: false, label: pageLabel });
          await saveScreenshot(page, pageLabel, 'playing');
          assertHealthy(observation, pageLabel);
        } finally {
          await closeObservedPage(page);
        }
      }
    }
  } finally {
    await context.close();
  }
}

async function runOrientationTouchRegression(browser, browserName, origin) {
  const pcContext = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: true,
  });
  try {
    const page = await pcContext.newPage();
    const observation = observe(page, origin);
    const label = `${browserName}-touch-pc-1024x768`;
    try {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
      await waitForReady(page, label);
      await assertNoRotationHint(page, label);
      await saveScreenshot(page, label, 'home');
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await pcContext.close();
  }

  const phoneContext = await newContext(browser, { mobile: true });
  try {
    const page = await phoneContext.newPage();
    const observation = observe(page, origin);
    const label = `${browserName}-iphone-landscape`;
    try {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
      await waitForReady(page, label);
      await page.setViewportSize({ width: 667, height: 375 });
      let landscapeHintShown = false;
      try {
        // 製品側はorientationchangeを200ms遅延処理するため、固定100msでは
        // resize/orientationchangeの配送順による偽失敗になる。表示状態を待ち、
        // 失敗時にはWebKitが返した向きの値を証拠として残す。
        await page.waitForFunction(() => {
          const element = document.querySelector('#rotate-hint');
          return !!element && !element.classList.contains('hidden')
            && getComputedStyle(element).display !== 'none';
        }, undefined, { timeout: DEFAULT_TIMEOUT });
        landscapeHintShown = true;
      } catch (_) {
        // 下の診断付きassertで失敗理由を返す。
      }
      const landscapeDiagnostics = await page.evaluate(() => ({
        inner: [window.innerWidth, window.innerHeight],
        outer: [window.outerWidth, window.outerHeight],
        screen: [window.screen.width, window.screen.height],
        orientation: window.screen.orientation ? {
          type: window.screen.orientation.type,
          angle: window.screen.orientation.angle,
        } : null,
        windowOrientation: window.orientation,
        mediaLandscape: window.matchMedia?.('(orientation: landscape)').matches ?? null,
        hintClass: document.querySelector('#rotate-hint')?.className || null,
        hintDisplay: document.querySelector('#rotate-hint')
          ? getComputedStyle(document.querySelector('#rotate-hint')).display : null,
      }));
      assert(landscapeHintShown,
        `${label}:スマホ横向きの案内が表示されません ${JSON.stringify(landscapeDiagnostics)}`);
      await saveScreenshot(page, label, 'hint');

      await page.setViewportSize({ width: 375, height: 667 });
      let portraitHintHidden = false;
      try {
        await page.waitForFunction(() => {
          const element = document.querySelector('#rotate-hint');
          return !!element && (element.classList.contains('hidden')
            || getComputedStyle(element).display === 'none');
        }, undefined, { timeout: DEFAULT_TIMEOUT });
        portraitHintHidden = true;
      } catch (_) {
        // 下の診断付きassertで失敗理由を返す。
      }
      const portraitDiagnostics = await page.evaluate(() => ({
        inner: [window.innerWidth, window.innerHeight],
        screen: [window.screen.width, window.screen.height],
        orientation: window.screen.orientation ? {
          type: window.screen.orientation.type,
          angle: window.screen.orientation.angle,
        } : null,
        windowOrientation: window.orientation,
        mediaLandscape: window.matchMedia?.('(orientation: landscape)').matches ?? null,
        hintClass: document.querySelector('#rotate-hint')?.className || null,
      }));
      assert(portraitHintHidden,
        `${label}:縦復帰後も回転案内が残っています ${JSON.stringify(portraitDiagnostics)}`);
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await phoneContext.close();
  }
}

async function runHookFlow(browser, browserName, origin, variant) {
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    const observation = observe(page, origin);
    const label = `${browserName}-${variant}-hook`;
    try {
      await page.goto(`${origin}${variant === 'split' ? '/' : '/dist.html'}`, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_TIMEOUT,
      });
      await waitForReady(page, label);
      await page.waitForFunction(() => globalThis.__testHookReady && globalThis.__testGame,
        undefined, { timeout: DEFAULT_TIMEOUT });
      await startByName(page, { hook: true, label });
      await saveScreenshot(page, label, 'playing');
      await runInputAndResultFlow(page, label);
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await context.close();
  }
}

async function runMobileFlow(browser, browserName, origin, variant, short) {
  const context = await newContext(browser, { mobile: true, short });
  try {
    const page = await context.newPage();
    const observation = observe(page, origin);
    const label = `${browserName}-${variant}-${short ? 'short' : 'mobile'}`;
    try {
      await page.goto(`${origin}${variant === 'split' ? '/' : '/dist.html'}`, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_TIMEOUT,
      });
      await waitForReady(page, label);
      await page.waitForFunction(() => globalThis.__testHookReady && globalThis.__testGame,
        undefined, { timeout: DEFAULT_TIMEOUT });
      await startByName(page, { hook: true, label });
      await waitForPlaying(page, { hook: true, label });
      const buttons = page.locator('[data-dir]');
      assert(await buttons.count() === 5, `${label}: タッチ操作ボタンが5個ではありません`);
      await page.evaluate(() => {
        globalThis.__r1PointerDowns = 0;
        document.addEventListener('pointerdown', () => { globalThis.__r1PointerDowns++; }, { capture: true });
      });
      for (let i = 0; i < await buttons.count(); i++) await buttons.nth(i).tap();
      await page.waitForFunction(() => (globalThis.__r1PointerDowns || 0) >= 5,
        undefined, { timeout: DEFAULT_TIMEOUT });
      await saveScreenshot(page, label, 'buttons');
      if (!short) await runPointerLifecycleRegression(page, label);
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await context.close();
  }
}

async function runPointerLifecycleRegression(page, label) {
  const button = page.locator('[data-dir]').first();
  assert(await button.count() === 1, `${label}: pointer回帰用ボタンがありません`);

  // Count the actual session-to-game dispatch through the R2 enqueue path.
  await page.evaluate(() => {
    const game = globalThis.__testGame;
    if (!game) throw new Error('pointer回帰用Gameハンドルがありません');
    globalThis.__r2ActionDispatches = 0;
    const enqueue = typeof game.enqueueAction === 'function' ? game.enqueueAction : null;
    if (!enqueue) throw new Error('GameにR2 enqueueAction APIがありません');
    game.enqueueAction = function (...args) {
      globalThis.__r2ActionDispatches++;
      return enqueue.apply(this, args);
    };
  });

  const dispatchPointer = async (type, pointerId, options = {}) => page.evaluate(({ type: eventType, pointerId: id, ...extra }) => {
    const target = document.querySelector('[data-dir]');
    if (!target) throw new Error('方向ボタンがありません');
    const rect = target.getBoundingClientRect();
    const event = new PointerEvent(eventType, {
      bubbles: true,
      cancelable: true,
      pointerId: id,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: eventType === 'pointerup' || eventType === 'pointercancel' ? 0 : 1,
      clientX: extra.clientX ?? rect.left + rect.width / 2,
      clientY: extra.clientY ?? rect.top + rect.height / 2,
    });
    (extra.dispatchToWindow ? window : target).dispatchEvent(event);
    return target.classList.contains('pressed');
  }, { type, pointerId, ...options });

  const firstPressed = await dispatchPointer('pointerdown', 7101);
  assert(firstPressed, `${label}: pointerdownでpressed状態になりません`);
  const duplicatePressed = await dispatchPointer('pointerdown', 7101);
  assert(duplicatePressed, `${label}:同一pointer再downでpressed状態が消えました`);
  const dispatches = await page.evaluate(() => globalThis.__r2ActionDispatches);
  assert(dispatches === 1, `${label}:同一pointer IDの再downが${dispatches}回入力になりました`);

  // Pointer capture can preserve the original button as event.target. The
  // coordinates, rather than target identity, must clear the visual press.
  const rect = await button.boundingBox();
  assert(rect, `${label}:方向ボタン矩形を取得できません`);
  const outside = await dispatchPointer('pointermove', 7101, {
    clientX: rect.x + rect.width + 160,
    clientY: rect.y + rect.height + 160,
  });
  assert(!outside, `${label}:原targetのまま座標外へ移動してもpressedが残りました`);

  const cancelPressed = await dispatchPointer('pointerdown', 7102);
  assert(cancelPressed, `${label}:cancel前pointerdownが受理されません`);
  const afterCancel = await dispatchPointer('pointercancel', 7102);
  assert(!afterCancel, `${label}:pointercancel後もpressedが残りました`);

  const upPressed = await dispatchPointer('pointerdown', 7103);
  assert(upPressed, `${label}:up前pointerdownが受理されません`);
  const afterUp = await dispatchPointer('pointerup', 7103, { dispatchToWindow: true });
  assert(!afterUp, `${label}:window pointerup後もpressedが残りました`);

  const blurPressed = await dispatchPointer('pointerdown', 7104);
  assert(blurPressed, `${label}:blur前pointerdownが受理されません`);
  const afterBlur = await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    return document.querySelector('[data-dir]')?.classList.contains('pressed') || false;
  });
  assert(!afterBlur, `${label}:blur後もpressedが残りました`);

  // A home transition must also clear any held control. Pause first so the
  // transition uses the normal lifecycle path available during a match.
  await dispatchPointer('pointerdown', 7105);
  const pause = await firstVisible(page, ['#btn-pause'], `${label}のポーズボタン`, 1_000);
  await pause.click();
  await firstVisible(page, ['#screen-pause'], `${label}のポーズ画面`, DEFAULT_TIMEOUT);
  const afterPause = await page.locator('[data-dir].pressed').count();
  assert(afterPause === 0, `${label}:ポーズ遷移後もpressed状態が残りました`);
  const home = await firstVisible(page, ['#btn-pause-home'], `${label}のホームボタン`, DEFAULT_TIMEOUT);
  await home.click();
  await firstVisible(page, ['#screen-title'], `${label}のホーム復帰`, DEFAULT_TIMEOUT);
}

async function beginCountdownByName(page, label) {
  const input = await firstVisible(page, [
    '#player-name',
    '[data-testid="player-name"]',
    'input[name="playerName"]',
    'input[name="name"]',
  ], `${label}の名前欄`);
  await input.fill('R2ブラウザ');
  let start;
  try {
    start = await firstVisible(page, [
      '#btn-name-start',
      '[data-testid="name-start"]',
      'button:has-text("この名前で開始")',
      'button:has-text("名前で開始")',
    ], `${label}の名前開始ボタン`, 700);
  } catch (_) {
    start = await firstVisible(page, [
      '#btn-play',
      'button:has-text("プレイ")',
      'button:has-text("開始")',
    ], `${label}のプレイボタン`);
  }
  await start.click();
  await page.waitForFunction(() => {
    const state = String(globalThis.__testSession?.state || '').toUpperCase();
    return state === 'COUNTDOWN' || state === 'RESUME_COUNTDOWN';
  }, undefined, { timeout: DEFAULT_TIMEOUT });
}

async function setDocumentHidden(page, hidden) {
  const installed = await page.evaluate((value) => {
    let ok = false;
    try {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => value,
      });
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => value ? 'hidden' : 'visible',
      });
      ok = document.hidden === value;
    } catch (_) {
      ok = false;
    }
    document.dispatchEvent(new Event('visibilitychange'));
    return ok;
  }, hidden);
  assert(installed, `document.hiddenの${hidden ? '非表示' : '表示'}検査注入に失敗しました`);
}

async function runBrowserSessionRegression(browser, browserName, origin, variant) {
  const context = await newContext(browser, { mobile: true });
  try {
    const page = await context.newPage();
    const observation = observe(page, origin);
    const label = `${browserName}-${variant}-r2-session`;
    try {
      await page.goto(`${origin}${variant === 'split' ? '/' : '/dist.html'}`, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_TIMEOUT,
      });
      await waitForReady(page, label);
      await page.waitForFunction(() => globalThis.__testHookReady && globalThis.__testSession,
        undefined, { timeout: DEFAULT_TIMEOUT });

      // Leaving during the initial 3-2-1 must pause the countdown. Returning
      // only clears the browser flag; the explicit resume button is required.
      await beginCountdownByName(page, label);
      await setDocumentHidden(page, true);
      await page.waitForFunction(() => globalThis.__testSession?.state === 'PAUSED',
        undefined, { timeout: DEFAULT_TIMEOUT });
      await setDocumentHidden(page, false);
      assert(await page.locator('#screen-pause').isVisible(), `${label}: hidden復帰で自動再開しました`);
      const resume = await firstVisible(page, ['#btn-resume'], `${label}の初期countdown再開`);
      await resume.click();
      await waitForPlaying(page, { hook: true, label: `${label} initial resume` });

      // pagehide follows the same explicit pause path and clears a held input.
      const button = page.locator('[data-dir]').first();
      await page.evaluate(() => {
        const target = document.querySelector('[data-dir]');
        const rect = target.getBoundingClientRect();
        target.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          pointerId: 8801,
          pointerType: 'touch',
          button: 0,
          buttons: 1,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
      });
      assert(await button.evaluate((element) => element.classList.contains('pressed')),
        `${label}: pagehide前pointerdownがpressedになりません`);
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await page.waitForFunction(() => globalThis.__testSession?.state === 'PAUSED',
        undefined, { timeout: DEFAULT_TIMEOUT });
      assert(await page.locator('[data-dir].pressed').count() === 0,
        `${label}: pagehide後にpressed状態が残りました`);
      const pagehideResume = await firstVisible(page, ['#btn-resume'], `${label}のpagehide再開`);
      await pagehideResume.click();
      await waitForPlaying(page, { hook: true, label: `${label} pagehide resume` });

      // A real mobile viewport rotation pauses play and requires the same
      // explicit resume after returning to portrait.
      await page.setViewportSize({ width: 667, height: 375 });
      await page.waitForFunction(() => {
        const hint = document.querySelector('#rotate-hint');
        return hint && !hint.classList.contains('hidden');
      }, undefined, { timeout: DEFAULT_TIMEOUT });
      await page.waitForFunction(() => globalThis.__testSession?.state === 'PAUSED',
        undefined, { timeout: DEFAULT_TIMEOUT });
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForFunction(() => {
        const hint = document.querySelector('#rotate-hint');
        return hint && hint.classList.contains('hidden');
      }, undefined, { timeout: DEFAULT_TIMEOUT });
      assert(await page.locator('#screen-pause').isVisible(), `${label}:縦復帰で自動再開しました`);
      const orientationResume = await firstVisible(page, ['#btn-resume'], `${label}の縦復帰再開`);
      await orientationResume.click();
      await waitForPlaying(page, { hook: true, label: `${label} orientation resume` });
      await saveScreenshot(page, label, 'lifecycle');
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await context.close();
  }
}

async function runShareFallback(browser, browserName, origin, variant) {
  const context = await newContext(browser, { blocked: true });
  try {
    const page = await context.newPage();
    const observation = observe(page, origin);
    const label = `${browserName}-${variant}-share-fallback`;
    try {
      await page.goto(`${origin}${variant === 'split' ? '/' : '/dist.html'}`, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_TIMEOUT,
      });
      await waitForReady(page, label);
      await page.evaluate(() => {
        try {
          Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
        } catch (_) { /* 未対応ブラウザ */ }
        try {
          Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async () => { throw new Error('clipboard disabled by R1 test'); } },
          });
        } catch (_) { /* 未対応ブラウザ */ }
      });

      const bodyText = await page.locator('body').innerText();
      assert(!/ランキング/.test(bodyText), `${label}:ランキングUI/文言を移植しています`);
      const experimentLink = await firstVisible(page, [
        'a:has-text("実験場")',
        'a:has-text("カメレオンJP")',
      ], `${label}の実験場リンク`);
      const href = await experimentLink.getAttribute('href');
      assert(href && /^https:\/\//.test(href), `${label}:実験場リンクのURLがありません`);

      const share = await firstVisible(page, [
        '#btn-home-share',
        '#btn-share',
        '[data-testid="share"]',
        'button:has-text("ゲームをシェア")',
        'button:has-text("共有")',
        'button:has-text("シェア")',
      ], `${label}の共有ボタン`);
      await share.click();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="status"], .platform-status')]
        .some((element) => element.textContent.trim().length > 0), undefined, { timeout: DEFAULT_TIMEOUT });
      const shareField = await firstVisible(page, [
        '[data-share-text]',
        '#result-share-text',
        'textarea[aria-label*="シェア"]',
        'textarea',
        'input[id*="share"]',
      ], `${label}の共有文選択欄`);
      const shareInfo = await page.evaluate(() => {
        const element = document.activeElement;
        return {
          id: element?.id || '',
          value: element?.value || '',
          selected: typeof element?.selectionStart === 'number'
            && typeof element?.selectionEnd === 'number'
            && element.selectionEnd > element.selectionStart,
        };
      });
      assert(shareInfo.id === await shareField.getAttribute('id') && shareInfo.selected,
        `${label}:コピー不可時に現在見えている共有文を選択できません`);
      assert(!/(?:file:|localhost|127\.0\.0\.1|[?&](?:test|r1|debug)=)/i.test(shareInfo.value),
        `${label}:正式URL未設定なのにローカル/検査URLを共有文へ入れています`);
      await saveScreenshot(page, label, 'fallback');
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await context.close();
  }
}

async function runFileFlow(browser, browserName) {
  assert(existsSync(DIST_FILE), `file://検査対象がありません: ${DIST_FILE}`);
  const context = await newContext(browser, { blocked: true });
  try {
    const page = await context.newPage();
    const observation = observe(page, 'file://');
    const label = `${browserName}-dist-file`;
    try {
      await page.goto(pathToFileURL(DIST_FILE).href, {
        waitUntil: 'domcontentloaded',
        timeout: DEFAULT_TIMEOUT,
      });
      await waitForReady(page, label);
      await assertTitleScreen(page, label);
      const hook = await page.evaluate(() => globalThis.__testGame);
      assert(hook === undefined, `${label}: file://無改変起動にテストハンドルが混入しています`);
      await startByName(page, { hook: false, label });
      await saveScreenshot(page, label, 'playing');
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await context.close();
  }
}

async function runPracticeBlankNameRegression(browser, browserName, origin) {
  const context = await newContext(browser);
  // 旧保存名が残る状態から、ホーム上の表示名を空に戻す経路を再現する。
  await context.addInitScript(() => {
    try { localStorage.setItem('paripari.player-name', '旧保存名'); } catch (_) { /* 検査対象外 */ }
  });
  try {
    const page = await context.newPage();
    const observation = observe(page, origin);
    const label = `${browserName}-practice-empty-name`;
    try {
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
      await waitForReady(page, label);
      await page.waitForFunction(() => globalThis.__testHookReady && globalThis.__testGame,
        undefined, { timeout: DEFAULT_TIMEOUT });
      const input = await firstVisible(page, ['#player-name', 'input[name="name"]'], `${label}の名前欄`);
      assert(await input.inputValue() === '旧保存名', `${label}: 保存済みの旧名を再現できません`);
      await input.fill('');

      const howto = await firstVisible(page, ['#btn-howto', 'button:has-text("遊び方")'], `${label}の遊び方`);
      await howto.click();
      const practice = await firstVisible(page, [
        '#btn-howto-try',
        'button:has-text("練習してみる")',
      ], `${label}の練習開始`);
      await practice.click();
      await page.waitForFunction(() => {
        const game = globalThis.__testGame;
        return game && String(game.state || '').toUpperCase() === 'PLAYING';
      }, undefined, { timeout: DEFAULT_TIMEOUT });

      // 練習の5攻撃を実際のGame.updateで失敗確定させ、GameがpracticeDoneを
      // 通知する自然な経路を通す。攻撃予定は現在のGameClockから相対設定し、
      // 本番時計やGame.updateの引数をテストから直接変更しない。
      for (let i = 0; i < 5; i++) {
        const beforeWarmup = await page.evaluate(() => globalThis.__testGame?.warmupRemaining);
        await prepareAttack(page, { mode: 'practice', taps: 1, hp: 3, impactOffset: 80 });
        await page.waitForFunction((previous) => {
          const game = globalThis.__testGame;
          const state = String(game?.state || '').toUpperCase();
          return state !== 'PLAYING' || Number(game?.warmupRemaining) < Number(previous);
        }, beforeWarmup, { timeout: DEFAULT_TIMEOUT });
      }
      await firstVisible(page, ['#screen-howto', 'h2:has-text("遊び方")'],
        `${label}の練習完了後画面`);
      const readyVisible = await page.locator('#screen-ready').isVisible().catch(() => false);
      assert(!readyVisible, `${label}: 任意練習完了後に本番カウントダウンが始まりました`);
      const state = await page.evaluate(() => String(globalThis.__testGame?.state || '').toUpperCase());
      assert(state !== 'PLAYING' && state !== 'RUNNING', `${label}: 任意練習完了後にゲームが続行しています`);

      const back = await firstVisible(page, ['#btn-howto-back', 'button:has-text("もどる")'], `${label}の戻る`);
      await back.click();
      const blankInput = await firstVisible(page, ['#player-name', 'input[name="name"]'], `${label}の空名欄`);
      await blankInput.fill('仮');
      await blankInput.dispatchEvent('compositionstart');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      const afterCompositionState = await page.evaluate(() => ({
        state: String(globalThis.__testGame?.state || '').toUpperCase(),
        ready: !document.querySelector('#screen-ready')?.classList.contains('hidden'),
      }));
      assert(afterCompositionState.state !== 'PLAYING' && !afterCompositionState.ready,
        `${label}: 変換中Enterで本番カウントダウンが始まりました`);
      await blankInput.dispatchEvent('compositionend');

      await blankInput.fill('');
      const play = await firstVisible(page, ['#btn-play', 'button:has-text("プレイ")'], `${label}のプレイ`);
      await play.click();
      const error = await firstVisible(page, ['#name-error', '[role="alert"]'], `${label}の空名エラー`);
      assert((await error.innerText()).trim().length > 0, `${label}: 空名開始の説明がありません`);
      const finalState = await page.evaluate(() => String(globalThis.__testGame?.state || '').toUpperCase());
      assert(finalState !== 'PLAYING' && finalState !== 'RUNNING', `${label}: 空名でも本番が開始されました`);
      await saveScreenshot(page, label, 'home');
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await context.close();
  }
}

async function runCase(name, action) {
  currentCaseName = name;
  const started = Date.now();
  try {
    await action();
    results.push({ name, status: 'PASS', ms: Date.now() - started });
    console.log(`✓ ${name}`);
  } catch (error) {
    results.push({ name, status: 'FAIL', ms: Date.now() - started, error: describeError(error) });
    console.error(`✗ ${name}\n${describeError(error)}`);
  }
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  assert(existsSync(DIST_FILE), `dist/paripari.htmlがありません。先に npm run build を実行してください: ${DIST_FILE}`);

  const normalServer = createStaticServer({ inject: false });
  const hookServer = createStaticServer({ inject: true });
  const normalOrigin = await normalServer.start();
  const hookOrigin = await hookServer.start();

  try {
    for (const browserName of requestedBrowsers) {
      await runCase(`${browserName}: browser起動必須`, async () => {
        // 起動処理をこのケースで実行し、未導入を成功スキップしない。
        const browser = await launchBrowser(browserName);
        await browser.close();
      });

      let browser;
      try {
        browser = await launchBrowser(browserName);
      } catch (error) {
        // 起動必須ケースが具体的な理由を記録済みなので、同じブラウザの
        // 後続ケースは環境エラーとして一件にまとめて継続する。
        console.error(`${browserName}: 後続検査を実施できません: ${describeError(error)}`);
        continue;
      }
      try {
        await runCase(`${browserName}: 分割/生成HTMLの通常起動・PC表示`,
          () => runDesktopSmoke(browser, browserName, normalOrigin, 'normal'));
        await runCase(`${browserName}: タッチ併用PCとiPhone横向き案内`,
          () => runOrientationTouchRegression(browser, browserName, normalOrigin));
        for (const variant of ['split', 'dist']) {
          await runCase(`${browserName}: ${variant}の名前→成功/誤方向/timeout→結果→retry`,
            () => runHookFlow(browser, browserName, hookOrigin, variant));
          await runCase(`${browserName}: ${variant}のR2初期countdown/pagehide/縦横復帰`,
            () => runBrowserSessionRegression(browser, browserName, hookOrigin, variant));
          await runCase(`${browserName}: ${variant}スマホ5ボタン`,
            () => runMobileFlow(browser, browserName, hookOrigin, variant, false));
          await runCase(`${browserName}: ${variant}短画面開始`,
            () => runMobileFlow(browser, browserName, hookOrigin, variant, true));
          await runCase(`${browserName}: ${variant}共有フォールバック`,
            () => runShareFallback(browser, browserName, hookOrigin, variant));
        }
        await runCase(`${browserName}: 保存済み旧名→空名・任意練習完了の回帰`,
          () => runPracticeBlankNameRegression(browser, browserName, hookOrigin));
        await runCase(`${browserName}: 生成HTML file://・保存/共有非対応でも開始`,
          () => runFileFlow(browser, browserName));
      } finally {
        await browser.close();
      }
    }
  } finally {
    await normalServer.close();
    await hookServer.close();
  }

  const pass = results.filter((result) => result.status === 'PASS').length;
  const failCount = results.filter((result) => result.status === 'FAIL').length;
  console.log(`\nR2/current browser: ${pass} passed, ${failCount} failed`);
  console.log(`screenshots: ${ARTIFACT_DIR}`);
  if (failCount) process.exitCode = 1;
}

await main();
