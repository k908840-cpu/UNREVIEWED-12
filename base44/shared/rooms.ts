// Shared room helpers used by the room + cleanup backend functions.

export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 4;
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 4;
// A player counts as "active" if they checked in within this window.
export const RECONNECT_WINDOW_MS = 30000;
// Rooms with no activity for this long are swept away.
export const ROOM_TTL_MS = 6 * 60 * 60 * 1000;

export function normalizeCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);
}

export function makeCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < CODE_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function isActive(player, now = Date.now()) {
  if (!player) return false;
  const ts = Date.parse(player.last_seen || "") || 0;
  return now - ts < RECONNECT_WINDOW_MS;
}

export function activePlayers(players, now = Date.now()) {
  return (players || []).filter((p) => isActive(p, now));
}