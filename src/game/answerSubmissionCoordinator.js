// Serializes one player's single-response mutation and reconciles an ambiguous
// response before permitting another mutation. A timeout or 5xx is never
// treated as proof that the server rejected the submitted value.

export const RECONCILIATION_RETRY_DELAYS_MS = [2_000, 6_000];
const RECONCILIATION_JITTER_RATIO = 0.2;

const isRateLimited = (result) => /rate limit/i.test(String(result?.error || ""))
  || result?.status === 429;

const retryDelay = (base, random) => Math.round(base * (
  1 - RECONCILIATION_JITTER_RATIO / 2 + random() * RECONCILIATION_JITTER_RATIO
));

export function createAnswerSubmissionCoordinator({
  submit,
  reconcile,
  schedule = setTimeout,
  cancel = clearTimeout,
  now = () => Date.now(),
  random = Math.random,
  reconciliationRetryDelays = RECONCILIATION_RETRY_DELAYS_MS,
}) {
  let inFlight = false;
  let needsReconciliation = false;
  let confirmed = false;
  let lastPayload = null;
  let reconciliationTimer = null;
  let retryIndex = 0;
  let retryAt = 0;

  const clearRetry = () => {
    if (reconciliationTimer !== null) cancel(reconciliationTimer);
    reconciliationTimer = null;
    retryIndex = 0;
    retryAt = 0;
  };

  const retryPending = (error) => ({
    error: error || "submission_unconfirmed",
    retryable: true,
    ambiguous: true,
    retryAfterMs: Math.max(0, retryAt - now()),
  });

  const confirmOrReconcile = async () => {
    const state = await reconcile(lastPayload);
    if (state?.accepted) {
      confirmed = true;
      needsReconciliation = false;
      clearRetry();
      return { accepted: true, reconciled: true, acceptedPayload: lastPayload, room: state.room };
    }
    return state || { error: "reconcile_failed", ambiguous: true };
  };

  const reconcileAfterRateLimit = async () => {
    if (!needsReconciliation || inFlight || confirmed) return;
    inFlight = true;
    try {
      const reconciled = await confirmOrReconcile();
      if (reconciled.accepted) return;
      if (reconciled?.accepted === false) {
        needsReconciliation = false;
        clearRetry();
        return;
      }
      if (isRateLimited(reconciled)) scheduleReconciliation(reconciled.error);
    } finally {
      inFlight = false;
    }
  };

  const scheduleReconciliation = (error) => {
    if (reconciliationTimer !== null) return retryPending(error);
    const delayIndex = Math.min(retryIndex, Math.max(0, reconciliationRetryDelays.length - 1));
    const delay = retryDelay(reconciliationRetryDelays[delayIndex] || 0, random);
    retryAt = now() + delay;
    // Automatic reconciliation reads are deliberately bounded. Once the
    // budget is spent, a user may still retry after the same capped cooldown,
    // but the browser will not continue polling a saturated provider.
    if (retryIndex >= reconciliationRetryDelays.length) return retryPending(error);
    retryIndex += 1;
    reconciliationTimer = schedule(() => {
      reconciliationTimer = null;
      void reconcileAfterRateLimit();
    }, delay);
    return retryPending(error);
  };

  return {
    async submit(payload) {
      if (confirmed) return { accepted: true, alreadyConfirmed: true, acceptedPayload: lastPayload };
      if (inFlight) return { error: "submission_pending", retryable: false };
      if (reconciliationTimer !== null) return retryPending("submission_reconciliation_pending");
      if (needsReconciliation && retryAt > now()) return retryPending("submission_reconciliation_pending");

      inFlight = true;
      try {
        // Before retrying an uncertain request, ask the server whether its
        // answer was already accepted. This avoids a duplicate mutation after
        // a lost response.
        if (needsReconciliation) {
          const reconciled = await confirmOrReconcile();
          if (reconciled.accepted) return reconciled;
          if (reconciled?.accepted === false) {
            needsReconciliation = false;
            clearRetry();
          } else if (reconciled.error) {
            if (isRateLimited(reconciled)) scheduleReconciliation(reconciled.error);
            return reconciled.accepted
              ? reconciled
              : retryPending(reconciled.error);
          }
        }

        lastPayload = payload;
        const result = await submit(payload);
        if (result?.accepted) {
          confirmed = true;
          needsReconciliation = false;
          return { ...result, acceptedPayload: payload };
        }

        // All missing/failed acknowledgements are treated as ambiguous until
        // one authoritative roster read says otherwise.
        needsReconciliation = true;
        // A Base44 rate-limit response means the just-completed mutation might
        // have persisted, but an immediate getRoster would merely add another
        // request to the same saturated window. Schedule a bounded, read-only
        // reconciliation with backoff instead; never replay the mutation.
        if (isRateLimited(result)) {
          return scheduleReconciliation(result.error) || retryPending(result.error);
        }
        const reconciled = await confirmOrReconcile();
        if (reconciled.accepted) return reconciled;

        if (reconciled.error) {
          if (isRateLimited(reconciled)) scheduleReconciliation(reconciled.error);
          return {
            ...retryPending(result?.error || reconciled.error || "submission_unconfirmed"),
            retryAfterMs: retryAt ? Math.max(0, retryAt - now()) : undefined,
          };
        }

        needsReconciliation = false;
        clearRetry();
        return {
          error: result?.error || "submission_rejected",
          retryable: result?.retryable !== false,
          ambiguous: false,
        };
      } finally {
        inFlight = false;
      }
    },
    reset() {
      inFlight = false;
      needsReconciliation = false;
      confirmed = false;
      lastPayload = null;
      clearRetry();
    },
    getState: () => ({
      inFlight,
      needsReconciliation,
      confirmed,
      reconciliationScheduled: reconciliationTimer !== null,
      retryAt,
      retryIndex,
    }),
  };
}
