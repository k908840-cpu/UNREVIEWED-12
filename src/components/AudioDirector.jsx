import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { music } from "@/lib/sound";

// Maps the current screen to a musical intensity. Only switches when the
// track actually changes, so loops don't restart on every minor navigation.
const ROUTE_TRACK = {
  "/": "lobby",
  "/create": "lobby",
  "/config": "lobby",
  "/profile": "lobby",
  "/lobby": "lobby",
  "/leaderboard": "lobby",
  "/reveal": "prediction",
  "/write": "writing",
  "/rate": "rating",
  "/predict": "prediction",
  "/results": "results",
  "/final": "lobby",
};

export default function AudioDirector() {
  const location = useLocation();

  useEffect(() => {
    const pause = () => { void music.pause(); };
    const resume = () => { void music.resume(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") pause();
      else resume();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    // Capacitor emits these document events around Android lifecycle changes.
    document.addEventListener("pause", pause);
    document.addEventListener("resume", resume);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("pause", pause);
      document.removeEventListener("resume", resume);
      music.stop();
    };
  }, []);

  useEffect(() => {
    const track = ROUTE_TRACK[location.pathname] || "lobby";
    music.play(track);
    if (location.pathname === "/final") music.sting("winner");
  }, [location.pathname]);

  return null;
}
