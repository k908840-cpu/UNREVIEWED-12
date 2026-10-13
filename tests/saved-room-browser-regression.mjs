// Browser-level coverage of the explicit saved-room choice. It uses a local
// Base44 room-function fixture, so it never creates or changes production data.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const APP_URL = process.env.UNREVIEWED_BASE_URL || "http://127.0.0.1:4173";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, description, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function fixture() {
  const now = new Date().toISOString();
  return {
    room: { code: "SAVE", host_session: "alpha", mode: "family", length: "quick", status: "lobby", game_state: {} },
    players: [{ session_id: "alpha", nickname: "Alpha", avatar_id: "smile", connected: true, last_seen: now }],
  };
}

async function installMock(page, { leaveFails = false } = {}) {
  const state = fixture();
  let leaveCalls = 0;
  await page.addInitScript(() => {
    localStorage.setItem("unreviewed:session:v1", "alpha");
    localStorage.setItem("unreviewed:room:v1", "SAVE");
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes("/public-settings/")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "saved-room-test", public_settings: {} }) });
      return;
    }
    if (url.pathname.endsWith("/analytics/track/batch")) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
      return;
    }
    if (url.pathname.endsWith("/functions/room")) {
      const action = JSON.parse(request.postData() || "{}").action;
      if (action === "leave") {
        leaveCalls += 1;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(leaveFails ? { error: "rate_limited" } : { ok: true }) });
        return;
      }
      if (action === "heartbeat") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ host_session: "alpha", roster_session_ids: ["alpha"], active_session_ids: ["alpha"] }) });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(state) });
      return;
    }
    await route.abort();
  });
  return () => leaveCalls;
}

const browser = await chromium.launch({ headless: true });
let failure;
try {
  // A saved room is never entered by itself. It stays at the menu until the
  // explicit Resume Game choice is pressed.
  {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    const leaveCalls = await installMock(page);
    await page.goto(`${APP_URL}/write`, { waitUntil: "domcontentloaded" });
    await waitFor(() => page.getByText("Saved game found", { exact: true }).isVisible(), "saved-game offer on the main menu");
    assert.equal(new URL(page.url()).pathname, "/", "a restored gameplay route must return to the menu before resume");
    await page.getByRole("button", { name: /^Resume Game$/i }).click();
    await waitFor(() => page.getByText("Players (1/8)", { exact: true }).isVisible(), "lobby after explicit resume");
    await page.getByRole("button", { name: /^Leave game$/i }).click();
    await page.getByRole("button", { name: /^Leave Game$/i }).click();
    await waitFor(() => page.getByRole("button", { name: /^Play$/i }).isVisible(), "menu after Quit Game");
    assert.equal(leaveCalls(), 1, "Quit Game sends exactly one server leave request");
    assert.equal(await page.evaluate(() => localStorage.getItem("unreviewed:room:v1")), null, "local saved room clears only after confirmed leave");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitFor(() => page.getByRole("button", { name: /^Play$/i }).isVisible(), "fresh menu after leave and reload");
    assert.equal(await page.getByText("Saved game found", { exact: true }).count(), 0, "left room must not be offered after restart");
    await context.close();
  }

  // A transient server failure is visible and preserves the session so the
  // player can retry; it must not falsely claim a successful exit.
  {
    const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const page = await context.newPage();
    const leaveCalls = await installMock(page, { leaveFails: true });
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await waitFor(() => page.getByText("Saved game found", { exact: true }).isVisible(), "saved-game offer for leave failure");
    await page.getByRole("button", { name: /^Leave Room$/i }).click();
    await waitFor(() => page.getByRole("alert").isVisible(), "retryable leave error");
    assert.equal(leaveCalls(), 1, "failed Leave Room still sends exactly one request");
    assert.equal(await page.evaluate(() => localStorage.getItem("unreviewed:room:v1")), "SAVE", "failed leave keeps saved room for retry");
    await context.close();
  }
  console.log("Saved-room browser regression passed.");
} catch (error) {
  failure = error;
  console.error(error.stack || error.message);
} finally {
  await browser.close();
}

if (failure) process.exitCode = 1;
