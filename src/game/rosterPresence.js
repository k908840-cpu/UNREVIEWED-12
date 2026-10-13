// A game cannot gain new members after Start, so an authoritative heartbeat
// roster can safely remove departed players without another getRoster request.
// Keeping this pure makes the no-polling reconciliation behavior testable.
export function removeDepartedPlayers(players, rosterSessionIds) {
  if (!Array.isArray(players) || !Array.isArray(rosterSessionIds)) return players;
  const liveIds = new Set(rosterSessionIds.filter((sessionId) => typeof sessionId === "string"));
  return players.filter((player) => liveIds.has(player.sessionId));
}
