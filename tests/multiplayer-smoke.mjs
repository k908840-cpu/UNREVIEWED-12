/** Production four-player smoke test for UNREVIEWED. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This test drives four real browsers against a live Base44 deployment and
// creates real rooms. It never runs implicitly.
if (process.env.UNREVIEWED_QA_LIVE_MULTIPLAYER !== '1') {
  console.error('Refusing to run: this test contacts the live Base44 backend. Set UNREVIEWED_QA_LIVE_MULTIPLAYER=1 to opt in.');
  process.exit(2);
}

const APP_URL = process.env.UNREVIEWED_BASE_URL || 'https://rate-your-mates.base44.app';
const CLEANUP_ROOM = process.env.UNREVIEWED_CLEANUP !== '0';
const PLAYERS = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
const TIMEOUT = 60_000;
const POLL = 250;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESULTS = path.join(ROOT, 'test-results', 'multiplayer');

const consoleErrors = [];
const failedRoomRequests = [];
const roomRequests = [];
const screenshots = [];
let currentStep = 'initializing';
let roomEventSequence = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const route = (page) => new URL(page.url()).pathname.replace(/\/$/, '') || '/';
const clean = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const isRoomRequest = (url) => /(?:\/functions\/room|\/api\/.*\/functions\/room)(?:[/?#]|$)/i.test(url);
const ROOM_ACTIONS = new Set(['create', 'lookup', 'getRoster', 'join', 'heartbeat', 'leave', 'kick', 'config', 'start', 'submit_answer', 'submit_rating', 'submit_prediction', 'advance', 'reset_to_lobby', 'close']);
const ROOM_MUTATION_ACTIONS = new Set(['create', 'join', 'leave', 'kick', 'config', 'start', 'submit_answer', 'submit_rating', 'submit_prediction', 'advance', 'reset_to_lobby', 'close']);
const MUTATION_MIN_INTERVAL_MS = Math.max(500, Number.parseInt(process.env.UNREVIEWED_MUTATION_MIN_INTERVAL_MS || '1250', 10) || 1250);
const requestStartedAt = new WeakMap();
let lastMutationResponseAt = 0;

function roomAction(request) {
  try {
    const action = JSON.parse(request.postData() || '{}').action;
    return ROOM_ACTIONS.has(action) ? action : 'unknown';
  } catch {
    return 'unknown';
  }
}

function roomClientReason(request) {
  try {
    const reason = JSON.parse(request.postData() || '{}').client_reason;
    return typeof reason === 'string' && /^[a-z-]{1,40}$/.test(reason) ? reason : null;
  } catch {
    return null;
  }
}

function roomResponseSummary(body) {
  try {
    const data = JSON.parse(body || '{}');
    return {
      error: typeof data?.error === 'string' ? data.error : null,
      phase: typeof data?.room?.game_state?.phase === 'string' ? data.room.game_state.phase : null,
    };
  } catch {
    return { error: null, phase: null };
  }
}

async function waitUntil(check, description, timeout = TIMEOUT) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try { if (await check()) return; } catch (error) { lastError = error; }
    await wait(POLL); // condition polling, not a fixed workflow delay
  }
  throw new Error(`Timed out after ${timeout / 1000}s waiting for ${description}.${lastError ? ` Last observation: ${lastError.message}` : ''}`);
}

async function step(name, task) {
  currentStep = name;
  process.stdout.write(`\n[${name}]\n`);
  try { return await task(); }
  catch (error) { throw new Error(`Step failed: ${name}\n${error.message}`, { cause: error }); }
}

async function visible(locator) {
  return (await locator.count()) > 0 && await locator.first().isVisible();
}

async function clickEnabled(locator, description) {
  await waitUntil(async () => await visible(locator) && await locator.first().isEnabled(), `${description} to be enabled`);
  await locator.first().click();
}

// The smoke test drives a real shared Base44 room. Keep test-issued mutations
// deliberately serial and give the provider a small recovery window between
// completed writes; this does not alter app behavior or retry a failed write.
async function waitForRoomMutationSlot(action) {
  const earliest = lastMutationResponseAt + MUTATION_MIN_INTERVAL_MS;
  await waitUntil(() => Date.now() >= earliest, `${action} Base44 mutation slot`, Math.max(TIMEOUT, MUTATION_MIN_INTERVAL_MS + 5_000));
}

async function waitForRoute(pages, expected, description) {
  await waitUntil(() => pages.every((page) => route(page) === expected), description);
}

async function waitForLeaderboardReady(pages) {
  await waitUntil(async () => {
    for (const page of pages) {
      if (route(page) !== '/leaderboard') return false;
      if (!await visible(page.getByRole('heading', { name: /^LEADERBOARD$/i }))) return false;
      if (!await visible(page.getByText('Standings', { exact: true }))) return false;
    }
    return true;
  }, 'the rendered Leaderboard on all four clients');
}

async function waitForRoundTwoReveal(pages) {
  let subjectNames = [];
  await waitUntil(async () => {
    subjectNames = [];
    for (const page of pages) {
      if (route(page) !== '/reveal') return false;
      if (!await visible(page.getByText("Tonight's Victim", { exact: true }))) return false;
      if (!await visible(page.getByText('Please review responsibly.', { exact: true }))) return false;
      const subject = page.locator('h1.gold-text'); // SubjectReveal.jsx
      if (!await visible(subject)) return false;
      const name = (await subject.textContent())?.trim();
      if (!name) return false;
      subjectNames.push(name);
    }
    return new Set(subjectNames).size === 1;
  }, 'the rendered Round 2 reveal and one shared subject on all four clients');
  return subjectNames[0];
}

function observe(page, player) {
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push({ player, type: 'console.error', text: message.text(), location: message.location(), at: new Date().toISOString() });
  });
  page.on('pageerror', (error) => consoleErrors.push({ player, type: 'pageerror', text: error.message, stack: error.stack, at: new Date().toISOString() }));
  page.on('requestfailed', (request) => {
    if (isRoomRequest(request.url())) failedRoomRequests.push({ player, type: 'requestfailed', action: roomAction(request), url: request.url(), method: request.method(), failure: request.failure(), at: new Date().toISOString() });
  });
  page.on('request', (request) => {
    if (!isRoomRequest(request.url())) return;
    const startedAtMs = Date.now();
    requestStartedAt.set(request, startedAtMs);
    const event = {
      sequence: ++roomEventSequence,
      player,
      type: 'request',
      action: roomAction(request),
      clientReason: roomClientReason(request),
      method: request.method(),
      at: new Date(startedAtMs).toISOString(),
    };
    roomRequests.push(event);
  });
  page.on('response', async (response) => {
    if (!isRoomRequest(response.url())) return;
    let body = '';
    try { body = (await response.text()).slice(0, 2_000); } catch { body = '<response body unavailable>'; }
    const summary = roomResponseSummary(body);
    const action = roomAction(response.request());
    const respondedAtMs = Date.now();
    const event = {
      sequence: ++roomEventSequence,
      player,
      type: 'response',
      action,
      clientReason: roomClientReason(response.request()),
      method: response.request().method(),
      status: response.status(),
      phase: summary.phase,
      outcome: response.ok() && !summary.error ? 'success' : 'failure',
      error: summary.error,
      durationMs: Math.max(0, respondedAtMs - (requestStartedAt.get(response.request()) || respondedAtMs)),
      at: new Date(respondedAtMs).toISOString(),
    };
    roomRequests.push(event);
    if (ROOM_MUTATION_ACTIONS.has(action)) lastMutationResponseAt = Math.max(lastMutationResponseAt, respondedAtMs);
    if (!response.ok()) {
      failedRoomRequests.push({ ...event, type: 'http-error', url: response.url(), statusText: response.statusText(), body });
    }
  });
}

async function screenshot(pages, label) {
  await Promise.all(pages.map(async (page, index) => {
    if (page.isClosed()) return;
    const output = path.join(RESULTS, `${RUN_ID}-${clean(label)}-${PLAYERS[index].toLowerCase()}.png`);
    await page.screenshot({ path: output, fullPage: true });
    screenshots.push(output);
  }));
}

async function profileStateFailure(page, nickname, pendingCode, reason) {
  const input = page.getByPlaceholder('Enter a nickname');
  const submit = page.getByRole('button', { name: /^JOIN ROOM$/i });
  let inputValue = '<input unavailable>';
  let enabled = false;
  try { inputValue = await input.inputValue(); } catch {}
  try { enabled = await submit.isEnabled(); } catch {}

  const output = path.join(RESULTS, `${RUN_ID}-profile-state-${clean(nickname)}.png`);
  try {
    await page.screenshot({ path: output, fullPage: true });
    screenshots.push(output);
  } catch {}

  throw new Error(
    `Profile Setup became unstable for ${nickname}: ${reason}. `
    + `route=${route(page)}, pendingRoom=${pendingCode}, input=${JSON.stringify(inputValue)}, `
    + `joinRoomEnabled=${enabled}, screenshot=${output}`,
  );
}

async function submitProfile(page, nickname) {
  // ProfileSetup.jsx has local nickname state, seeded from you.nickname. Wait
  // for the final mounted Profile Setup screen and its pending room code—not
  // merely the first /profile URL observation—before filling that local state.
  const input = page.getByPlaceholder('Enter a nickname');
  // The button is visibly styled uppercase (JOIN ROOM); its semantic name is
  // the source text "Join Room", so this case-insensitive exact locator is
  // anchored to the actual button and cannot select the Create/Join form.
  const submit = page.getByRole('button', { name: /^JOIN ROOM$/i });
  const pendingRoom = page.getByText(/^Joining room [A-Z0-9]{4}$/).first();
  await waitUntil(
    async () => route(page) === '/profile' && await visible(input) && await visible(pendingRoom),
    `${nickname}'s final Profile Setup route and pending room code`,
  );
  const pendingText = (await pendingRoom.textContent())?.trim() || '';
  const codeMatch = /^Joining room ([A-Z0-9]{4})$/.exec(pendingText);
  assert(codeMatch, `Profile Setup did not expose a valid pending room code: ${JSON.stringify(pendingText)}`);
  const pendingCode = codeMatch[1];

  await input.fill(nickname);
  if ((await input.inputValue()) !== nickname) {
    await profileStateFailure(page, nickname, pendingCode, 'nickname changed immediately after fill');
  }
  // ProfileSetup supplies PRESET_AVATARS[0] by default, so an avatar is already selected.
  if (!await submit.isEnabled()) {
    await profileStateFailure(page, nickname, pendingCode, 'JOIN ROOM remained disabled after filling nickname');
  }
  // Assert the same currently mounted controlled input immediately before the
  // click. If React replaced it, fail with its actual value rather than
  // repeatedly polling a disabled button for a minute.
  if ((await input.inputValue()) !== nickname || !await submit.isEnabled()) {
    await profileStateFailure(page, nickname, pendingCode, 'nickname or button state changed before submit');
  }
  await waitForRoomMutationSlot('join');
  try {
    await submit.click({ timeout: 5_000 });
  } catch (error) {
    await profileStateFailure(page, nickname, pendingCode, `JOIN ROOM click failed: ${error.message}`);
  }
  await waitForRoute([page], '/lobby', `${nickname} to arrive in the Lobby`);
}

async function createRoomAsAlpha(page) {
  await clickEnabled(page.getByRole('button', { name: /^Play$/ }), 'landing Play button');
  await waitForRoute([page], '/create', 'Create/Join screen');
  // CreateJoin.jsx host card: heading "Create a Room".
  await waitForRoomMutationSlot('create');
  await clickEnabled(page.getByRole('button', { name: /^Create a Room/ }), 'Create a Room card');
  await waitForRoute([page], '/config', 'Host Configuration screen');
  // HostConfig.jsx uses the exact literal "Let's go" (not "Let's go!").
  await waitForRoomMutationSlot('config');
  await clickEnabled(page.getByRole('button', { name: /^Let's go$/i }), "Host Configuration Let's go button");
  await submitProfile(page, 'Alpha');
}

async function roomCodeFromLobby(page) {
  // Lobby.jsx renders roomCode as the sole four-character code in the Room code button.
  const code = page.getByText(/^[A-Z0-9]{4}$/).first();
  await waitUntil(() => visible(code), 'the Lobby room code');
  const value = (await code.textContent())?.trim() || '';
  assert.match(value, /^[A-Z0-9]{4}$/, `expected a four-character room code, got ${JSON.stringify(value)}`);
  return value;
}

async function joinRoom(page, nickname, roomCode) {
  await clickEnabled(page.getByRole('button', { name: /^Play$/ }), `${nickname}'s landing Play button`);
  await waitForRoute([page], '/create', `${nickname}'s Create/Join screen`);
  // CreateJoin.jsx: room-code input is placeholder="ABCD".
  const codeInput = page.getByPlaceholder('ABCD');
  await codeInput.fill(roomCode);
  await waitUntil(async () => (await codeInput.inputValue()) === roomCode, `${nickname}'s room-code value`);
  await waitForRoomMutationSlot('lookup');
  await clickEnabled(page.getByRole('button', { name: /^Join Room$/ }), `${nickname}'s Create/Join Join Room button`);
  await submitProfile(page, nickname);
}

async function verifyLobby(pages) {
  await waitUntil(async () => {
    for (const page of pages) {
      if (!await visible(page.getByText('Players (4/8)', { exact: true }))) return false;
      for (const name of PLAYERS) if (!await visible(page.getByText(name, { exact: true }))) return false;
    }
    return true;
  }, 'every player to see the full roster');

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    assert.equal(await page.getByText('Away', { exact: true }).count(), 0, `${PLAYERS[index]} sees an unexpected Away player`);
    assert.equal(await page.getByText('You', { exact: true }).count(), 1, `${PLAYERS[index]} should see one You badge`);
    if (index === 0) {
      assert.equal(await page.getByText("You're the Host", { exact: true }).count(), 1, 'Alpha is not marked as host');
      assert.equal(await page.getByText('Ready', { exact: true }).count(), 3, 'Alpha should see three Ready guests');
    } else {
      assert.equal(await page.getByText('Host', { exact: true }).count(), 1, `${PLAYERS[index]} should see Alpha as Host`);
      assert.equal(await page.getByText('Ready', { exact: true }).count(), 2, `${PLAYERS[index]} should see two other Ready guests`);
    }
  }
}

async function waitForWritingRoles(pages) {
  let lastState = [];
  try {
    await waitUntil(async () => {
      lastState = await Promise.all(pages.map(async (page, index) => ({
        index,
        player: PLAYERS[index],
        route: route(page),
        writer: await visible(page.getByPlaceholder('Write something funny…')),
        subject: await visible(page.getByRole('heading', { name: /^You're the Subject$/i })),
      })));
      const writers = lastState.filter((state) => state.writer);
      const subjects = lastState.filter((state) => state.subject);
      return lastState.every((state) => state.route === '/write')
        && writers.length === 3
        && subjects.length === 1
        && !subjects[0].writer;
    }, 'the final Writing UI role split across all players');
  } catch (error) {
    await screenshot(pages, 'writing-ui-timeout');
    throw new Error(`Writing UI did not finish mounting: ${JSON.stringify(lastState)}`, { cause: error });
  }

  return lastState
    .filter((state) => state.writer)
    .map((state) => ({ index: state.index, editor: pages[state.index].getByPlaceholder('Write something funny…') }));
}

async function waitForAnswerAcceptance(page, index, eventSequenceBeforeClick) {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    const answerResponse = roomRequests.find((event) => (
      event.sequence > eventSequenceBeforeClick
      && event.player === PLAYERS[index]
      && event.type === 'response'
      && event.action === 'submit_answer'
    ));
    if (answerResponse?.outcome === 'failure') {
      throw new Error(`${PLAYERS[index]}'s submit_answer failed: status=${answerResponse.status}, error=${answerResponse.error || 'unavailable'}, phase=${answerResponse.phase || 'unavailable'}`);
    }
    // The last accepted writer can receive a room already advanced to Rating,
    // so the Writing receipt will never mount. A successful, action-labelled
    // server response is the authoritative confirmation in that case.
    if (answerResponse?.outcome === 'success'
      || await visible(page.getByText('Submitted. Now we wait for the others…', { exact: true }))) {
      return;
    }
    await wait(POLL);
  }
  throw new Error(`Timed out after ${TIMEOUT / 1000}s waiting for ${PLAYERS[index]}'s answer acceptance.`);
}

async function submitAnswers(pages) {
  const writers = await waitForWritingRoles(pages);
  for (const { index, editor } of writers) {
    await editor.fill(`Round one smoke review from ${PLAYERS[index]}.`);
    const eventSequenceBeforeClick = roomEventSequence;
    await waitForRoomMutationSlot('submit_answer');
    await clickEnabled(pages[index].getByRole('button', { name: /^Submit$/ }), `${PLAYERS[index]}'s Submit button`);
    await waitForAnswerAcceptance(pages[index], index, eventSequenceBeforeClick);
  }
}

async function waitForRatingAcceptance(page, index, eventSequenceBeforeClick) {
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    const ratingResponse = roomRequests.find((event) => (
      event.sequence > eventSequenceBeforeClick
      && event.player === PLAYERS[index]
      && event.type === 'response'
      && event.action === 'submit_rating'
    ));
    if (ratingResponse?.outcome === 'success') return;
    if (ratingResponse?.outcome === 'failure') {
      throw new Error(`${PLAYERS[index]}'s submit_rating failed: status=${ratingResponse.status}, error=${ratingResponse.error || 'unknown'}, phase=${ratingResponse.phase || 'unavailable'}`);
    }
    if (await visible(page.getByText('Locked in. Waiting on the others…', { exact: true }))) return;
    await wait(100);
  }
  throw new Error(`Timed out after ${TIMEOUT}ms waiting for ${PLAYERS[index]}'s rating acceptance.`);
}

async function rateRound(pages) {
  const answerLabel = pages[0].getByText(/^Answer \d+ of \d+$/).first();
  await waitUntil(() => visible(answerLabel), 'the first rating card');
  const match = /^Answer (\d+) of (\d+)$/.exec((await answerLabel.textContent())?.trim() || '');
  assert(match, 'could not parse the rating card label');
  const total = Number(match[2]);
  assert.equal(total, 3, 'a four-player round must create three answers');

  for (let answer = 1; answer <= total; answer += 1) {
    await waitUntil(async () => {
      for (const page of pages) {
        if (route(page) !== '/rate' || !await visible(page.getByText(new RegExp(`^Answer ${answer} of ${total}$`)))) return false;
      }
      return true;
    }, `rating card ${answer} of ${total}`);

    const raters = [];
    for (let index = 0; index < pages.length; index += 1) {
      const stars = pages[index].getByRole('group', { name: 'star rating' });
      if (await visible(stars)) raters.push({ index, stars });
    }
    assert.equal(raters.length, 2, `answer ${answer} should have two eligible raters`);
    for (const { index, stars } of raters) {
      const eventSequenceBeforeClick = roomEventSequence;
      await waitForRoomMutationSlot('submit_rating');
      await clickEnabled(stars.getByRole('button', { name: '5 stars' }), `${PLAYERS[index]}'s five-star rating`);
      await waitForRatingAcceptance(pages[index], index, eventSequenceBeforeClick);
    }

    if (answer < total) {
      await waitUntil(() => route(pages[0]) === '/rate' && visible(pages[0].getByText(new RegExp(`^Answer ${answer + 1} of ${total}$`))), `rating card ${answer + 1}`);
    }
  }
}

async function finishRoundAndEnterRoundTwo(pages) {
  await rateRound(pages);
  await waitForRoute(pages, '/predict', 'the subject prediction phase');
  let subjectIndex = -1;
  let firstPredictionChoice = null;
  await waitUntil(async () => {
    for (let index = 0; index < pages.length; index += 1) {
      const choice = pages[index].getByRole('button').filter({ hasText: /^A\b/ });
      if (await visible(choice)) {
        subjectIndex = index;
        firstPredictionChoice = choice;
        return true;
      }
    }
    return false;
  }, 'prediction choices to mount for the subject');
  await screenshot(pages, 'prediction');
  // Prediction.jsx labels its cards A, B, C. Select card A by that rendered marker.
  await clickEnabled(firstPredictionChoice, 'first prediction choice');
  await waitForRoomMutationSlot('submit_prediction');
  await clickEnabled(pages[subjectIndex].getByRole('button', { name: /Lock it in/i }), 'Lock it in button');
  await waitForRoute(pages, '/results', 'Round Results');
  await screenshot(pages, 'round-results');
  await clickEnabled(pages[0].getByRole('button', { name: /^Leaderboard/ }), 'Leaderboard button');
  await waitForRoute(pages, '/leaderboard', 'first-round Leaderboard');
  await waitForLeaderboardReady(pages);
  await screenshot(pages, 'round-one-leaderboard');
  await waitForRoomMutationSlot('advance');
  await clickEnabled(pages[0].getByRole('button', { name: /^Next Round/ }), 'Next Round button');
  await waitForRoute(pages, '/reveal', 'Round 2 subject reveal');
  await waitForRoundTwoReveal(pages);
  await screenshot(pages, 'round-two-reveal');
}

async function writeArtifacts(summary) {
  await Promise.all([
    writeFile(path.join(RESULTS, `${RUN_ID}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`),
    writeFile(path.join(RESULTS, `${RUN_ID}-console-errors.json`), `${JSON.stringify(consoleErrors, null, 2)}\n`),
    writeFile(path.join(RESULTS, `${RUN_ID}-room-requests.json`), `${JSON.stringify(roomRequests, null, 2)}\n`),
    writeFile(path.join(RESULTS, `${RUN_ID}-failed-room-requests.json`), `${JSON.stringify(failedRoomRequests, null, 2)}\n`),
  ]);
}

function summarizeRoomRequests() {
  const requests = roomRequests.filter((event) => event.type === 'request');
  const responses = roomRequests.filter((event) => event.type === 'response');
  const byAction = Object.fromEntries([...new Set(requests.map((event) => event.action))]
    .sort()
    .map((action) => [action, {
      requests: requests.filter((event) => event.action === action).length,
      failures: responses.filter((event) => event.action === action && event.outcome === 'failure').length,
      durationsMs: responses.filter((event) => event.action === action).map((event) => event.durationMs),
    }]));
  return {
    totalRequests: requests.length,
    failedResponses: responses.filter((event) => event.outcome === 'failure').length,
    mutationMinIntervalMs: MUTATION_MIN_INTERVAL_MS,
    byAction,
  };
}

// The smoke test creates a real, isolated room. Leave it through the same
// dialog a player uses so a normal backend leave/migration path performs the
// cleanup. This is deliberately best-effort: diagnostic artifacts from the
// primary test failure must never be hidden by a cleanup failure.
async function leaveTestRoom(pages) {
  if (!CLEANUP_ROOM || !roomCode) return [];
  const cleanupErrors = [];
  for (let index = pages.length - 1; index >= 0; index -= 1) {
    const page = pages[index];
    if (page.isClosed()) continue;
    try {
      const exit = page.getByRole('button', { name: /^Leave game$/i });
      if (!await visible(exit) || !await exit.isEnabled()) continue;
      await exit.click({ timeout: 3_000 });
      const confirm = page.getByRole('button', { name: /^Leave Game$/i });
      await waitUntil(async () => await visible(confirm) && await confirm.isEnabled(), `${PLAYERS[index]}'s Leave Game confirmation`, 5_000);
      await waitForRoomMutationSlot('leave');
      await confirm.click({ timeout: 3_000 });
      await waitUntil(() => route(page) === '/', `${PLAYERS[index]} to leave the test room`, 10_000);
    } catch (error) {
      cleanupErrors.push({ player: PLAYERS[index], error: error.message, at: new Date().toISOString() });
    }
  }
  return cleanupErrors;
}

await mkdir(RESULTS, { recursive: true });
const startedAt = new Date().toISOString();
let browser;
let contexts = [];
let pages = [];
let roomCode = null;
let failure = null;
let cleanupErrors = [];

try {
  await step('launch four independent Chromium contexts', async () => {
    browser = await chromium.launch({ headless: process.env.HEADED !== '1' });
    contexts = await Promise.all(PLAYERS.map(() => browser.newContext({ viewport: { width: 1440, height: 1000 } })));
    pages = await Promise.all(contexts.map((context) => context.newPage()));
    pages.forEach((page, index) => observe(page, PLAYERS[index]));
  });

  await step('open production in all four contexts', async () => {
    await Promise.all(pages.map((page) => page.goto(APP_URL, { waitUntil: 'domcontentloaded' })));
    await Promise.all(pages.map((page) => waitUntil(() => visible(page.getByRole('button', { name: /^Play$/ })), 'landing Play button')));
    await screenshot(pages, 'landing');
  });

  await step('create a room as Alpha', async () => {
    await createRoomAsAlpha(pages[0]);
    roomCode = await roomCodeFromLobby(pages[0]);
  });

  await step('join Bravo, Charlie, and Delta', async () => {
    // Sequential UI joins avoid turning an isolated smoke room into a synthetic
    // three-client write burst while still exercising four independent contexts.
    for (let index = 1; index < pages.length; index += 1) {
      await joinRoom(pages[index], PLAYERS[index], roomCode);
    }
  });

  await step('verify four-player synchronization', async () => {
    await verifyLobby(pages);
    await screenshot(pages, 'lobby-synchronized');
  });

  await step('start game as host', async () => {
    await waitForRoomMutationSlot('start');
    await clickEnabled(pages[0].getByRole('button', { name: /^Start Game$/ }), 'Start Game button');
    await waitForRoute(pages, '/reveal', 'all players to reach the first subject reveal');
    await waitUntil(() => visible(pages[0].getByText('Please review responsibly.', { exact: true })), 'complete subject reveal');
    await screenshot(pages, 'round-one-subject-reveal');
  });

  await step('complete first gameplay round and reach Round 2', async () => {
    // Reveal auto-advances on its authoritative five-second deadline. The
    // screenshots above can finish close to that deadline, so do not click an
    // outgoing Continue button whose route animation may briefly outlive the
    // reveal state.
    await waitForRoute(pages, '/write', 'writing phase');
    await submitAnswers(pages);
    await waitForRoute(pages, '/rate', 'rating phase');
    await finishRoundAndEnterRoundTwo(pages);
  });
} catch (error) {
  failure = error;
  try { if (pages.length) await screenshot(pages, `failure-${currentStep}`); }
  catch (captureError) { consoleErrors.push({ type: 'artifact-error', text: captureError.message, at: new Date().toISOString() }); }
} finally {
  try { cleanupErrors = await leaveTestRoom(pages); }
  catch (cleanupError) { cleanupErrors.push({ player: 'cleanup', error: cleanupError.message, at: new Date().toISOString() }); }
  await Promise.allSettled(contexts.map((context) => context.close()));
  if (browser) await browser.close();
  const summary = {
    status: failure ? 'failed' : 'passed', startedAt, completedAt: new Date().toISOString(), appUrl: APP_URL,
    roomCode, players: PLAYERS, lastStep: currentStep,
    failure: failure ? { message: failure.message, stack: failure.stack } : null,
    requestMetrics: summarizeRoomRequests(),
    artifacts: { screenshots, consoleErrors, roomRequests, failedRoomRequests, cleanupErrors },
  };
  await writeArtifacts(summary);
  if (failure) {
    console.error(`\nMULTIPLAYER SMOKE TEST FAILED at ${currentStep}\n${failure.stack || failure.message}`);
    process.exitCode = 1;
  } else {
    console.log(`\nMULTIPLAYER SMOKE TEST PASSED. Results: ${RESULTS}`);
  }
}
