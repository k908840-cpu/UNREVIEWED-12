import React, { useState } from "react";
import { Volume2, VolumeX, Volume1 } from "lucide-react";
import { useGame } from "@/game/GameContext";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

export default function VolumeControl({ compact = false }) {
  const { muted, toggleMute, volume, setVolume } = useGame();
  const [open, setOpen] = useState(false);

  const Icon = muted ? VolumeX : volume > 0.5 ? Volume2 : Volume1;

  return (
    <div className="relative">
      <button
        onClick={() => { toggleMute(); sfx.tap(); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={cn("grid place-items-center rounded-full border border-border bg-card/60 text-foreground transition hover:border-primary hover:text-primary", compact ? "h-9 w-9" : "h-10 w-10")}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        <Icon size={18} />
      </button>
      {open && !muted && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-2 w-36 rounded-xl border border-border bg-popover p-3 shadow-xl"
        >
          <input
            type="range" min={0} max={1} step={0.05} value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-full accent-[hsl(var(--primary))]"
          />
          <div className="mt-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground">Volume</div>
        </div>
      )}
    </div>
  );
}