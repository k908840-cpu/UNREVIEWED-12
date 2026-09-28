import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, Check, Eye } from "lucide-react";
import { useGame } from "@/game/GameContext";
import Avatar from "@/components/Avatar";
import Timer from "@/components/Timer";
import Stamp from "@/components/Stamp";
import Scribble from "@/components/Scribble";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

const PRED_SECONDS = 20;
const CARD_TONES = [
  "bg-primary text-primary-foreground",
  "bg-[hsl(var(--mode-adult))] text-cream",
  "bg-[hsl(var(--mode-family))] text-cream",
  "bg-sky-500 text-white",
];

export default function Prediction() {
  const { currentSubjectId, players, answers, submitPrediction, phaseDeadline, phaseDuration, advance } = useGame();
  const [selected, setSelected] = useState(null);
  const [locked, setLocked] = useState(false);
  const subject = players.find((p) => p.id === currentSubjectId);
  const you = players.find((p) => p.isYou);
  const isSubject = you?.id === currentSubjectId;

  useEffect(() => { sfx.whoosh(); }, []);

  const confirm = async () => {
    if (!selected || locked) return;
    setLocked(true);
    sfx.predictionLock();
    await submitPrediction(selected);
  };

  const onExpire = () => advance();

  if (!isSubject) {
    return (
      <div className="relative grid min-h-screen place-items-center px-5 text-center text-[hsl(var(--ink))]">
        <div className="relative">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mx-auto grid h-24 w-24 place-items-center rounded-full border-4 border-[hsl(var(--ink))] bg-white">
            <Eye size={40} />
          </motion.div>
          <div className="mt-5"><Stamp tone="yellow" rotate={-4}>Ratings locked</Stamp></div>
          <h1 className="mt-4 font-display text-4xl uppercase">{subject?.nickname} is picking</h1>
          <p className="mt-2 max-w-sm mx-auto opacity-60">They're guessing which answer won. No peeking at the scores.</p>
          {phaseDeadline && (
            <div className="mt-5 flex justify-center">
              <Timer seconds={phaseDuration || PRED_SECONDS} deadline={phaseDeadline} onExpire={onExpire} size={52} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-8 text-[hsl(var(--ink))]">
      <span className="pointer-events-none absolute -top-2 left-1/2 -z-0 -translate-x-1/2 select-none font-display text-[8rem] leading-none opacity-[0.05]">LOCKED</span>

      <div className="relative text-center">
        <div className="flex items-center justify-between">
          <div className="flex justify-center"><Stamp tone="yellow" rotate={-3}>Ratings locked</Stamp></div>
          {phaseDeadline && <Timer seconds={phaseDuration || PRED_SECONDS} deadline={phaseDeadline} onExpire={onExpire} size={48} />}
        </div>
        <h1 className="mt-4 text-display text-4xl leading-none sm:text-6xl">THE RATINGS ARE LOCKED.</h1>
        <div className="mt-1 flex items-center justify-center gap-3">
          <Avatar player={subject} size={44} ring />
          <p className="text-display text-2xl sm:text-3xl">{subject?.nickname},</p>
        </div>
        <p className="mt-1 text-display text-2xl sm:text-3xl">WHO DO YOU THINK WON?</p>
        <div className="mt-1 flex justify-center"><Scribble color="yellow" width={200} /></div>
        <p className="mt-2 text-xs opacity-60">No scores, no authors — just the words. Pick the one you think got rated highest.</p>
      </div>

      <div className="relative mt-6 flex-1 space-y-3">
        {answers.map((a, i) => {
          const isSel = selected === a.id;
          const tone = CARD_TONES[i % CARD_TONES.length];
          return (
            <motion.button
              key={a.id}
              initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
              disabled={locked}
              onClick={() => { if (!locked) { setSelected(a.id); sfx.starSelect(); } }}
              className={cn(
                "flex w-full items-center gap-3 rounded-2xl border-4 p-4 text-left shadow-[0_5px_0_0_hsl(var(--ink))] transition",
                isSel ? "border-[hsl(var(--ink))] ring-4 ring-primary" : "border-[hsl(var(--ink))]",
                locked && !isSel && "opacity-50",
                tone
              )}
              style={{ transform: `rotate(${i % 2 ? 0.6 : -0.6}deg)` }}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 border-[hsl(var(--ink))] bg-white font-display text-lg text-[hsl(var(--ink))]">{String.fromCharCode(65 + i)}</span>
              <span className="flex-1 text-lg font-semibold">“{a.text}”</span>
              <span className={cn("grid h-8 w-8 place-items-center rounded-full border-2 transition", isSel ? "border-[hsl(var(--ink))] bg-white text-[hsl(var(--ink))]" : "border-white/40 opacity-50")}>
                <Check size={16} />
              </span>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {selected && !locked && (
          <motion.button
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            onClick={confirm}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full border-4 border-[hsl(var(--ink))] bg-[hsl(var(--ink))] py-4 font-display text-xl uppercase tracking-wide text-cream shadow-[0_5px_0_0_hsl(var(--ink))]"
          >
            <Lock size={20} /> Lock it in
          </motion.button>
        )}
        {locked && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-6 grid place-items-center">
            <Stamp tone="green" rotate={-6} press>Locked in</Stamp>
            <p className="mt-3 text-sm opacity-60">No take-backs. Revealing the damage…</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}