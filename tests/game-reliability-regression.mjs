import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADVANCE_FALLBACK_STEP_MS,
  advanceFallbackDelay,
  createAdvanceCoordinator,
  createAdvanceRequestGate,
} from '../src/game/advanceCoordinator.js';
import { createAnswerSubmissionCoordinator } from '../src/game/answerSubmissionCoordinator.js';
import { matchesAdvanceExpectation } from '../base44/shared/game.ts';
import { activePlayers, selectActiveHost } from '../base44/shared/rooms.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createScheduler() {
  let now = 0;
  let nextId = 0;
  const tasks = new Map();

  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  return {
    schedule(callback, delay) {
      const id = ++nextId;
      tasks.set(id, { due: now + delay, callback });
      return id;
    },
    cancel(id) { tasks.delete(id); },
    async advanceBy(ms) {
      const target = now + ms;
      while (true) {
        const ready = [...tasks.entries()]
          .filter(([, task]) => task.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!ready) break;
        const [id, task] = ready;
        tasks.delete(id);
        now = task.due;
        task.callback();
        await flush();
      }
      now = target;
      await flush();
    },
    flush,
    pending: () => tasks.size,
  };
}

async function duplicateDeadlineCallbacksAreCoalesced() {
  let calls = 0;
  const coordinator = createAdvanceCoordinator({ send: async () => { calls += 1; return { advanced: true }; } });
  const key = 'room:writing:deadline:0';

  await Promise.all(Array.from({ length: 8 }, () => coordinator.request(key)));
  await coordinator.request(key);

  assert.equal(calls, 1, 'one client must send only one acknowledged advance per phase/deadline');
}

async function simultaneousClientsUseOwnerAndFallbackOrder() {
  const scheduler = createScheduler();
  const players = ['alpha', 'bravo', 'charlie', 'delta'].map((sessionId) => ({ sessionId, connected: true }));
  const calls = [];
  const coordinators = new Map(players.map(({ sessionId }) => [sessionId, createAdvanceCoordinator({
    send: async () => { calls.push(sessionId); return { advanced: true }; },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  })]));
  const key = 'room:writing:deadline:0';

  for (const { sessionId } of players) {
    void coordinators.get(sessionId).request(key, advanceFallbackDelay(sessionId, players));
  }
  await scheduler.flush();
  assert.deepEqual(calls, ['alpha'], 'the deterministic owner should advance first');

  // Realtime delivers the new authoritative phase before standby fallbacks.
  for (const coordinator of coordinators.values()) coordinator.observe('room:rating:new-deadline:0');
  await scheduler.advanceBy(ADVANCE_FALLBACK_STEP_MS * players.length);
  assert.deepEqual(calls, ['alpha'], 'standby clients must cancel their old-phase callbacks');
}

function activeHostIsPreferredBeforeFallbacks() {
  const players = [
    { sessionId: 'alpha', connected: true },
    { sessionId: 'bravo-host', connected: true, isHost: true },
    { sessionId: 'charlie', connected: true },
  ];
  assert.equal(advanceFallbackDelay('bravo-host', players), 0, 'the active host should make the first deadline request');
  assert.equal(advanceFallbackDelay('alpha', players), ADVANCE_FALLBACK_STEP_MS, 'non-hosts must remain delayed fallbacks');
}

async function delayedAdvanceResponseStaysSingleFlightAndRetriesAreBounded() {
  const scheduler = createScheduler();
  let calls = 0;
  let resolveFirst;
  const coordinator = createAdvanceCoordinator({
    send: () => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve({ error: 'Rate limit exceeded' });
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    retryDelays: [10, 20],
  });
  const key = 'room:reveal:deadline:0';

  const first = coordinator.request(key);
  await scheduler.flush();
  void coordinator.request(key);
  assert.equal(calls, 1, 'a delayed request must block duplicate in-flight requests');

  resolveFirst({ error: 'Rate limit exceeded' });
  await first;
  await scheduler.advanceBy(10);
  await scheduler.advanceBy(20);
  await scheduler.advanceBy(1_000);
  assert.equal(calls, 3, 'initial request plus configured retries must be bounded');
  assert.equal(scheduler.pending(), 0, 'no continuous deadline polling timer may remain after retries');
}

function delayedAdvanceCannotSkipTheNextServerPhase() {
  const writing = { phase: 'writing', phase_deadline: '2026-10-11T07:10:40.000Z', round_index: 2 };
  const rating = { phase: 'rating', phase_deadline: '2026-10-11T07:10:50.000Z', round_index: 2 };
  assert.equal(matchesAdvanceExpectation(writing, 'writing', writing.phase_deadline, 2), true);
  assert.equal(matchesAdvanceExpectation(writing, 'reveal', writing.phase_deadline), false);
  assert.equal(matchesAdvanceExpectation(rating, 'writing', writing.phase_deadline), false);
  assert.equal(matchesAdvanceExpectation(rating, 'rating', writing.phase_deadline), false);
  assert.equal(matchesAdvanceExpectation(writing, 'writing', writing.phase_deadline, 1), false);
}

async function disconnectedHostDoesNotStrandFallback() {
  const scheduler = createScheduler();
  // The host still appears in a stale roster, but its browser has gone away.
  // Bravo's deterministic fallback therefore takes ownership after one step.
  const players = [
    { sessionId: 'alpha-host', connected: true },
    { sessionId: 'bravo', connected: true },
  ];
  let calls = 0;
  const bravo = createAdvanceCoordinator({
    send: async () => { calls += 1; return { advanced: true }; },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });

  void bravo.request('room:prediction:deadline:0', advanceFallbackDelay('bravo', players));
  await scheduler.advanceBy(ADVANCE_FALLBACK_STEP_MS - 1);
  assert.equal(calls, 0, 'fallback should wait briefly for the preferred client');
  await scheduler.advanceBy(1);
  assert.equal(calls, 1, 'a non-host fallback must advance when the host is unavailable');
}

function heartbeatKeepsPresenceAndMigratesOnlyAfterTheReconnectWindow() {
  const now = Date.parse('2026-10-11T10:00:00.000Z');
  const players = [
    { id: 'host-row', session_id: 'alpha-host', created_date: '2026-10-01T00:00:00.000Z', last_seen: new Date(now - 60_001).toISOString(), connected: true },
    { id: 'bravo-row', session_id: 'bravo', created_date: '2026-10-02T00:00:00.000Z', last_seen: new Date(now - 1_000).toISOString(), connected: true },
    { id: 'charlie-row', session_id: 'charlie', created_date: '2026-10-03T00:00:00.000Z', last_seen: new Date(now - 30_000).toISOString(), connected: true },
  ];
  assert.deepEqual(activePlayers(players, now).map((player) => player.session_id), ['bravo', 'charlie']);
  assert.equal(selectActiveHost(players, now, 60_000)?.session_id, 'bravo', 'a stale host must migrate to the deterministic earliest active player');
  assert.equal(selectActiveHost([{ ...players[0], last_seen: new Date(now - 59_999).toISOString() }], now, 60_000)?.session_id, 'alpha-host', 'a host inside the 60-second window must remain active');
}

async function normalHeartbeatAvoidsRedundantEntityReads() {
  // Exact entity-operation counts and the removal / closure / migration
  // outcomes are verified against the real handler in
  // tests/room-backend-regression.mjs. These structural checks keep the
  // guarantees this test always protected.
  const entry = await readFile(path.join(ROOT, 'base44/functions/room/entry.ts'), 'utf8');
  const heartbeat = entry.slice(entry.indexOf("case 'heartbeat':"), entry.indexOf("case 'leave':"));
  assert.match(heartbeat, /if \(!me\) return Response\.json\(\{ error: 'not_in_room' \}/, 'membership must be validated before the presence write');
  assert.match(heartbeat, /catch \(error\)[\s\S]*?error: 'gone'[\s\S]*?error: 'not_in_room'/, 'a failed presence write must re-validate the room and membership before reporting an error');
  const afterWrite = heartbeat.slice(heartbeat.indexOf('const freshPlayers'));
  assert.doesNotMatch(afterWrite, /findRoom\(|playersOf\(/, 'a successful heartbeat must not reread the room or roster after the write');
  assert.match(heartbeat, /const freshPlayers = players\.map/, 'the caller must be included as fresh before host migration');
  assert.match(heartbeat, /selectActiveHost\(freshPlayers, now, HOST_MIGRATION_GRACE_MS\)/, 'host migration must keep using the 60-second grace window');
}

async function lobbyReconciliationIsHostOwnedAndHonorsBackoff() {
  const context = await readFile(path.join(ROOT, 'src/game/GameContext.jsx'), 'utf8');
  const lobbySync = context.slice(context.indexOf('const syncLobbyRoster = () =>'), context.indexOf('return () => {', context.indexOf('const syncLobbyRoster = () =>')));

  assert.match(lobbySync, /if \(!active \|\| !isHost \|\| roomStatusRef\.current !== "lobby"\) return/,
    'only the current host should reconcile a lobby roster');
  assert.match(lobbySync, /refreshPlayersRef\.current\(\{ reason: "lobby-sync" \}\)/,
    'the periodic reconciliation must use the path that respects an active backoff');
  assert.doesNotMatch(lobbySync, /fetchRosterRef\.current\(roomCode, "lobby-sync"\)/,
    'the periodic reconciliation must not bypass rate-limit backoff');
  assert.match(lobbySync, /setTimeout\(syncLobbyRoster, LOBBY_ROSTER_SYNC_MS\)/,
    'the host should continue reconciling for the life of the lobby');
  assert.match(context, /const LOBBY_ROSTER_INITIAL_SYNC_MS = 5000/);
  assert.match(context, /const LOBBY_ROSTER_SYNC_MS = 10000/);
  assert.doesNotMatch(context, /LOBBY_ROSTER_FAST_SYNC_MS|LOBBY_ROSTER_FAST_WINDOW_MS/,
    'the former two-second lobby polling loop must be removed');
}

async function manualNextRoundQueuesBehindAnUnrelatedAdvance() {
  let releasePrevious;
  const calls = [];
  const gate = createAdvanceRequestGate({
    send: (payload) => {
      calls.push(payload.expected_phase);
      if (payload.expected_phase === 'results') return new Promise((resolve) => { releasePrevious = resolve; });
      return Promise.resolve({ advanced: true });
    },
  });

  const results = gate.request('room:results::0', { expected_phase: 'results', expected_round: 0 });
  const leaderboard = gate.request(
    'room:leaderboard::0',
    { expected_phase: 'leaderboard', expected_round: 0 },
    { queueAfterInFlight: true },
  );
  assert.deepEqual(calls, [], 'the gate starts its sender in a microtask');
  await Promise.resolve();
  assert.deepEqual(calls, ['results'], 'the unrelated Results advance should remain the only in-flight request');

  releasePrevious({ advanced: true });
  assert.deepEqual(await results, { advanced: true });
  assert.deepEqual(await leaderboard, { advanced: true });
  assert.deepEqual(calls, ['results', 'leaderboard'], 'Next Round must reach the backend once the unrelated advance settles');
}

async function duplicateManualNextRoundDoesNotQueueTwice() {
  let release;
  let calls = 0;
  const gate = createAdvanceRequestGate({
    send: () => {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    },
  });
  const first = gate.request('room:leaderboard::1', { expected_phase: 'leaderboard', expected_round: 1 });
  await Promise.resolve();
  const duplicate = await gate.request('room:leaderboard::1', { expected_phase: 'leaderboard', expected_round: 1 }, { queueAfterInFlight: true });
  assert.equal(duplicate.error, 'advance_pending', 'repeated Next Round clicks must not produce duplicate mutations');
  release({ advanced: true });
  await first;
  assert.equal(calls, 1);
}

async function rateLimitedAnswerIsReconciledBeforeRetrying() {
  const scheduler = createScheduler();
  let now = 0;
  let submitCalls = 0;
  let successfulAnswers = 0;
  let reconcileCalls = 0;
  const coordinator = createAnswerSubmissionCoordinator({
    submit: async () => {
      submitCalls += 1;
      if (submitCalls === 1) return { error: 'Rate limit exceeded', ambiguous: true, retryable: true };
      successfulAnswers += 1;
      return { accepted: true };
    },
    reconcile: async () => {
      reconcileCalls += 1;
      // The first safe verification is itself rate-limited. The next bounded
      // reconciliation must run before sending a second mutation.
      if (reconcileCalls === 1) return { error: 'Rate limit exceeded', ambiguous: true };
      return { accepted: false };
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => now,
    random: () => 0.5,
    reconciliationRetryDelays: [10, 20],
  });

  const first = await coordinator.submit('A careful answer');
  assert.equal(first.accepted, undefined);
  assert.equal(first.retryable, true);
  assert.equal(submitCalls, 1);
  assert.equal(reconcileCalls, 0, 'a rate-limited write must not trigger an immediate extra getRoster request');

  const tooSoon = await coordinator.submit('A careful answer');
  assert.equal(tooSoon.error, 'submission_reconciliation_pending');
  assert.equal(submitCalls, 1, 'a pending safe reconciliation must block a duplicate mutation');

  now += 10;
  await scheduler.advanceBy(10);
  assert.equal(reconcileCalls, 1);
  now += 20;
  await scheduler.advanceBy(20);
  assert.equal(reconcileCalls, 2);

  const retry = await coordinator.submit('A careful answer');
  assert.equal(retry.accepted, true);
  assert.equal(submitCalls, 2, 'retry may submit only after authoritative reconciliation says no answer exists');
  assert.equal(successfulAnswers, 1, 'the successful retry must create exactly one answer');
}

async function ambiguousAnswerResponseDoesNotDuplicate() {
  let submitCalls = 0;
  const coordinator = createAnswerSubmissionCoordinator({
    submit: async () => {
      submitCalls += 1;
      return { error: 'request timed out', ambiguous: true, retryable: true };
    },
    // The server accepted the first request but its response was lost.
    reconcile: async () => ({ accepted: true, room: { game_state: { answers: [{}] } } }),
  });

  const result = await coordinator.submit('An answer with a lost response');
  assert.equal(result.accepted, true);
  assert.equal(submitCalls, 1);
  const repeated = await coordinator.submit('An answer with a lost response');
  assert.equal(repeated.alreadyConfirmed, true);
  assert.equal(submitCalls, 1, 'confirmed ambiguous submissions must never be resent');
}

async function persistedPredictionIsAcceptedAfterAnHttp500() {
  const scheduler = createScheduler();
  let now = 0;
  let submitCalls = 0;
  let reconciliationCalls = 0;
  const coordinator = createAnswerSubmissionCoordinator({
    submit: async () => {
      submitCalls += 1;
      return { error: 'Rate limit exceeded', ambiguous: true, retryable: true };
    },
    // The write committed, but a later backend operation was rate limited.
    reconcile: async (answerId) => {
      reconciliationCalls += 1;
      return { accepted: answerId === 'answer-a', room: { game_state: { prediction: 'answer-a' } } };
    },
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
    now: () => now,
    random: () => 0.5,
    reconciliationRetryDelays: [10],
  });

  const result = await coordinator.submit('answer-a');
  assert.equal(result.accepted, undefined);
  assert.equal(result.retryable, true);
  assert.equal(submitCalls, 1);
  assert.equal(reconciliationCalls, 0, 'a rate-limited write must cool down before its safe read-only reconciliation');

  now += 10;
  await scheduler.advanceBy(10);
  assert.equal(reconciliationCalls, 1);

  const repeated = await coordinator.submit('answer-a');
  assert.equal(repeated.alreadyConfirmed, true);
  assert.equal(submitCalls, 1, 'a reconciled prediction must never be submitted twice');
}

async function predictionEndpointTreatsMatchingRetryAsIdempotent() {
  const entry = await readFile(path.join(ROOT, 'base44/functions/room/entry.ts'), 'utf8');
  const prediction = entry.slice(entry.indexOf("case 'submit_prediction':"), entry.indexOf("case 'advance':"));
  assert.match(prediction, /gs\.prediction === answerId\) return Response\.json\(\{ room, accepted: true, already_predicted: true \}\)/);
  assert.match(prediction, /return Response\.json\(\{ room, error: 'already_predicted' \}, \{ status: 409 \}\)/);
}

async function smokeTestWaitsForRenderedLeaderboardAndRoundTwoContent() {
  const smoke = await readFile(path.join(ROOT, 'tests/multiplayer-smoke.mjs'), 'utf8');
  assert.match(smoke, /async function waitForLeaderboardReady/);
  assert.ok(smoke.includes("page.getByRole('heading', { name: /^LEADERBOARD$/i })"));
  assert.match(smoke, /async function waitForRoundTwoReveal/);
  assert.match(smoke, /new Set\(subjectNames\)\.size === 1/);
  assert.match(smoke, /const MUTATION_MIN_INTERVAL_MS/);
  assert.match(smoke, /await waitForRoomMutationSlot\('submit_answer'\)/);
  assert.match(smoke, /for \(let index = 1; index < pages\.length; index \+= 1\)/,
    'the controlled smoke run must join independent clients without a parallel join burst');
}

await duplicateDeadlineCallbacksAreCoalesced();
await simultaneousClientsUseOwnerAndFallbackOrder();
activeHostIsPreferredBeforeFallbacks();
await delayedAdvanceResponseStaysSingleFlightAndRetriesAreBounded();
delayedAdvanceCannotSkipTheNextServerPhase();
await disconnectedHostDoesNotStrandFallback();
heartbeatKeepsPresenceAndMigratesOnlyAfterTheReconnectWindow();
await normalHeartbeatAvoidsRedundantEntityReads();
await lobbyReconciliationIsHostOwnedAndHonorsBackoff();
await manualNextRoundQueuesBehindAnUnrelatedAdvance();
await duplicateManualNextRoundDoesNotQueueTwice();
await rateLimitedAnswerIsReconciledBeforeRetrying();
await ambiguousAnswerResponseDoesNotDuplicate();
await persistedPredictionIsAcceptedAfterAnHttp500();
await predictionEndpointTreatsMatchingRetryAsIdempotent();
await smokeTestWaitsForRenderedLeaderboardAndRoundTwoContent();

console.log('Game reliability regressions passed.');
