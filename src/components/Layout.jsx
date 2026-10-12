import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate, useOutlet } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Star, Settings as SettingsIcon, LogOut } from "lucide-react";
import { useGame } from "@/game/GameContext";
import ChatPanel from "./ChatPanel";
import VolumeControl from "./VolumeControl";
import AmbientBackdrop from "./AmbientBackdrop";
import AudioDirector from "./AudioDirector";
import SettingsPanel from "./SettingsPanel";
import { cn } from "@/lib/utils";
import { unlockAudio } from "@/lib/sound";
import QuitGameDialog from "./QuitGameDialog";

export default function Layout() {
  const { mode, roomCode, roundIndex, totalRounds, length } = useGame();
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quitOpen, setQuitOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const [displayedRoute, setDisplayedRoute] = useState(() => ({
    pathname: location.pathname,
    outlet,
  }));
  const [isExitingRoute, setIsExitingRoute] = useState(false);
  const pendingRouteRef = useRef(null);

  // Keep the current route element mounted for its entire exit animation.
  // The next element is held outside AnimatePresence until onExitComplete;
  // otherwise React Router can render it in the outgoing pathname-keyed
  // container and then mount it again in the incoming container.
  useEffect(() => {
    if (location.pathname === displayedRoute.pathname) return;
    pendingRouteRef.current = { pathname: location.pathname, outlet };
    setIsExitingRoute(true);
  }, [location.pathname, outlet, displayedRoute.pathname]);

  const showPendingRoute = () => {
    const pendingRoute = pendingRouteRef.current;
    if (!pendingRoute) return;
    pendingRouteRef.current = null;
    setDisplayedRoute(pendingRoute);
    setIsExitingRoute(false);
  };

  // apply mode theme class to root
  useEffect(() => {
    document.documentElement.classList.remove("mode-family", "mode-adult");
    document.documentElement.classList.add(mode === "adult" ? "mode-adult" : "mode-family");
  }, [mode]);

  useEffect(() => { unlockAudio(); }, []);

  const isLanding = location.pathname === "/";
  const showtime = location.pathname === "/reveal" || location.pathname === "/final";

  // contextual accent: yellow signature on landing, green for Family, hot pink/red for Adults Only
  const accent = isLanding
    ? "44 96% 56%"
    : mode === "adult" ? "342 88% 60%"
    : "142 66% 56%";
  const roundLabel = totalRounds > 0
    ? (length === "endless" ? `Round ${roundIndex + 1} · Endless` : `Round ${roundIndex + 1} of ${totalRounds}`)
    : "";
  const goHome = () => {
    if (roomCode) setQuitOpen(true);
    else navigate("/");
  };

  return (
    <div className={cn("relative min-h-screen overflow-hidden", showtime ? "bg-background text-foreground" : "bg-cream text-[hsl(var(--cream-foreground))]")} style={{ "--accent": accent }}>
      {/* ambient backdrop */}
      <AmbientBackdrop variant={showtime ? "show" : "paper"} />

      {/* top bar */}
      {!isLanding && (
        <header className="sticky top-0 z-30 flex items-center justify-between border-b-2 border-[hsl(var(--ink))] bg-background px-4 py-2.5">
          <button onClick={goHome} className="flex items-center gap-2" aria-label={roomCode ? "Leave game or stay in game" : "Go to home"}>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Star size={18} fill="currentColor" /></span>
            <span className="font-display text-xl leading-none tracking-wide">UNREVIEWED</span>
          </button>
          <div className="flex items-center gap-2 sm:gap-3">
            {roomCode && (
              <div className="hidden items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 sm:flex">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Room</span>
                <span className="font-mono text-sm font-bold tracking-widest text-primary">{roomCode}</span>
              </div>
            )}
            {roundLabel && (
              <span className="rounded-full border border-border bg-card/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-foreground">
                {roundLabel}
              </span>
            )}
            <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", mode === "adult" ? "bg-[hsl(var(--mode-adult))]/15 text-[hsl(var(--mode-adult))]" : "bg-[hsl(var(--mode-family))]/15 text-[hsl(var(--mode-family))]")}>
              {mode === "adult" ? "18+ Adults Only" : "Family"}
            </span>
            <VolumeControl compact />
            {roomCode && (
              <button onClick={() => setQuitOpen(true)} className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card/60 text-foreground transition hover:border-[hsl(var(--mode-adult))] hover:text-[hsl(var(--mode-adult))]" aria-label="Leave game" title="Leave game">
                <LogOut size={18} />
              </button>
            )}
            <button onClick={() => { setSettingsOpen(true); unlockAudio(); }} className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card/60 text-foreground transition hover:border-primary hover:text-primary" aria-label="Open settings">
              <SettingsIcon size={18} />
            </button>
            <button onClick={() => setChatOpen(true)} className="relative grid h-10 w-10 place-items-center rounded-full border border-border bg-card/60 text-foreground transition hover:border-primary hover:text-primary" aria-label="Open chat">
              <MessageCircle size={18} />
            </button>
          </div>
        </header>
      )}

      {/* page transitions */}
      <AnimatePresence mode="wait" onExitComplete={showPendingRoute}>
        {!isExitingRoute && (
          <motion.main
            key={displayedRoute.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            {displayedRoute.outlet}
          </motion.main>
        )}
      </AnimatePresence>

      <AudioDirector />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <QuitGameDialog open={quitOpen} onOpenChange={setQuitOpen} />
    </div>
  );
}
