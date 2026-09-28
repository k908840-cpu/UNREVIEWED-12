import React, { useEffect } from "react";
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
    const track = ROUTE_TRACK[location.pathname] || "lobby";
    music.play(track);
    if (location.pathname === "/final") music.sting("winner");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return null;
}