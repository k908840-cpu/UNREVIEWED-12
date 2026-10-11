// Coordinates a client's deadline-driven advance requests. The room function
// remains authoritative: this only avoids sending the same observation over
// and over while waiting for its authoritative response or a realtime update.

export const ADVANCE_RETRY_DELAYS_MS = [2_000, 6_000, 15_000];
export const ADVANCE_FALLBACK_STEP_MS = 4_000;

export function phaseDeadlineKey(roomCode, gameState) {
  if (!roomCode || !gameState?.phase || !gameState?.phase_deadline) return "";
  return `${roomCode}:${gameState.phase}:${gameState.phase_deadline}:${gameState.rating_index ?? 0}`;
}

// Every client calculates the same order from the active roster. The first
// client requests the advance immediately; the others are bounded fallbacks.
// This is deliberately not host-only, so a disconnected host cannot strand a
// room at a deadline.
export function advanceFallbackDelay(sessionId, players) {
  const ids = [...new Set((players || [])
    .filter((player) => player.connected)
    .map((player) => player.sessionId)
    .filter(Boolean))];
  if (!ids.includes(sessionId)) ids.push(sessionId);
  ids.sort();
  return Math.max(0, ids.indexOf(sessionId)) * ADVANCE_FALLBACK_STEP_MS;
}

export function createAdvanceCoordinator({
  send,
  schedule = setTimeout,
  cancel = clearTimeout,
  retryDelays = ADVANCE_RETRY_DELAYS_MS,
}) {
  let observedKey = "";
  let acknowledgedKey = "";
  let inFlight = false;
  let retryIndex = 0;
  let timer = null;
  let disposed = false;

  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const observe = (key) => {
    if (key === observedKey) return;
    observedKey = key;
    acknowledgedKey = "";
    retryIndex = 0;
    clearTimer();
  };

  const run = async (key) => {
    if (disposed || !key || key !== observedKey || key === acknowledgedKey || inFlight) {
      return { skipped: true };
    }

    inFlight = true;
    let result;
    try {
      result = await send();
    } catch (error) {
      result = { error: error?.message || "advance_failed" };
    } finally {
      inFlight = false;
    }

    // A non-error response is an acknowledgement for this exact observed
    // phase/deadline, even when the server correctly reports advanced: false.
    // The next realtime room state supplies a new key if another advance is
    // needed.
    if (!result?.error) {
      acknowledgedKey = key;
      retryIndex = 0;
      clearTimer();
      return result;
    }

    if (key === observedKey && retryIndex < retryDelays.length && !disposed) {
      const delay = retryDelays[retryIndex];
      retryIndex += 1;
      clearTimer();
      timer = schedule(() => {
        timer = null;
        void run(key);
      }, delay);
    }
    return result;
  };

  const request = (key, delay = 0) => {
    observe(key);
    if (disposed || !key || key === acknowledgedKey || inFlight || timer !== null) {
      return Promise.resolve({ skipped: true });
    }
    if (delay > 0) {
      timer = schedule(() => {
        timer = null;
        void run(key);
      }, delay);
      return Promise.resolve({ scheduled: true });
    }
    return run(key);
  };

  return {
    observe,
    request,
    reset() {
      observedKey = "";
      acknowledgedKey = "";
      retryIndex = 0;
      clearTimer();
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
    getState: () => ({ observedKey, acknowledgedKey, inFlight, retryIndex, scheduled: timer !== null }),
  };
}
