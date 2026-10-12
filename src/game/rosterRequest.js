// Bounded, single-flight roster requests.
//
// The Base44 SDK's functions.invoke() sets no request timeout, so a roster
// request that never settles used to hold the in-flight guard forever and block
// every later refresh. This controller owns that guard:
//   - every request is raced against a timeout (the guard is always released),
//   - a late response from a timed-out or superseded request is never returned
//     to the caller, so it cannot overwrite newer roster data,
//   - invalidate() (leave/reset) drops the current request's ownership so its
//     eventual result or failure is ignored and cannot release a newer guard.

export const ROSTER_REQUEST_TIMEOUT_MS = 10000;

export class RosterRequestTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Roster request timed out after ${timeoutMs}ms`);
    this.name = "RosterRequestTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export const isRosterRequestTimeout = (err) => err?.name === "RosterRequestTimeoutError";

export function createRosterRequestController({
  request,
  timeoutMs = ROSTER_REQUEST_TIMEOUT_MS,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  let sequence = 0;
  let owner = 0;
  let inFlight = false;

  const bounded = (args) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimer(() => reject(new RosterRequestTimeoutError(timeoutMs)), timeoutMs);
    });
    // Promise.race subscribes to both promises, so a rejection of the abandoned
    // request after the timeout won cannot surface as an unhandled rejection.
    return Promise.race([Promise.resolve().then(() => request(...args)), timeout])
      .finally(() => clearTimer(timer));
  };

  return {
    isInFlight: () => inFlight,
    // Resolves { data } for the current request or { stale: true } if it was
    // invalidated while pending. Rejects (including RosterRequestTimeoutError)
    // only for the current request.
    async run(...args) {
      const mine = ++sequence;
      owner = mine;
      inFlight = true;
      try {
        const data = await bounded(args);
        return owner === mine ? { data } : { stale: true };
      } catch (error) {
        if (owner !== mine) return { stale: true };
        throw error;
      } finally {
        if (owner === mine) inFlight = false;
      }
    },
    // Release the guard and make any pending request's outcome irrelevant.
    invalidate() {
      owner = ++sequence;
      inFlight = false;
    },
  };
}
