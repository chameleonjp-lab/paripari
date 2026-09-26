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
    window.addEventListener('keydown', (event) => retain(history.events, {
      type: 'keydown', key: event.key, eventTime: event.timeStamp, wall: performance.now(),
    }), { capture: true });
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
      clockMode: globalThis.__browserClockMode || 'native',
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

async function newContext(browser, { mobile = false, short = false, blocked = false, clocked = false, learned = true } = {}) {
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
  if (clocked) {
    // 診断用rAFを含め、ページ側で時刻APIを使う前に導入する。
    await context.clock.install();
    await context.addInitScript(() => { globalThis.__browserClockMode = 'controlled'; });
  }
  await installFrameDiagnostics(context);
  if (learned && !blocked) {
    // R2 regressions exercise an already-trained player. First use is covered
    // separately through all five real practice attacks, including storage loss.
    await context.addInitScript(() => localStorage.setItem('paripari.tutorial.v1', 'true'));
  }
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

async function waitForPlaying(page, { hook = false, label = 'ゲーム', clocked = false } = {}) {
  if (clocked) {
    const countdown = await page.evaluate(() => {
      const state = String(globalThis.__testSession?.state || '').toUpperCase();
      return state === 'COUNTDOWN' || state === 'RESUME_COUNTDOWN';
    });
    if (countdown) await page.clock.runFor(2_300);
  }
  if (hook) {
    await page.waitForFunction(() => {
      const game = globalThis.__testGame;
      const state = game && String(game.state || '').toUpperCase();
      const sessionState = globalThis.__testSession?.state;
      return (state === 'PLAYING' || state === 'RUNNING')
        && (sessionState === 'PLAYING' || sessionState === 'PRACTICE');
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

async function startByName(page, { hook = false, label = 'ゲーム', clocked = false } = {}) {
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
  await markBrowserEvent(page, 'start-click-before');
  await start.click();
  await markBrowserEvent(page, 'start-click-after');
  await waitForPlaying(page, { hook, label, clocked });
}

async function pauseClockAtHome(page, label) {
  const home = await page.evaluate(() => ({
    state: String(globalThis.__testSession?.state || '').toUpperCase(),
    titleVisible: !!document.querySelector('#screen-title')
      && !document.querySelector('#screen-title').classList.contains('hidden'),
  }));
  assert(home.state === 'HOME' && home.titleVisible,
    `${label}: clock停止前にHOMEではありません ${JSON.stringify(home)}`);
  // Keep the page live through initialization, then pause its timers while the
  // user is still at HOME. A generous virtual offset avoids racing protocol
  // latency while advancing no gameplay state.
  await page.clock.pauseAt(new Date(Date.now() + 60_000));
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
    const session = globalThis.__testSession;
    const expectedMode = requestedMode === 'practice' ? 'practice' : 'normal';
    const expectedSessionState = expectedMode === 'practice' ? 'PRACTICE' : 'PLAYING';
    if (!game || !clock || !session || typeof clock.now !== 'function') {
      throw new Error('R2 test hookのGame/Clock/Sessionがありません');
    }
    if (!game.isPlaying() || String(game.state).toUpperCase() !== 'PLAYING'
      || game.mode !== expectedMode || String(session.state).toUpperCase() !== expectedSessionState
      || session.mode !== expectedMode || !clock.running) {
      throw new Error(`fixtureを準備できない状態です: ${JSON.stringify({
        gameState: game.state,
        gameMode: game.mode,
        sessionState: session.state,
        sessionMode: session.mode,
        clockRunning: clock.running,
        pauseReason: session.pauseReason,
      })}`);
    }
    const now = clock.now(performance.now());
    if (!Number.isFinite(now)) throw new Error('R2 test clockの現在時刻を取得できません');
    if (typeof game.clearInputs === 'function') game.clearInputs();
    if (requestedMode === 'practice' && !(game.warmupRemaining > 0)) {
      throw new Error('練習の残数がありません');
    }
    if (requestedMode === 'normal') game.warmupRemaining = 0;
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

async function fixtureDiagnostics(page, index) {
  return page.evaluate((segmentIndex) => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    const session = globalThis.__testSession;
    const wall = performance.now();
    const attack = game?.attack;
    const segment = attack?.segments?.[segmentIndex] || null;
    return {
      inputEvents: globalThis.__browserFrameDiagnostics?.events?.filter((event) => event.type === 'keydown'),
      clocks: {
        wall,
        gameNow: clock && Number.isFinite(wall) ? clock.now(wall) : null,
        running: clock?.running ?? null,
        elapsed: clock?._elapsed ?? null,
        activeStart: clock?._activeStart ?? null,
      },
      game: game && {
        state: game.state,
        mode: game.mode,
        gameTime: game.gameTime,
        hp: game.hp,
        score: game.score,
        successCount: game.successCount,
        inputQueue: game._inputQueue?.map(({ dir, time, receivedAt, roundId }) => ({
          dir, time, receivedAt, roundId,
        })) || [],
      },
      attack: attack && {
        result: attack.result,
        resolved: attack.resolved,
        resolvedAt: attack.resolvedAt,
        segIndex: attack.segIndex,
        segment,
      },
      session: session && {
        state: session.state,
        mode: session.mode,
        pauseReason: session.pauseReason,
        resumeState: session.resumeState,
        lastPresentedWall: session.lastPresentedWall,
      },
    };
  }, index);
}

async function withFixtureDiagnostics(page, index, label, action) {
  try {
    return await action();
  } catch (error) {
    let diagnostics = null;
    try { diagnostics = await fixtureDiagnostics(page, index); } catch (_) { /* page may have closed */ }
    throw new Error(`${label}: fixture segment ${index} failed: ${describeError(error)}\nfixture=${JSON.stringify(diagnostics)}`);
  }
}

async function advanceToFixtureSegment(page, index, { clocked = false } = {}) {
  if (clocked) {
    const advanceMs = await page.evaluate((segmentIndex) => {
      const game = globalThis.__testGame;
      const clock = globalThis.__testClock;
      const segment = game?.attack?.segments?.[segmentIndex];
      if (!segment || !clock) throw new Error(`fixture segment ${segmentIndex} is missing`);
      const remaining = segment.impactAt - 20 - clock.now(performance.now());
      if (!Number.isFinite(remaining) || remaining < 0) {
        throw new Error(`fixture segment ${segmentIndex} input window is already late (${remaining}ms)`);
      }
      return remaining;
    }, index);
    await page.clock.runFor(advanceMs);
    return;
  }
  await page.waitForFunction((segmentIndex) => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    const segment = game?.attack?.segments?.[segmentIndex];
    return !!segment && !!clock && clock.now(performance.now()) >= segment.impactAt - 20;
  }, index, { timeout: DEFAULT_TIMEOUT });
}

async function advancePastFixtureTimeout(page, index = 0) {
  const advanceMs = await page.evaluate((segmentIndex) => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    const segment = game?.attack?.segments?.[segmentIndex];
    if (!segment || !clock) throw new Error(`fixture segment ${segmentIndex} is missing`);
    // The timeout closes after impact + GOOD_WINDOW + the 50ms delivery watermark.
    const remaining = segment.impactAt + 240 - clock.now(performance.now());
    if (!Number.isFinite(remaining) || remaining < 0) {
      throw new Error(`fixture segment ${segmentIndex} timeout is already late (${remaining}ms)`);
    }
    return remaining;
  }, index);
  await page.clock.runFor(advanceMs);
}

async function pressFixtureSegment(page, index, label, { clocked = false } = {}) {
  return withFixtureDiagnostics(page, index, label, async () => {
    await advanceToFixtureSegment(page, index, { clocked });
    await page.keyboard.press('ArrowRight');
    if (clocked) await page.clock.runFor(80);
    await page.waitForFunction((segmentIndex) => {
      const segment = globalThis.__testGame?.attack?.segments?.[segmentIndex];
      return !!segment?.resolved;
    }, index, { timeout: DEFAULT_TIMEOUT });
    if (label && !clocked) await page.waitForTimeout(0);
  });
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
  await waitForPlaying(page, { hook: true, label, clocked: true });

  // 単発の成功はGameの内部状態だけを準備し、判定そのものは実キー配線で行う。
  await prepareAttack(page, { needDir: 'R', taps: 1, hp: 3 });
  const beforeSuccess = await currentGameStats(page);
  await pressFixtureSegment(page, 0, label, { clocked: true });
  await page.waitForFunction((previous) => {
    const game = globalThis.__testGame;
    return game && Number(game.successCount) > Number(previous);
  }, beforeSuccess.successCount, { timeout: DEFAULT_TIMEOUT });

  // 方向違いは同じ実キー配線からMISSになり、ライフを1だけ失う。
  await prepareAttack(page, { needDir: 'R', taps: 1, hp: 3 });
  await withFixtureDiagnostics(page, 0, `${label} wrong direction`, async () => {
    await advanceToFixtureSegment(page, 0, { clocked: true });
    await page.keyboard.press('ArrowLeft');
    await page.clock.runFor(80);
    await page.waitForFunction(() => globalThis.__testGame && globalThis.__testGame.hp === 2,
      undefined, { timeout: DEFAULT_TIMEOUT });
  });

  // 制御したブラウザ時間を進め、製品の更新ループでtimeoutを確定させる。
  await prepareAttack(page, { needDir: 'R', taps: 1, hp: 3 });
  await withFixtureDiagnostics(page, 0, `${label} timeout`, async () => {
    await advancePastFixtureTimeout(page);
    await page.waitForFunction(() => globalThis.__testGame && globalThis.__testGame.hp === 2,
      undefined, { timeout: DEFAULT_TIMEOUT });
  });

  // 3分割の成功も内部オブジェクトだけを準備し、3回のキー入力は実配線を通す。
  await prepareAttack(page, { needDir: 'R', taps: 3, hp: 3 });
  const beforeThree = await currentGameStats(page);
  for (let i = 0; i < 3; i++) await pressFixtureSegment(page, i, label, { clocked: true });
  await page.waitForFunction((previous) => {
    const game = globalThis.__testGame;
    return game && Number(game.successCount) >= Number(previous) + 3;
  }, beforeThree.successCount, { timeout: DEFAULT_TIMEOUT });

  // ライフ0→リザルトを確認する。結果生成は1試合につき1回だけでよいが、
  // ここでは表示到達と直後のリトライ導線を受入条件にする。
  await prepareAttack(page, { needDir: 'R', taps: 1, hp: 1 });
  await withFixtureDiagnostics(page, 0, `${label} result`, async () => {
    await advanceToFixtureSegment(page, 0, { clocked: true });
    await page.keyboard.press('ArrowLeft');
    await page.clock.runFor(80);
    await page.waitForFunction(() => {
      const game = globalThis.__testGame;
      const result = document.querySelector('#screen-result');
      return game && String(game.state || '').toUpperCase() === 'OVER'
        && result && !result.classList.contains('hidden')
        && getComputedStyle(result).display !== 'none';
    }, undefined, { timeout: DEFAULT_TIMEOUT });
  });
  await saveScreenshot(page, label, 'result');
  await settleAfterScreenshot(page, { clocked: true });

  const retry = await firstVisible(page, [
    '#btn-retry',
    '[data-testid="retry"]',
    'button:has-text("もう一回")',
    'button:has-text("リトライ")',
  ], `${label}のリトライ`);
  await retry.click();
  await waitForPlaying(page, { hook: true, label: `${label} retry`, clocked: true });
}

async function runLongGapRegression(page, label) {
  await prepareAttack(page, { impactOffset: 500 });
  const ready = await page.evaluate(() => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    const session = globalThis.__testSession;
    if (!game?.isPlaying() || game.state !== 'PLAYING' || game.mode !== 'normal'
      || session?.state !== 'PLAYING' || session.mode !== 'normal' || !clock?.running) {
      throw new Error(`longgap開始状態が不正です: ${JSON.stringify({
        gameState: game?.state, gameMode: game?.mode,
        sessionState: session?.state, sessionMode: session?.mode,
        clockRunning: clock?.running, pauseReason: session?.pauseReason,
      })}`);
    }
    game.clearInputs();
    globalThis.__longGapEnqueueRecords = [];
    const enqueue = game.enqueueAction;
    game.enqueueAction = function (action = {}) {
      const accepted = enqueue.call(this, action);
      const queued = this._inputQueue[this._inputQueue.length - 1] || null;
      globalThis.__longGapEnqueueRecords.push({
        dir: action.dir,
        time: action.time,
        receivedAt: action.receivedAt,
        roundId: action.roundId,
        accepted,
        queued: queued && {
          dir: queued.dir, time: queued.time, receivedAt: queued.receivedAt, roundId: queued.roundId,
        },
      });
      return accepted;
    };
    return {
      gameTime: game.gameTime,
      hp: game.hp,
      score: game.score,
      presentedWall: session.lastPresentedWall,
      clockAtPresented: clock.now(session.lastPresentedWall),
      attackId: game.attack.id,
      impactAt: game.attack.segments[0].impactAt,
    };
  });

  await page.keyboard.press('ArrowRight');
  const beforeGap = await page.evaluate(() => ({
    records: globalThis.__longGapEnqueueRecords || [],
    queued: globalThis.__testGame?._inputQueue?.map(({ dir, time, receivedAt, roundId }) => ({
      dir, time, receivedAt, roundId,
    })) || [],
    gameTime: globalThis.__testGame?.gameTime,
    hp: globalThis.__testGame?.hp,
    score: globalThis.__testGame?.score,
    roundId: globalThis.__testGame?.roundId,
  }));
  const dispatch = beforeGap.records[0];
  assert(beforeGap.records.length === 1 && dispatch?.accepted && dispatch.dir === 'R'
    && dispatch.queued?.dir === 'R' && beforeGap.queued.length === 1,
  `${label}: longgap前の実キーが1件のR入力としてqueueされません ${JSON.stringify(beforeGap)}`);
  assert(Number.isFinite(dispatch.time) && Number.isFinite(dispatch.receivedAt)
    && dispatch.time >= 0 && dispatch.receivedAt >= dispatch.time
    && dispatch.receivedAt - dispatch.time <= 50,
  `${label}: longgap前の実キー時刻が不正です ${JSON.stringify(dispatch)}`);

  await page.clock.fastForward(1_000);
  const afterGap = await page.evaluate(() => {
    const game = globalThis.__testGame;
    const clock = globalThis.__testClock;
    const session = globalThis.__testSession;
    return {
      gameState: game?.state,
      gameTime: game?.gameTime,
      hp: game?.hp,
      score: game?.score,
      inputQueue: game?._inputQueue?.length ?? null,
      clockRunning: clock?.running ?? null,
      clockNow: clock && Number.isFinite(performance.now()) ? clock.now(performance.now()) : null,
      sessionState: session?.state,
      pauseReason: session?.pauseReason,
      lastPresentedWall: session?.lastPresentedWall,
      attackId: game?.attack?.id,
      attackResolved: game?.attack?.resolved,
      segmentResolved: game?.attack?.segments[0]?.resolved,
      impactAt: game?.attack?.segments[0]?.impactAt,
    };
  });
  const pausedUI = await page.locator('#screen-pause').isVisible();
  const gapEvidence = { ready, beforeGap, afterGap, pausedUI };
  assert(afterGap.sessionState === 'PAUSED' && afterGap.pauseReason === 'stall'
    && afterGap.gameState === 'PAUSED' && pausedUI,
  `${label}: fastForward後にstall pause UIへ遷移しません ${JSON.stringify(gapEvidence)}`);
  assert(afterGap.gameTime === ready.gameTime && afterGap.hp === ready.hp
    && afterGap.score === ready.score && afterGap.clockRunning === false
    && afterGap.clockNow === ready.clockAtPresented && afterGap.inputQueue === 0
    && afterGap.attackId === ready.attackId && afterGap.impactAt === ready.impactAt
    && afterGap.attackResolved === false && afterGap.segmentResolved === false,
  `${label}: stall時に最後のpresented状態を保持できません ${JSON.stringify(gapEvidence)}`);

  await page.clock.runFor(500);
  const stillPaused = await page.evaluate(() => ({
    sessionState: globalThis.__testSession?.state,
    pauseReason: globalThis.__testSession?.pauseReason,
    gameState: globalThis.__testGame?.state,
  }));
  assert(stillPaused.sessionState === 'PAUSED' && stillPaused.pauseReason === 'stall'
    && stillPaused.gameState === 'PAUSED' && await page.locator('#screen-pause').isVisible(),
  `${label}: stall後に自動再開しました ${JSON.stringify(stillPaused)}`);

  const resume = await firstVisible(page, ['#btn-resume'], `${label}のstall再開`);
  await resume.click();
  const countdownStart = await page.evaluate(() => ({
    state: globalThis.__testSession?.state,
    screenVisible: !document.querySelector('#screen-ready')?.classList.contains('hidden'),
    text: document.querySelector('#countdown')?.textContent?.trim(),
  }));
  assert(countdownStart.state === 'RESUME_COUNTDOWN' && countdownStart.screenVisible
    && countdownStart.text === '3',
  `${label}: 明示resume後の3カウントが始まりません ${JSON.stringify(countdownStart)}`);
  // 700ms境界の直後では最後のrAFがまだ境界前のことがあるため、
  // 各表示区間の内側を読む。厳密な境界はSessionの単体検査で確認する。
  await page.clock.runFor(1_000);
  const countdownTwo = await page.locator('#countdown').innerText();
  assert(countdownTwo.trim() === '2', `${label}: resume countdown 2を確認できません: ${countdownTwo}`);
  await page.clock.runFor(700);
  const countdownOne = await page.locator('#countdown').innerText();
  assert(countdownOne.trim() === '1', `${label}: resume countdown 1を確認できません: ${countdownOne}`);
  await page.clock.runFor(700);
  const resumed = await page.evaluate(() => ({
    sessionState: globalThis.__testSession?.state,
    gameState: globalThis.__testGame?.state,
    clockRunning: globalThis.__testClock?.running,
  }));
  assert(resumed.sessionState === 'PLAYING' && resumed.gameState === 'PLAYING'
    && resumed.clockRunning === true,
  `${label}: 明示resumeの3-2-1後にPLAYINGへ戻りません ${JSON.stringify(resumed)}`);
}

function artifactPath(label, suffix) {
  const safe = `${label}-${suffix}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
  return resolve(ARTIFACT_DIR, `${safe}.png`);
}

async function saveScreenshot(page, label, suffix) {
  await markBrowserEvent(page, 'screenshot-start', { label, suffix });
  await page.screenshot({ path: artifactPath(label, suffix) });
  await markBrowserEvent(page, 'screenshot-end', { label, suffix });
}

async function markBrowserEvent(page, type, details = {}) {
  await page.evaluate(({ type, details }) => {
    const history = globalThis.__browserFrameDiagnostics;
    if (!history) return;
    history.events.push({ type, wall: performance.now(), ...details });
    if (history.events.length > 60) history.events.shift();
  }, { type, details });
}

// WebKitの画面取得はrAFを長く止める場合がある。HOME/RESULTで撮影した後は、
// 実際に描画が戻ったことを確認してから新しい試合を始める。製品時計は操作しない。
async function settleAfterScreenshot(page, { clocked = false } = {}) {
  if (clocked) {
    await page.clock.runFor(64);
    return;
  }
  const settling = page.evaluate(({ timeout, threshold }) => new Promise((resolveFrames, reject) => {
    let previous = null;
    let stable = 0;
    let stopped = false;
    const recent = [];
    const timer = setTimeout(() => {
      stopped = true;
      reject(new Error('撮影後の描画が安定しません'));
    }, timeout);
    const sample = (wall) => {
      if (stopped) return;
      if (previous != null) {
        const gap = wall - previous;
        recent.push(gap);
        if (recent.length > 8) recent.shift();
        stable = gap <= threshold ? stable + 1 : 0;
      }
      previous = wall;
      if (stable >= 3) {
        clearTimeout(timer);
        resolveFrames(recent);
      } else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), { timeout: DEFAULT_TIMEOUT, threshold: 250 });
  const gaps = await settling;
  await markBrowserEvent(page, 'screenshot-frames-restored', { gaps });
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
          await settleAfterScreenshot(page);
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
  const context = await newContext(browser, { clocked: true });
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
      await pauseClockAtHome(page, label);
      await startByName(page, { hook: true, label, clocked: true });
      await runInputAndResultFlow(page, label);
      await runLongGapRegression(page, label);
      // 描画取得後はこのpageで入力時刻の検査を続けない。
      await saveScreenshot(page, label, 'playing');
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
        // このケースは5方向の実タッチと押下解除の検査。自然出現が途中で
        // 重ならない「攻撃なし」のfixtureにする。時計・rAF・入力配線は実体。
        // 攻撃の判定と描画はrunInputAndResultFlowの実キー経路で別に検査する。
        const game = globalThis.__testGame;
        if (!game?.isPlaying()) throw new Error('タッチ検査の開始時にGameが停止しています');
        game.attack = null;
        game.nextSpawnAt = Infinity;
        game.clearInputs();
        globalThis.__r1PointerDowns = 0;
        document.addEventListener('pointerdown', () => { globalThis.__r1PointerDowns++; }, { capture: true });
      });
      await markBrowserEvent(page, 'empty-attack-input-fixture');
      for (let i = 0; i < await buttons.count(); i++) await buttons.nth(i).tap();
      await page.waitForFunction(() => (globalThis.__r1PointerDowns || 0) >= 5,
        undefined, { timeout: DEFAULT_TIMEOUT });
      if (!short) {
        await page.evaluate(() => globalThis.__testGame.clearInputs());
        await runPointerLifecycleRegression(page, label);
        // 回帰の最後はHOMEへ戻るため、証拠用に明示的にもう一度開始する。
        await startByName(page, { hook: true, label });
      }
      await saveScreenshot(page, label, 'buttons');
      assertHealthy(observation, label);
    } finally {
      await closeObservedPage(page);
    }
  } finally {
    await context.close();
  }
}

async function runPointerLifecycleRegression(page, label) {
  await runNativeKeyRegression(page, label);
  await markBrowserEvent(page, 'pointer-lifecycle-start');
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

async function runNativeKeyRegression(page, label) {
  // 時間制御を使わず、実際のEvent.timeStamp→GameClock→Game受付を残す。
  // 攻撃なしの場面なので、検査通信に80msの入力期限を競わせない。
  await page.evaluate(() => {
    const game = globalThis.__testGame;
    if (globalThis.__browserClockMode === 'controlled' || !game?.isPlaying()
      || globalThis.__testSession?.state !== 'PLAYING' || game.attack != null) {
      throw new Error('実時間キー検査には通常時計・本番中・攻撃なしが必要です');
    }
    const original = game.enqueueAction;
    const probe = { original, records: [] };
    globalThis.__nativeKeyProbe = probe;
    game.enqueueAction = function (action) {
      const accepted = original.call(this, action);
      probe.records.push({ ...action, accepted });
      return accepted;
    };
  });
  let records;
  try {
    await page.keyboard.press('ArrowRight');
    records = await page.evaluate(() => globalThis.__nativeKeyProbe.records);
  } finally {
    await page.evaluate(() => {
      globalThis.__testGame.enqueueAction = globalThis.__nativeKeyProbe.original;
      globalThis.__testGame.clearInputs();
      delete globalThis.__nativeKeyProbe;
    });
  }
  const action = records?.[0];
  assert(records?.length === 1 && action.accepted && action.dir === 'R'
    && Number.isFinite(action.time) && Number.isFinite(action.receivedAt)
    && action.time >= 0 && action.receivedAt >= action.time
    && action.receivedAt - action.time <= 50,
  `${label}: 実時間のキー入力を1件受理できません ${JSON.stringify(records)}`);
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
  await markBrowserEvent(page, 'start-click-before');
  await start.click();
  await markBrowserEvent(page, 'start-click-after');
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

async function playPracticeStep(page, index, success, label) {
  const spawnDelay = await page.evaluate(() => {
    const game = globalThis.__testGame;
    if (game.attack && !game.attack.resolved) return 0;
    return Math.max(0, game.nextSpawnAt - globalThis.__testClock.now(performance.now())) + 32;
  });
  if (spawnDelay) await page.clock.runFor(spawnDelay);
  const info = await page.evaluate(() => ({
    dir: globalThis.__testGame.attack?.dir,
    needDir: globalThis.__testGame.attack?.needDir,
    remaining: globalThis.__testGame.warmupRemaining,
    guide: document.querySelector('#practice-guide')?.textContent,
    highlighted: document.querySelector('[data-dir].tutorial-target')?.dataset.dir,
  }));
  assert(info.dir === ['L', 'R', 'U', 'UL', 'UR'][index], `${label}: practice direction ${index}: ${JSON.stringify(info)}`);
  assert(info.remaining === 5 - index && info.highlighted === info.needDir && info.guide?.includes(`${index + 1}`),
    `${label}: guide/progress must match actual attack ${JSON.stringify(info)}`);
  if (success) {
    await advanceToFixtureSegment(page, 0, { clocked: true });
    await page.keyboard.press({ R: 'ArrowRight', L: 'ArrowLeft', D: 'ArrowDown', DR: 'e', DL: 'q' }[info.needDir]);
    await page.clock.runFor(80);
  } else await advancePastFixtureTimeout(page);
  const after = await page.evaluate(() => {
    const g = globalThis.__testGame;
    return { remaining: g.warmupRemaining, hp: g.hp,
      stats: [g.score, g.combo, g.maxCombo, g.successCount, g.perfectCount, g.perfectStreak, g.totalAttempts] };
  });
  assert(after.remaining === 5 - index - (success ? 1 : 0), `${label}: success-only progress ${JSON.stringify(after)}`);
  assert(after.hp === 3 && after.stats.every((value) => value === 0), `${label}: practice polluted normal stats ${JSON.stringify(after)}`);
}

async function runFirstUseFlow(browser, browserName, origin, variant, blocked) {
  const context = await newContext(browser, { clocked: true, learned: false, blocked });
  const page = await context.newPage();
  const observation = observe(page, origin);
  const label = `${browserName}-${variant}-first-use-${blocked ? 'memory' : 'saved'}`;
  try {
    await page.goto(`${origin}${variant === 'split' ? '/' : '/dist.html'}`, { waitUntil: 'domcontentloaded' });
    await waitForReady(page, label);
    await pauseClockAtHome(page, label);
    await page.locator('#player-name').fill('練習から本番');
    await page.locator('#btn-play').click();
    assert(await page.evaluate(() => globalThis.__testSession.state === 'PRACTICE'), `${label}: first use must practice`);
    await playPracticeStep(page, 0, false, label);
    // Abort must not persist completion or leak a pending practice result.
    await page.locator('#btn-practice-home').click();
    await page.locator('#btn-play').click();
    const practiceBounds = await page.locator('#controls [data-dir]').evaluateAll((buttons) =>
      buttons.map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { x, y, width, height };
      }));
    for (let i = 0; i < 5; i++) await playPracticeStep(page, i, true, label);
    assert(await page.evaluate(() => globalThis.__testSession.state === 'COUNTDOWN'), `${label}: first use needs normal countdown`);
    await waitForPlaying(page, { hook: true, clocked: true, label });
    const normalBounds = await page.locator('#controls [data-dir]').evaluateAll((buttons) =>
      buttons.map((button) => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { x, y, width, height };
      }));
    assert(JSON.stringify(practiceBounds) === JSON.stringify(normalBounds), `${label}: controls moved between practice and normal`);
    assert(await page.evaluate(() => globalThis.__testGame.mode === 'normal' && globalThis.__testGame.warmupRemaining === 0),
      `${label}: no second warmup`);
    // Let the actual next three attacks expire: no forced score/HP/result state.
    for (let i = 0; i < 3; i++) {
      const delay = await page.evaluate(() => Math.max(0, globalThis.__testGame.nextSpawnAt
        - globalThis.__testClock.now(performance.now())) + 32);
      await page.clock.runFor(delay);
      await advancePastFixtureTimeout(page);
    }
    assert(await page.locator('#screen-result').isVisible(), `${label}: normal death did not reach results`);
    for (const [id, value] of [['result-score', '0'], ['result-combo', '0'], ['result-perfect', '0%']]) {
      assert(await page.locator(`#${id}`).textContent() === value, `${label}: ${id} inherited practice data`);
    }
    assert((await page.locator('#result-player').textContent()).includes('練習から本番'), `${label}: result name changed`);
    await page.locator('#btn-retry').click();
    assert(await page.evaluate(() => globalThis.__testSession.state === 'COUNTDOWN'), `${label}: retry repeated tutorial`);
    await waitForPlaying(page, { hook: true, clocked: true, label });
    await page.locator('#btn-pause').click();
    await page.locator('#btn-pause-home').click();
    assert(await page.locator('#player-name').inputValue() === '練習から本番', `${label}: name not retained`);
    if (!blocked) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForReady(page, label);
    }
    await page.locator('#btn-play').click();
    assert(await page.evaluate(() => globalThis.__testSession.state === 'COUNTDOWN'), `${label}: completed state not retained`);
    assertHealthy(observation, label);
  } finally {
    await closeObservedPage(page);
    await context.close();
  }
}

async function runPracticeBlankNameRegression(browser, browserName, origin) {
  const context = await newContext(browser, { clocked: true });
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
      await pauseClockAtHome(page, label);
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
      await waitForPlaying(page, { hook: true, label, clocked: true });

      // Five misses must leave the first direction pending. Then complete the
      // actual generated directions through the real keyboard/clock wiring.
      for (let i = 0; i < 5; i++) {
        await playPracticeStep(page, 0, false, label);
      }
      for (let i = 0; i < 5; i++) await playPracticeStep(page, i, true, label);
      await firstVisible(page, ['#screen-practice-complete'],
        `${label}の練習完了後画面`);
      const readyVisible = await page.locator('#screen-ready').isVisible().catch(() => false);
      assert(!readyVisible, `${label}: 任意練習完了後に本番カウントダウンが始まりました`);
      const state = await page.evaluate(() => String(globalThis.__testGame?.state || '').toUpperCase());
      assert(state !== 'PLAYING' && state !== 'RUNNING', `${label}: 任意練習完了後にゲームが続行しています`);

      const back = await firstVisible(page, ['#btn-practice-done-home'], `${label}の戻る`);
      await back.click();
      const blankInput = await firstVisible(page, ['#player-name', 'input[name="name"]'], `${label}の空名欄`);
      await blankInput.fill('仮');
      await blankInput.dispatchEvent('compositionstart');
      await page.keyboard.press('Enter');
      await page.clock.runFor(100);
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

async function runMenuLayoutRegression(browser, browserName, origin, variant) {
  const context = await newContext(browser, { clocked: true });
  const page = await context.newPage();
  const observation = observe(page, origin);
  const label = `${browserName}-${variant}-menu-layout`;
  try {
    await page.goto(`${origin}${variant === 'split' ? '/' : '/dist.html'}`, { waitUntil: 'domcontentloaded' });
    await waitForReady(page, label);
    await pauseClockAtHome(page, label);
    const sizes = [[320, 568, 100], [375, 500, 100], [375, 667, 100], [402, 874, 100],
      [1280, 720, 100], [1920, 1080, 100], [375, 500, 150], [375, 500, 200]];
    for (const [width, height, scale] of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate((value) => { document.documentElement.style.fontSize = `${value}%`; }, scale);
      // Layout-only fixtures reveal each existing menu without fabricating a
      // gameplay outcome. The separate first-use flow verifies real transitions.
      for (const screen of ['title', 'howto', 'settings', 'pause', 'practice-complete', 'result']) {
        const metrics = await page.evaluate((name) => {
          for (const el of document.querySelectorAll('.screen')) el.classList.toggle('hidden', el.id !== `screen-${name}`);
          const active = document.getElementById(`screen-${name}`);
          active.scrollTop = 0;
          document.querySelector('#result-player').textContent = 'あ'.repeat(20) + 'さんの結果';
          document.querySelector('#result-score').textContent = '999,999,999';
          const controls = [...active.querySelectorAll('button, input, textarea, a')]
            .filter((el) => el.getClientRects().length);
          const small = controls.filter((el) => {
            const rect = (el.closest('.toggle') || el).getBoundingClientRect();
            return rect.width < 44 || rect.height < 44;
          }).map((el) => el.id || el.tagName);
          const rect = active.getBoundingClientRect();
          const panel = active.querySelector('.panel,.title-wrap').getBoundingClientRect();
          return { overflow: active.scrollWidth > active.clientWidth + 1,
            pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
            topReachable: panel.top >= rect.top - 1, small,
            actions: controls.map((el) => el.id).filter(Boolean) };
        }, screen);
        assert(!metrics.overflow && !metrics.pageOverflow && metrics.topReachable && !metrics.small.length,
          `${label} ${width}x${height} ${scale}% ${screen}: ${JSON.stringify(metrics)}`);
        for (const id of metrics.actions) {
          const action = page.locator(`#${id}`);
          await action.scrollIntoViewIfNeeded();
          const reachable = await action.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            const screen = el.closest('.screen').getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const top = document.elementFromPoint(x, y);
            return x >= screen.left && x <= screen.right && y >= screen.top && y <= screen.bottom
              && !!top && (top === el || el.contains(top));
          });
          assert(reachable, `${label} ${width}x${height} ${scale}% ${screen} #${id}: unreachable`);
        }
      }
    }
    await saveScreenshot(page, label, '200-percent-result');
    // Simulate the reduced visual viewport reported while a software keyboard
    // is open. This verifies our resize adapter, not a physical iOS keyboard.
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
      globalThis.__testSession.home(performance.now());
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 280 });
      window.dispatchEvent(new Event('resize'));
    });
    await page.locator('#player-name').fill('キーボード表示中');
    await page.locator('#btn-play').scrollIntoViewIfNeeded();
    assert(await page.locator('#btn-play').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= 281;
    }), `${label}: keyboard viewport must keep start reachable`);
    // Gameplay geometry uses the actual renderer baseline and button boxes.
    await page.evaluate(() => {
      delete window.visualViewport.height;
      document.documentElement.style.fontSize = '100%';
      window.dispatchEvent(new Event('resize'));
      globalThis.__testSession.navigate('HOWTO', performance.now());
    });
    await page.locator('#btn-howto-try').click();
    for (const [width, height] of sizes.slice(0, 6)) {
      await page.setViewportSize({ width, height });
      await page.clock.runFor(32);
      const geometry = await page.evaluate(() => {
        const guide = document.querySelector('#practice-guide').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('#controls [data-dir]')].map((el) => el.getBoundingClientRect());
        const app = document.querySelector('#app').getBoundingClientRect();
        return { guideTop: guide.top, guideBottom: guide.bottom,
          playerBottom: app.top + app.height * .54 + 27,
          buttonTop: Math.min(...buttons.map((r) => r.top)),
          targets: buttons.every((r) => r.width >= 44 && r.height >= 44 && r.bottom <= app.bottom + 1) };
      });
      assert(geometry.guideTop >= geometry.playerBottom && geometry.guideBottom <= geometry.buttonTop && geometry.targets,
        `${label} ${width}x${height}: practice guide/player/buttons overlap ${JSON.stringify(geometry)}`);
    }
    await page.setViewportSize({ width: 375, height: 500 });
    await page.clock.runFor(32);
    await saveScreenshot(page, label, 'short-practice');
    assertHealthy(observation, label);
  } finally {
    await closeObservedPage(page);
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
          for (const blocked of [false, true]) {
            await runCase(`${browserName}: ${variant}の初回5方向→本番→結果→再挑戦・${blocked ? '保存不可' : '保存再読込'}`,
              () => runFirstUseFlow(browser, browserName, hookOrigin, variant, blocked));
          }
          await runCase(`${browserName}: ${variant}の6画面サイズ・文字150/200%・操作到達`,
            () => runMenuLayoutRegression(browser, browserName, hookOrigin, variant));
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
