// Coordinates a client's deadline-driven advance requests. The room function
// remains authoritative: this only avoids sending the same observation over
// and over while waiting for its authoritative response or a realtime update.

export const ADVANCE_RETRY_DELAYS_MS = [6_000, 18_000];
export const ADVANCE_FALLBACK_STEP_MS = 12_000;

// Serializes this browser's advance mutations. Deadline callbacks should
// return immediately when another mutation is in flight, but a deliberate
// visual "continue" action can wait behind an unrelated advance instead of
// being silently lost. The server still validates each expected phase/round.
export function createAdvanceRequestGate({ send }) {
  let current = null;
  const queued = [];

  const run = (job) => {
    current = job;
    void Promise.resolve()
      .then(() => send(job.payload))
      .then(job.resolve, (error) => job.resolve({ error: error?.message || "advance_failed" }))
      .finally(() => {
        if (current === job) current = null;
        const next = queued.shift();
        if (next) run(next);
      });
  };

  const duplicate = (key) => current?.key === key || queued.some((job) => job.key === key);

  return {
    request(key, payload, { queueAfterInFlight = false } = {}) {
      if (!key) return Promise.resolve({ error: "advance_unavailable", retryable: false });
      if (duplicate(key)) return Promise.resolve({ error: "advance_pending", retryable: false });
      if (current && !queueAfterInFlight) return Promise.resolve({ error: "advance_pending", retryable: false });

      return new Promise((resolve) => {
        const job = { key, payload, resolve };
        if (current) queued.push(job);
        else run(job);
      });
    },
    reset() {
      while (queued.length) queued.shift().resolve({ error: "advance_cancelled", retryable: false });
    },
    getState: () => ({ inFlightKey: current?.key || "", queuedKeys: queued.map((job) => job.key) }),
  };
}

export function phaseDeadlineKey(roomCode, gameState) {
  if (!roomCode || !gameState?.phase || !gameState?.phase_deadline) return "";
  return `${roomCode}:${gameState.phase}:${gameState.phase_deadline}:${gameState.rating_index ?? 0}`;
}

// Every client calculates the same order from the active roster. The first
// client requests the advance immediately; the others are bounded fallbacks.
// This is deliberately not host-only, so a disconnected host cannot strand a
// room at a deadline.
export function advanceFallbackDelay(sessionId, players) {
  const active = (players || []).filter((player) => player.connected && player.sessionId);
  const ids = [...new Set(active.map((player) => player.sessionId))].sort();
  const hostId = active.find((player) => player.isHost)?.sessionId;
  if (hostId && ids.includes(hostId)) {
    ids.splice(ids.indexOf(hostId), 1);
    ids.unshift(hostId);
  }
  if (!ids.includes(sessionId)) ids.push(sessionId);
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
