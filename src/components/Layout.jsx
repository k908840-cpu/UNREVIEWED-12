import React, { useState, useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, Home, Star, Settings as SettingsIcon } from "lucide-react";
import { useGame } from "@/game/GameContext";
import ChatPanel from "./ChatPanel";
import VolumeControl from "./VolumeControl";
import AmbientBackdrop from "./AmbientBackdrop";
import AudioDirector from "./AudioDirector";
import SettingsPanel from "./SettingsPanel";
import { cn } from "@/lib/utils";
import { unlockAudio } from "@/lib/sound";

export default function Layout() {
  const { mode, roomCode, phase } = useGame();
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

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

  return (
    <div className={cn("relative min-h-screen overflow-hidden", showtime ? "bg-background text-foreground" : "bg-cream text-[hsl(var(--cream-foreground))]")} style={{ "--accent": accent }}>
      {/* ambient backdrop */}
      <AmbientBackdrop variant={showtime ? "show" : "paper"} />

      {/* top bar */}
      {!isLanding && (
        <header className="sticky top-0 z-30 flex items-center justify-between border-b-2 border-[hsl(var(--ink))] bg-background px-4 py-2.5">
          <button onClick={() => navigate("/")} className="flex items-center gap-2">
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
            <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider", mode === "adult" ? "bg-[hsl(var(--mode-adult))]/15 text-[hsl(var(--mode-adult))]" : "bg-[hsl(var(--mode-family))]/15 text-[hsl(var(--mode-family))]")}>
              {mode === "adult" ? "18+ Adults Only" : "Family"}
            </span>
            <VolumeControl compact />
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
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

      <AudioDirector />
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}