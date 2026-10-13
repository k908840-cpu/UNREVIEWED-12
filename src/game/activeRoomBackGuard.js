// Capacitor's hardware Back button follows browser history. While a player is
// in a room, preserve the active route and ask for confirmation instead of
// letting an accidental Back press navigate away from the game.
export function installActiveRoomBackGuard({ windowObject = window, getProtectedPath, navigate, onLeaveIntent }) {
  const pushProtectedRoute = () => {
    const path = getProtectedPath();
    windowObject.history.pushState({ ...(windowObject.history.state || {}), unreviewedActiveRoom: true }, "", path);
  };

  pushProtectedRoute();
  const onPopState = () => {
    const path = getProtectedPath();
    pushProtectedRoute();
    navigate(path, { replace: true });
    onLeaveIntent();
  };
  windowObject.addEventListener("popstate", onPopState);
  return () => windowObject.removeEventListener("popstate", onPopState);
}
