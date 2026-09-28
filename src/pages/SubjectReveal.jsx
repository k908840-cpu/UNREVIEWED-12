import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star } from "lucide-react";
import { useGame } from "@/game/GameContext";
import Avatar from "@/components/Avatar";
import Stamp from "@/components/Stamp";
import Scribble from "@/components/Scribble";
import { sfx } from "@/lib/sound";

const RING = [
  { c: "text-primary", r: 0 },
  { c: "text-[hsl(var(--mode-adult))]", r: 45 },
  { c: "text-[hsl(var(--mode-family))]", r: 90 },
  { c: "text-sky-400", r: 135 },
  { c: "text-primary", r: 180 },
  { c: "text-[hsl(var(--mode-adult))]", r: 225 },
  { c: "text-[hsl(var(--mode-family))]", r: 270 },
  { c: "text-sky-400", r: 315 },
];

export default function SubjectReveal() {
  const { currentSubjectId, players, advance } = useGame();
  const [stage, setStage] = useState(0);
  const subject = players.find((p) => p.id === currentSubjectId);

  useEffect(() => {
    sfx.reveal();
    const t1 = setTimeout(() => setStage(1), 700);
    const t2 = setTimeout(() => { setStage(2); sfx.whoosh(); }, 1700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const next = () => { sfx.whoosh(); advance({ force: true }); };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-10">
      <span className="pointer-events-none absolute -left-10 top-10 select-none font-display text-[10rem] leading-none text-primary/[0.06]">★</span>
      <span className="pointer-events-none absolute -right-8 bottom-10 select-none font-display text-[12rem] leading-none text-[hsl(var(--mode-adult))]/[0.06]">5★</span>
      <span className="pointer-events-none absolute right-1/4 top-6 select-none font-display text-[6rem] leading-none text-[hsl(var(--mode-family))]/[0.05]">REVIEW</span>

      <div className="relative text-center">
        <motion.p
          initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          className="font-heading text-sm font-bold uppercase tracking-[0.4em] text-muted-foreground sm:text-base"
        >
          Tonight's Victim
        </motion.p>
        <div className="mt-1 flex justify-center"><Scribble color="yellow" width={180} /></div>

        <div className="relative mx-auto mt-8 grid place-items-center" style={{ minHeight: 300 }}>
          <AnimatePresence mode="wait">
            {stage >= 1 && subject && (
              <motion.div
                key="photo"
                initial={{ scale: 0.2, opacity: 0, rotate: -20 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 14 }}
                className="relative"
              >
                <motion.div
                  className="pointer-events-none absolute -inset-8"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
                >
                  {RING.map((s, i) => {
                    const rad = (s.r * Math.PI) / 180;
                    const radius = 150;
                    return (
                      <span key={i} className={`absolute left-1/2 top-1/2 ${s.c}`} style={{ transform: `translate(-50%,-50%) translate(${Math.cos(rad) * radius}px, ${Math.sin(rad) * radius}px)` }}>
                        <Star size={26} fill="currentColor" />
                      </span>
                    );
                  })}
                </motion.div>

                <div className="relative rounded-md border-4 border-[hsl(var(--ink))] bg-cream p-2">
                  <span className="absolute -top-3 left-1/2 h-5 w-16 -translate-x-1/2 rotate-[-4deg] bg-primary/50" />
                  <span className="absolute -top-2 right-2 h-4 w-10 rotate-[6deg] bg-[hsl(var(--mode-adult))]/50" />
                  <div className="rounded-full border-2 border-[hsl(var(--ink))]">
                    <Avatar player={subject} size={210} />
                  </div>
                </div>

                <div className="mt-3 flex justify-center"><Stamp tone="ink" rotate={-6}>Subject</Stamp></div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {stage >= 2 && subject && (
            <motion.div
              initial={{ opacity: 0, y: 30, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 16 }}
              className="mt-8"
            >
              <h1 className="text-display text-[clamp(3.5rem,14vw,9rem)] leading-none gold-text">{subject.nickname}</h1>
              <p className="mt-3 text-lg italic text-muted-foreground">Please review responsibly.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <motion.button
        onClick={next}
        initial={{ opacity: 0 }} animate={{ opacity: stage >= 2 ? 1 : 0 }}
        transition={{ delay: 0.6 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full border-2 border-[hsl(var(--ink))] bg-primary px-6 py-3 font-display text-lg uppercase tracking-wide text-primary-foreground shadow-[0_5px_0_0_hsl(var(--ink))] hover:scale-105"
      >
        Continue →
      </motion.button>
    </div>
  );
}