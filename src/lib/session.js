// Temporary local identity for account-less players.
// The session id is the stable "who am I" handle for reconnects; the active
// room code lets a refresh drop the player straight back into their seat.
const SESSION_KEY = "unreviewed:session:v1";
const ROOM_KEY = "unreviewed:room:v1";
// A room that has been looked up but whose player has not joined yet. Keep it
// separate from ROOM_KEY: only a successful join establishes an active room.
const PENDING_ROOM_KEY = "unreviewed:pending-room:v1";

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); } catch {} }
function remove(k) { try { localStorage.removeItem(k); } catch {} }

export function getSessionId() {
  let id = read(SESSION_KEY);
  if (!id) {
    id = (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    write(SESSION_KEY, id);
  }
  return id;
}

export function getActiveRoomCode() { return read(ROOM_KEY); }
export function setActiveRoomCode(code) { if (code) write(ROOM_KEY, String(code).toUpperCase()); else remove(ROOM_KEY); }
export function clearActiveRoom() { remove(ROOM_KEY); }

export function getPendingRoomCode() { return read(PENDING_ROOM_KEY); }
export function setPendingRoomCode(code) { if (code) write(PENDING_ROOM_KEY, String(code).toUpperCase()); else remove(PENDING_ROOM_KEY); }
export function clearPendingRoomCode() { remove(PENDING_ROOM_KEY); }
