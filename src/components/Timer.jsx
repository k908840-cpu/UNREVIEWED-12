import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { sfx, useAudioSettings } from "@/lib/sound";

// Countdown timer with ring + numeric readout. When `deadline` (ISO) is
// provided, counts down to that shared timestamp — so every client sees
// approximately the same remaining time. `seconds` is the total duration
// used for the ring percentage. Fires onExpire at 0.
export default function Timer({ seconds = 30, deadline, onExpire, running = true, accent = "primary", size = 64, strokeWidth = 6, showSeconds = true, className }) {
  const settings = useAudioSettings();
  const [remaining, setRemaining] = useState(deadline ? Math.max(0, Math.round((Date.parse(deadline) - Date.now()) / 1000)) : seconds);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!running) return;
    firedRef.current = false;

    if (deadline) {
      const update = () => {
        const rem = Math.max(0, Math.round((Date.parse(deadline) - Date.now()) / 1000));
        setRemaining(rem);
        if (rem <= 5 && rem > 0) sfx.tick(true);
        if (rem === 0 && !firedRef.current) { firedRef.current = true; sfx.countdownEnd(); onExpire?.(); }
      };
      update();
      const id = setInterval(update, 1000);
      return () => clearInterval(id);
    }

    setRemaining(seconds);
    const id = setInterval(() => {
      setRemaining((r) => {
        const next = Math.max(0, r - 1);
        if (next <= 5 && next > 0) sfx.tick(true);
        if (next === 0 && !firedRef.current) { firedRef.current = true; sfx.countdownEnd(); onExpire?.(); }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, onExpire, deadline, seconds]);

  if (!settings.showTimer) return null;

  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, remaining / Math.max(1, seconds)));
  const urgent = remaining <= 5;
  const color = accent === "mode" ? "hsl(var(--accent-mode))" : "hsl(var(--primary))";
  const reduced = settings.reducedMotion;

  return (
    <div className={cn("relative grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-secondary" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} strokeLinecap="round"
          stroke={color}
          strokeDasharray={circ}
          animate={{ strokeDashoffset: circ * (1 - pct) }}
          transition={{ duration: reduced ? 0 : 1, ease: "linear" }}
          style={{ filter: reduced ? "none" : `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <AnimatePresence mode="popLayout">
        <motion.span
          key={remaining}
          initial={reduced ? false : { y: 8, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { y: -8, opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.2 }}
          className={cn("absolute font-display tabular-nums", urgent ? "text-destructive" : "text-foreground")}
          style={{ fontSize: size * 0.34 }}
        >
          {showSeconds ? remaining : "•"}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}