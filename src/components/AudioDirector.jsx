import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { music } from "@/lib/sound";

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
    // The same licensed loop runs continuously across room and game routes;
    // route changes must never create or restart another audio element.
    void music.play();
  }, [location.pathname]);

  return null;
}
