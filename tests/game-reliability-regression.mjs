import assert from 'node:assert/strict';
import {
  ADVANCE_FALLBACK_STEP_MS,
  advanceFallbackDelay,
  createAdvanceCoordinator,
} from '../src/game/advanceCoordinator.js';
import { createAnswerSubmissionCoordinator } from '../src/game/answerSubmissionCoordinator.js';
import { matchesAdvanceExpectation } from '../base44/shared/game.ts';

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
  const writing = { phase: 'writing', phase_deadline: '2026-10-11T07:10:40.000Z' };
  const rating = { phase: 'rating', phase_deadline: '2026-10-11T07:10:50.000Z' };
  assert.equal(matchesAdvanceExpectation(writing, 'writing', writing.phase_deadline), true);
  assert.equal(matchesAdvanceExpectation(writing, 'reveal', writing.phase_deadline), false);
  assert.equal(matchesAdvanceExpectation(rating, 'writing', writing.phase_deadline), false);
  assert.equal(matchesAdvanceExpectation(rating, 'rating', writing.phase_deadline), false);
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

async function rateLimitedAnswerIsReconciledBeforeRetrying() {
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
      // The first verification is itself rate-limited. The next retry must
      // reconcile again before sending a second mutation.
      if (reconcileCalls === 1) return { error: 'Rate limit exceeded', ambiguous: true };
      return { accepted: false };
    },
  });

  const first = await coordinator.submit('A careful answer');
  assert.equal(first.accepted, undefined);
  assert.equal(first.retryable, true);
  assert.equal(submitCalls, 1);

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

await duplicateDeadlineCallbacksAreCoalesced();
await simultaneousClientsUseOwnerAndFallbackOrder();
activeHostIsPreferredBeforeFallbacks();
await delayedAdvanceResponseStaysSingleFlightAndRetriesAreBounded();
delayedAdvanceCannotSkipTheNextServerPhase();
await disconnectedHostDoesNotStrandFallback();
await rateLimitedAnswerIsReconciledBeforeRetrying();
await ambiguousAnswerResponseDoesNotDuplicate();

console.log('Game reliability regressions passed.');
