import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_URL = process.env.UNREVIEWED_BASE_URL || 'https://rate-your-mates.base44.app';
// This is deliberately opt-in. It lets this focused, frontend-only regression
// exercise the real React route transition when a local Vite server has no
// Base44 development backend. It is not used for production or room testing.
const MOCK_BASE44 = process.env.UNREVIEWED_MOCK_BASE44 === '1';
const TIMEOUT_MS = 60_000;
// Layout.jsx defines the exit transition as 0.35 seconds. The test waits for
// the observed Profile DOM to stop changing for that transition plus a small
// frame margin; it is not a generic workflow sleep.
const PROFILE_SETTLE_MS = 425;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = path.join(ROOT, 'test-results', 'profile-setup-transition');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const route = (page) => new URL(page.url()).pathname.replace(/\/$/, '') || '/';

async function waitUntil(check, description, timeout = TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last observation: ${lastError.message}` : ''}`);
}

async function visible(locator) {
  return (await locator.count()) > 0 && await locator.first().isVisible();
}

async function clickEnabled(locator, description) {
  await waitUntil(async () => await visible(locator) && await locator.first().isEnabled(), `${description} to be enabled`);
  await locator.first().click();
}

async function waitForRouteAnimation(page, expectedPath) {
  await waitUntil(
    () => page.evaluate((path) => {
      const main = document.querySelector('main');
      const style = main && getComputedStyle(main);
      return window.location.pathname === path
        && style?.opacity === '1'
        && style?.transform === 'none';
    }, expectedPath),
    `${expectedPath} enter animation to complete`,
  );
}

async function profileProbe(page) {
  return page.evaluate(() => {
    const probe = window.__profileTransitionProbe;
    const input = document.querySelector('input[placeholder="Enter a nickname"]');
    const button = [...document.querySelectorAll('button')]
      .find((element) => element.textContent.trim() === 'Join Room');
    return {
      inputInstances: probe?.inputInstances,
      buttonInstances: probe?.buttonInstances,
      lastProfileNodeAt: probe?.lastProfileNodeAt,
      inputValue: input?.value ?? null,
      buttonDisabled: button?.disabled ?? null,
      path: window.location.pathname,
    };
  });
}

async function mockLocalBase44(page) {
  let room = null;

  await page.route('**/api/**', async (intercept) => {
    const request = intercept.request();
    const url = new URL(request.url());

    if (url.pathname.includes('/public-settings/')) {
      await intercept.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'local-route-test', public_settings: {} }) });
      return;
    }

    if (url.pathname.endsWith('/analytics/track/batch')) {
      await intercept.fulfill({ contentType: 'application/json', body: '{}' });
      return;
    }

    if (url.pathname.endsWith('/functions/room')) {
      const requestData = JSON.parse(request.postData() || '{}');
      const sessionId = requestData.sessionId || 'local-session';
      if (requestData.action === 'create') {
        room = {
          code: 'L0CL',
          host_session: sessionId,
          mode: requestData.mode,
          length: requestData.length,
          status: 'lobby',
        };
      } else if (requestData.action === 'config' && room) {
        room = { ...room, mode: requestData.mode, length: requestData.length };
      }
      await intercept.fulfill({ contentType: 'application/json', body: JSON.stringify({ room }) });
      return;
    }

    await intercept.continue();
  });
}

await mkdir(RESULTS, { recursive: true });
let browser;
let context;
let page;
let failure;

try {
  browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  if (MOCK_BASE44) await mockLocalBase44(page);

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await clickEnabled(page.getByRole('button', { name: /^Play$/ }), 'landing Play button');
  await waitUntil(() => route(page) === '/create', 'Create/Join route');
  await clickEnabled(page.getByRole('button', { name: /^Create a Room/ }), 'Create a Room card');
  await waitUntil(() => route(page) === '/config', 'Host Configuration route');
  // Do not overlap the Create/Join -> Host Config entrance with the
  // Config -> Profile transition being tested.
  await waitForRouteAnimation(page, '/config');

  // Begin observing before navigation. The selector and Join Room text are
  // taken directly from ProfileSetup.jsx.
  await page.evaluate(() => {
    const probe = { inputInstances: 0, buttonInstances: 0, lastInput: null, lastButton: null, lastProfileNodeAt: performance.now() };
    const scan = () => {
      const input = document.querySelector('input[placeholder="Enter a nickname"]');
      const button = [...document.querySelectorAll('button')]
        .find((element) => element.textContent.trim() === 'Join Room');
      if (input && input !== probe.lastInput) {
        probe.lastInput = input;
        probe.inputInstances += 1;
        probe.lastProfileNodeAt = performance.now();
      }
      if (button && button !== probe.lastButton) {
        probe.lastButton = button;
        probe.buttonInstances += 1;
        probe.lastProfileNodeAt = performance.now();
      }
    };
    probe.observer = new MutationObserver(scan);
    probe.observer.observe(document.body, { childList: true, subtree: true });
    probe.scan = scan;
    scan();
    window.__profileTransitionProbe = probe;
  });

  await clickEnabled(page.getByRole('button', { name: /^Let's go$/i }), "Host Configuration Let's go button");
  const nickname = page.getByPlaceholder('Enter a nickname');
  const joinRoom = page.getByRole('button', { name: /^JOIN ROOM$/i });
  const pendingRoom = page.getByText(/^Joining room [A-Z0-9]{4}$/).first();
  await waitUntil(async () => route(page) === '/profile' && await visible(nickname) && await visible(pendingRoom), 'Profile Setup and its pending room code');

  await nickname.fill('Alpha');
  assert.equal(await nickname.inputValue(), 'Alpha', 'Profile Setup did not retain the typed nickname');
  assert.equal(await joinRoom.isEnabled(), true, 'JOIN ROOM should enable after entering Alpha');

  // Wait until profile nodes have stayed unchanged through Layout.jsx’s exit
  // duration, then assert the original instance still owns the input value.
  await page.waitForFunction(
    (settleMs) => {
      const probe = window.__profileTransitionProbe;
      probe?.scan?.();
      const input = document.querySelector('input[placeholder="Enter a nickname"]');
      return Boolean(input) && performance.now() - probe.lastProfileNodeAt >= settleMs;
    },
    PROFILE_SETTLE_MS,
    { timeout: TIMEOUT_MS },
  );

  const finalState = await profileProbe(page);
  assert.equal(finalState.path, '/profile', 'Profile Setup unexpectedly navigated away');
  assert.equal(finalState.inputInstances, 1, `Profile Setup input remounted ${finalState.inputInstances} times`);
  assert.equal(finalState.buttonInstances, 1, `Profile Setup button remounted ${finalState.buttonInstances} times`);
  assert.equal(finalState.inputValue, 'Alpha', 'nickname was lost after the route transition settled');
  assert.equal(finalState.buttonDisabled, false, 'JOIN ROOM became disabled after the route transition settled');

  await page.screenshot({ path: path.join(RESULTS, `${RUN_ID}-passed.png`), fullPage: true });
  console.log(`Profile Setup transition regression passed${MOCK_BASE44 ? ' (using the explicit local Base44 mock).' : '.'}`);
} catch (error) {
  failure = error;
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(RESULTS, `${RUN_ID}-failed.png`), fullPage: true }).catch(() => {});
    console.error(`Profile Setup transition regression failed: ${error.stack || error.message}`);
  }
} finally {
  await context?.close();
  await browser?.close();
}

if (failure) process.exitCode = 1;
