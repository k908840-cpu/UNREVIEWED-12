import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_URL = process.env.UNREVIEWED_BASE_URL || "http://127.0.0.1:4173";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESULTS = path.join(ROOT, "test-results", "mobile-layout");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 393, height: 852 },
  { width: 412, height: 915 },
  { width: 320, height: 568 },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture() {
  const players = [
    { session_id: "alpha", nickname: "Alpha", avatar_id: "smile", connected: true, last_seen: new Date().toISOString() },
    { session_id: "bravo", nickname: "Bravo", avatar_id: "cool", connected: true, last_seen: new Date().toISOString() },
    { session_id: "charlie", nickname: "Charlie", avatar_id: "wink", connected: true, last_seen: new Date().toISOString() },
    { session_id: "delta", nickname: "Delta", avatar_id: "star", connected: true, last_seen: new Date().toISOString() },
  ];
  return {
    room: {
      code: "MOB1",
      host_session: "alpha",
      mode: "family",
      length: "quick",
      status: "playing",
      game_state: {
        phase: "results",
        round_index: 0,
        phase_deadline: new Date(Date.now() + 120_000).toISOString(),
        phase_duration: 20,
        current_subject: "delta",
        current_prompt: { text: "What does [NAME] do best?" },
        answers: [{ id: "answer-1", author: "bravo", text: "Makes every group chat louder." }],
        scores: { alpha: 2, bravo: 4, charlie: 1, delta: 1 },
        subject_order: ["delta", "alpha", "bravo", "charlie"],
        results: {
          subjectId: "delta",
          predictedTop: true,
          ranked: [{ id: "answer-1", author: "bravo", text: "Makes every group chat louder.", avg: 4.8, place: 1 }],
        },
      },
    },
    players,
  };
}

async function installMock(page) {
  const state = fixture();
  await page.addInitScript(() => {
    localStorage.setItem("unreviewed:session:v1", "alpha");
    localStorage.setItem("unreviewed:room:v1", "MOB1");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes("/public-settings/")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "mobile-layout-test", public_settings: {} }) });
      return;
    }
    if (url.pathname.endsWith("/analytics/track/batch")) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }
    if (url.pathname.endsWith("/functions/room")) {
      const requestData = JSON.parse(request.postData() || "{}");
      if (requestData.action === "heartbeat") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ host_session: "alpha", roster_session_ids: state.players.map((player) => player.session_id), active_session_ids: state.players.map((player) => player.session_id) }) });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(state) });
      return;
    }
    await route.abort();
  });
}

async function waitFor(page, predicate, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

await mkdir(RESULTS, { recursive: true });
const browser = await chromium.launch({ headless: true });
let failure;

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await installMock(page);
    await page.goto(`${APP_URL}/results`, { waitUntil: "domcontentloaded" });

    // A restored path must never silently resume a game. The test exercises
    // the real recovery path first, then verifies the rendered Results UI.
    await waitFor(
      page,
      () => page.getByRole("button", { name: /^Resume Game$/i }).isVisible(),
      `saved-game choice at ${viewport.width}x${viewport.height}`,
    );
    await page.getByRole("button", { name: /^Resume Game$/i }).click();

    const resultCard = page.getByText(/Delta called it!/i);
    await waitFor(page, () => resultCard.isVisible(), `Round Results card at ${viewport.width}x${viewport.height}`);
    await page.screenshot({ path: path.join(RESULTS, `${RUN_ID}-results-${viewport.width}x${viewport.height}.png`), fullPage: true });

    const primary = page.getByRole("button", { name: /Leaderboard/i });
    await waitFor(page, () => primary.isVisible(), `Leaderboard action at ${viewport.width}x${viewport.height}`);
    await primary.scrollIntoViewIfNeeded();
    const box = await primary.boundingBox();
    assert.ok(box && box.width > 0 && box.height > 0, `Leaderboard action must have a tappable area at ${viewport.width}x${viewport.height}`);
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, `Leaderboard action must be reachable at ${viewport.width}x${viewport.height}`);
    const shellOverflow = await page.locator(".app-shell").evaluate((element) => getComputedStyle(element).overflowY);
    assert.notEqual(shellOverflow, "hidden", `app shell must allow vertical content at ${viewport.width}x${viewport.height}`);
    await context.close();
  }
  console.log(`Mobile Round Results layout passed for ${VIEWPORTS.map(({ width, height }) => `${width}x${height}`).join(", ")}.`);
} catch (error) {
  failure = error;
  console.error(error.stack || error.message);
} finally {
  await browser.close();
}

if (failure) process.exitCode = 1;
