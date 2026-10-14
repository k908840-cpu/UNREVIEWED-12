// A saved room code proves only that this device joined a room before. It does
// not prove that the player still wants to enter it when the app opens.
// A device without its local membership capability cannot prove it owns a
// saved anonymous seat. Treat it as stale instead of falling back to the
// historical session-id-only recovery path.
const TERMINAL_ROOM_ERRORS = new Set([
  "not_found", "closed", "not_in_room", "missing_membership_capability",
  "invalid_membership_capability", "legacy_membership",
]);

export function classifySavedRoomResponse(data, sessionId) {
  const error = data?.error;
  if (TERMINAL_ROOM_ERRORS.has(error)) return { status: "stale", reason: error };

  // Preserve a saved session through temporary network and rate-limit failures.
  // The player can explicitly retry or leave; we must not silently rejoin them.
  if (error || !data?.room || !Array.isArray(data?.players)) {
    return { status: "unavailable", reason: error || "resume_unavailable" };
  }

  const player = data.players.find((candidate) => candidate?.session_id === sessionId);
  if (!player) return { status: "stale", reason: "not_in_room" };

  if (data.room.status !== "lobby" && data.room.status !== "playing") {
    return { status: "stale", reason: "closed" };
  }

  return { status: "available", room: data.room, players: data.players, player };
}

// Async roster reads can finish after Leave Game succeeds. A matching attempt,
// room code, and active lifecycle are all required before applying a response.
export function isCurrentSavedRoomRecovery({ attempt, currentAttempt, code, activeRoomCode }) {
  return attempt === currentAttempt && code === activeRoomCode;
}
