// Keeps a deliberate Leave Game action single-flight.  A failed request leaves
// local room state intact so a refresh or retry cannot silently abandon a
// participant who is still present on the authoritative backend.
export function createLeaveRoomCoordinator({ send, onSuccess = () => {} }) {
  let pending = null;

  const leave = () => {
    if (pending) return pending;

    const operation = (async () => {
      try {
        const result = await send();
        if (result?.error || result?.ok !== true) {
          return result?.error ? result : { error: "leave_failed", retryable: true };
        }
        onSuccess();
        return { ok: true };
      } catch (error) {
        return {
          error: error?.response?.data?.error || error?.message || "leave_failed",
          retryable: true,
        };
      }
    })();

    pending = operation.finally(() => {
      pending = null;
    });
    return pending;
  };

  return { leave, isPending: () => pending !== null };
}
