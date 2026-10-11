// Serializes one writer's submission and reconciles an ambiguous response
// before permitting another mutation. A timeout or 5xx is never treated as
// proof that the server rejected the answer.

export function createAnswerSubmissionCoordinator({ submit, reconcile }) {
  let inFlight = false;
  let needsReconciliation = false;
  let confirmed = false;

  const confirmOrReconcile = async () => {
    const state = await reconcile();
    if (state?.accepted) {
      confirmed = true;
      needsReconciliation = false;
      return { accepted: true, reconciled: true, room: state.room };
    }
    return state || { error: "reconcile_failed", ambiguous: true };
  };

  return {
    async submit(text) {
      if (confirmed) return { accepted: true, alreadyConfirmed: true };
      if (inFlight) return { error: "submission_pending", retryable: false };

      inFlight = true;
      try {
        // Before retrying an uncertain request, ask the server whether its
        // answer was already accepted. This avoids a duplicate mutation after
        // a lost response.
        if (needsReconciliation) {
          const reconciled = await confirmOrReconcile();
          if (reconciled.accepted || reconciled.error) {
            return reconciled.accepted
              ? reconciled
              : { ...reconciled, retryable: true, ambiguous: true };
          }
          needsReconciliation = false;
        }

        const result = await submit(text);
        if (result?.accepted) {
          confirmed = true;
          needsReconciliation = false;
          return result;
        }

        // All missing/failed acknowledgements are treated as ambiguous until
        // one authoritative roster read says otherwise.
        needsReconciliation = true;
        const reconciled = await confirmOrReconcile();
        if (reconciled.accepted) return reconciled;

        if (reconciled.error) {
          return {
            error: result?.error || reconciled.error || "submission_unconfirmed",
            retryable: true,
            ambiguous: true,
          };
        }

        needsReconciliation = false;
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
    },
    getState: () => ({ inFlight, needsReconciliation, confirmed }),
  };
}
