// Tracks when the server last confirmed this player's presence as a side
// effect of a game action, so a standalone heartbeat invocation can be skipped.
//
// Safety model:
//  - The server records presence on submit_answer / submit_rating /
//    submit_prediction and says so with `presence_recorded: true`. A backend
//    that has not been deployed with that change never sends the flag, so the
//    client keeps sending every heartbeat exactly as before.
//  - A heartbeat is skipped only while the confirmed write is younger than
//    PRESENCE_SKIP_WINDOW_MS. With a 20s heartbeat interval the longest
//    possible gap between presence writes is therefore
//    PRESENCE_SKIP_WINDOW_MS + HEARTBEAT_MS (35s), safely inside the server's
//    60s active-player and host-migration windows.

export const PRESENCE_SKIP_WINDOW_MS = 15000;

// Actions whose server handler persists last_seen for the calling player.
export const PRESENCE_ACTIONS = new Set(["submit_answer", "submit_rating", "submit_prediction"]);

export function createPresenceTracker({ now = () => Date.now(), windowMs = PRESENCE_SKIP_WINDOW_MS } = {}) {
  let confirmedAt = 0;
  return {
    // Call with every callRoom result. Only a successful response that the
    // server explicitly flagged counts as confirmed presence.
    record(action, data) {
      if (!PRESENCE_ACTIONS.has(action)) return;
      if (!data || data.error || data.presence_recorded !== true) return;
      confirmedAt = now();
    },
    shouldSkipHeartbeat() {
      return confirmedAt > 0 && now() - confirmedAt < windowMs;
    },
    reset() { confirmedAt = 0; },
  };
}
