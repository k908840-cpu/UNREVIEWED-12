// Persists the host's chosen mode/length to the room and confirms the server
// stored exactly what was asked. Returns { ok: true, room } or { ok: false, error };
// it never throws and never reports success for an unconfirmed save, so callers
// can refuse to continue (a Family room must not silently start in place of an
// Adults room).
export const CONFIG_SAVE_ATTEMPTS = 2;
export const CONFIG_RETRY_DELAY_MS = 600;

const isTransient = (e) => {
  const status = Number(e?.response?.status);
  return !status || status === 429 || status >= 500;
};

export async function saveRoomConfig({
  invoke,
  code,
  sessionId,
  membershipCapability,
  mode,
  length,
  attempts = CONFIG_SAVE_ATTEMPTS,
  delayMs = CONFIG_RETRY_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (!code) return { ok: false, error: "no_room" };
  if (!membershipCapability) return { ok: false, error: "missing_membership_capability" };
  let lastError = "config_failed";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await invoke("room", {
        action: "config", code, sessionId, membership_capability: membershipCapability, mode, length,
      });
      const data = res?.data || {};
      if (data.error) {
        lastError = data.error;
        break; // an explicit server refusal (forbidden, in_progress, ...) will not change on retry
      }
      const saved = data.room;
      if (saved && saved.mode === mode && saved.length === length) return { ok: true, room: saved };
      lastError = "config_not_saved";
    } catch (e) {
      lastError = e?.response?.data?.error || "config_failed";
      if (!isTransient(e)) break;
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return { ok: false, error: lastError };
}
