import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROSTER_REQUEST_TIMEOUT_MS,
  RosterRequestTimeoutError,
  createRosterRequestController,
  isRosterRequestTimeout,
} from '../src/game/rosterRequest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));

const tick = () => new Promise((resolve) => setImmediate(resolve));

// Manual timers + manually settled requests.
function harness({ timeoutMs = 1000 } = {}) {
  const timers = new Map();
  let nextTimer = 0;
  const pending = [];
  const controller = createRosterRequestController({
    timeoutMs,
    setTimer: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimer: (id) => timers.delete(id),
    request: (code, reason) => new Promise((resolve, reject) => pending.push({ code, reason, resolve, reject })),
  });
  return {
    controller,
    pending,
    activeTimers: () => timers.size,
    fireTimeouts: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
  };
}

// Mirrors how fetchRoster consumes the controller: apply data only when the
// outcome is not stale; failures are transient.
async function refresh(controller, applied, label) {
  try {
    const outcome = await controller.run('ABCD', label);
    if (outcome.stale) return 'stale';
    applied.push(outcome.data);
    return 'applied';
  } catch (error) {
    return isRosterRequestTimeout(error) ? 'timeout' : 'error';
  }
}

async function defaultTimeoutIsBounded() {
  assert.ok(ROSTER_REQUEST_TIMEOUT_MS > 0 && ROSTER_REQUEST_TIMEOUT_MS <= 15000);
  assert.ok(new RosterRequestTimeoutError(5) instanceof Error);
}

async function stalledRequestTimesOutAndReleasesTheGuard() {
  const h = harness();
  const applied = [];
  const first = refresh(h.controller, applied, 'first');
  await tick();
  assert.equal(h.controller.isInFlight(), true, 'guard is held while the request is pending');
  assert.equal(h.activeTimers(), 1);

  h.fireTimeouts();
  assert.equal(await first, 'timeout');
  assert.equal(h.controller.isInFlight(), false, 'a timeout must release the in-flight guard');
  assert.deepEqual(applied, []);
}

async function nextRefreshRecoversAfterATimeout() {
  const h = harness();
  const applied = [];
  const stalled = refresh(h.controller, applied, 'stalled');
  await tick();
  h.fireTimeouts();
  assert.equal(await stalled, 'timeout');

  const retry = refresh(h.controller, applied, 'retry');
  await tick();
  assert.equal(h.pending.length, 2, 'a new request is actually sent after the timeout');
  h.pending[1].resolve({ players: ['a', 'b', 'c', 'd'] });
  assert.equal(await retry, 'applied');
  assert.deepEqual(applied, [{ players: ['a', 'b', 'c', 'd'] }]);
  assert.equal(h.controller.isInFlight(), false);
  assert.equal(h.activeTimers(), 0, 'success clears the timeout timer');
}

async function lateResponseFromATimedOutRequestIsNeverApplied() {
  const h = harness();
  const applied = [];
  const stalled = refresh(h.controller, applied, 'stalled');
  await tick();
  h.fireTimeouts();
  assert.equal(await stalled, 'timeout');

  const newer = refresh(h.controller, applied, 'newer');
  await tick();
  h.pending[1].resolve({ roster: 'NEWER-4-players' });
  assert.equal(await newer, 'applied');

  // The first request finally answers with an older three-player snapshot.
  h.pending[0].resolve({ roster: 'OLD-3-players' });
  await tick();
  assert.deepEqual(applied, [{ roster: 'NEWER-4-players' }], 'late data must not overwrite the newer roster');
}

async function lateFailureAfterTimeoutIsSilentAndDoesNotReleaseANewerGuard() {
  const h = harness();
  const applied = [];
  const stalled = refresh(h.controller, applied, 'stalled');
  await tick();
  h.fireTimeouts();
  await stalled;

  const newer = refresh(h.controller, applied, 'newer');
  await tick();
  h.pending[0].reject(new Error('socket hang up'));
  await tick();
  assert.equal(h.controller.isInFlight(), true, 'a late failure must not release the newer request\'s guard');
  h.pending[1].resolve({ ok: true });
  assert.equal(await newer, 'applied');
  assert.deepEqual(unhandled, [], 'abandoned request must not raise an unhandled rejection');
}

async function invalidateDropsPendingRequestWithoutReleasingTheNextOne() {
  const h = harness();
  const applied = [];
  const before = refresh(h.controller, applied, 'before-reset');
  await tick();
  h.controller.invalidate(); // leave/reset room
  assert.equal(h.controller.isInFlight(), false);

  const after = refresh(h.controller, applied, 'after-rejoin');
  await tick();
  h.pending[0].resolve({ roster: 'previous-room-state' });
  assert.equal(await before, 'stale');
  assert.equal(h.controller.isInFlight(), true, 'stale completion must not release the newer guard');
  h.pending[1].resolve({ roster: 'fresh' });
  assert.equal(await after, 'applied');
  assert.deepEqual(applied, [{ roster: 'fresh' }]);
}

async function nonTimeoutFailuresPropagateAndReleaseTheGuard() {
  const h = harness();
  const applied = [];
  const attempt = refresh(h.controller, applied, 'boom');
  await tick();
  h.pending[0].reject(new Error('Rate limit exceeded'));
  assert.equal(await attempt, 'error');
  assert.equal(h.controller.isInFlight(), false);
  assert.equal(h.activeTimers(), 0);
}

async function realTimersTimeOutAStalledRequest() {
  const controller = createRosterRequestController({ timeoutMs: 20, request: () => new Promise(() => {}) });
  const started = Date.now();
  await assert.rejects(() => controller.run('ABCD', 'real-timer'), (error) => isRosterRequestTimeout(error));
  assert.ok(Date.now() - started < 1000);
  assert.equal(controller.isInFlight(), false);
}

async function wiringAndDiagnosticsStayInPlace() {
  const ctx = await readFile(path.join(ROOT, 'src/game/GameContext.jsx'), 'utf8');
  assert.match(ctx, /createRosterRequestController/);
  assert.ok(!ctx.includes('inFlightRosterRef'), 'fetchRoster must use the bounded controller, not a raw in-flight flag');
  assert.match(ctx, /rosterControllerRef\.current\.run\(code, clientReason\)/);
  assert.match(ctx, /if \(outcome\.stale\) return;/);
  assert.match(ctx, /isRateLimited\(null, e\) \|\| isRosterRequestTimeout\(e\)/);
  assert.match(ctx, /rosterControllerRef\.current\?\.invalidate\(\)/);

  const entry = await readFile(path.join(ROOT, 'base44/functions/room/entry.ts'), 'utf8');
  const lookup = entry.slice(entry.indexOf("case 'lookup'"), entry.indexOf("case 'getRoster'"));
  assert.ok(!lookup.includes('playersOf'), 'lookup must not read RoomPlayer');
  assert.ok(!lookup.includes('active_count:'), 'lookup response no longer carries active_count');
  assert.match(lookup, /Response\.json\(\{ room, build: BACKEND_BUILD_ID \}\)/);
  assert.match(lookup, /not_found/);
  assert.match(lookup, /status: 410/);
  assert.match(entry, /headers\.set\(BACKEND_BUILD_HEADER, BACKEND_BUILD_ID\)/);

  const lookupClient = ctx.slice(ctx.indexOf('const lookupRoom'), ctx.indexOf('const requestRoster'));
  assert.ok(!lookupClient.includes('active_count'), 'no client may depend on active_count');

  const vite = await readFile(path.join(ROOT, 'vite.config.js'), 'utf8');
  assert.match(vite, /__APP_BUILD__/);

  for (const file of ['base44/shared/build.ts', 'src/lib/build-info.js']) {
    const code = (await readFile(path.join(ROOT, file), 'utf8')).split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.ok(!/process\.env|Deno\.env|import\.meta\.env|token|secret|password/i.test(code), `${file} must not touch secrets`);
  }
}

await defaultTimeoutIsBounded();
await stalledRequestTimesOutAndReleasesTheGuard();
await nextRefreshRecoversAfterATimeout();
await lateResponseFromATimedOutRequestIsNeverApplied();
await lateFailureAfterTimeoutIsSilentAndDoesNotReleaseANewerGuard();
await invalidateDropsPendingRequestWithoutReleasingTheNextOne();
await nonTimeoutFailuresPropagateAndReleaseTheGuard();
await realTimersTimeOutAStalledRequest();
await wiringAndDiagnosticsStayInPlace();

console.log('Roster request regressions passed.');
