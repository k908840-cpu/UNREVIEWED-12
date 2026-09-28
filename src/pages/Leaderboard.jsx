import React, { useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Crown } from "lucide-react";
import { useGame } from "@/game/GameContext";
import Avatar from "@/components/Avatar";
import Stamp from "@/components/Stamp";
import Scribble from "@/components/Scribble";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

const RANK_LABEL = [
  "bg-primary text-primary-foreground",
  "bg-[hsl(var(--mode-adult))] text-cream",
  "bg-[hsl(var(--mode-family))] text-cream",
  "bg-sky-500 text-white",
];

export default function Leaderboard() {
  const navigate = useNavigate();
  const { scores, players, roundIndex, totalRounds, advance, endGame, isHost } = useGame();

  useEffect(() => { sfx.lobby(); }, []);

  const ranked = useMemo(() => players.map((p) => ({ ...p, score: scores[p.id] || 0 })).sort((a, b) => b.score - a.score), [scores, players]);
  const isLast = roundIndex + 1 >= totalRounds;
  const maxScore = Math.max(1, ...ranked.map((r) => r.score));

  const next = () => { sfx.reveal(); advance({ force: true }); };
  const onEnd = async () => { sfx.tap(); await endGame(); navigate("/"); };

  return (
    <div className="relative mx-auto flex min-h-screen max-w-2xl flex-col px-5 py-8 text-[hsl(var(--ink))]">
      <span className="pointer-events-none absolute -top-4 left-1/2 -z-0 -translate-x-1/2 select-none font-display text-[8rem] leading-none opacity-[0.05]">RANK</span>

      <div className="relative text-center">
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] opacity-60">Standings</p>
        <h1 className="text-display text-5xl sm:text-6xl">LEADERBOARD</h1>
        <div className="mt-1 flex justify-center"><Scribble color="yellow" width={200} /></div>
      </div>

      <div className="relative mt-10 space-y-3">
        {ranked.map((p, i) => {
          const place = i + 1;
          const isFirst = place === 1;
          return (
            <motion.div
              key={p.id}
              layout
              initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08, type: "spring", stiffness: 200, damping: 20 }}
              className="paper-grain relative flex items-center gap-3 overflow-visible rounded-2xl border-4 border-[hsl(var(--ink))] bg-white p-3 shadow-[0_5px_0_0_hsl(var(--ink))]"
            >
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-lg", RANK_LABEL[Math.min(place - 1, 3)])}>{place}</span>

              <div className={cn("relative", isFirst && "-mt-6")}>
                <span className="absolute -top-2 left-1/2 z-10 h-4 w-9 -translate-x-1/2 rotate-2 bg-primary/50" />
                <Avatar player={p} size={isFirst ? 56 : 46} ring={isFirst} />
                {isFirst && (
                  <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.3 }} className="absolute -top-4 left-1/2 -translate-x-1/2 text-primary">
                    <Crown size={22} fill="currentColor" />
                  </motion.span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{p.nickname}</span>
                  {p.isYou && <span className="rounded bg-primary px-1 text-[9px] font-bold text-primary-foreground">YOU</span>}
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full border border-[hsl(var(--ink))]/30 bg-cream">
                  <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${(p.score / maxScore) * 100}%` }} transition={{ delay: 0.2 + i * 0.08, duration: 0.6 }} />
                </div>
              </div>

              <div className="text-right">
                <motion.span initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.08, type: "spring", stiffness: 240 }} className="font-display text-3xl tabular-nums leading-none">{p.score}</motion.span>
                <span className="ml-1 text-[10px] uppercase tracking-wider opacity-60">pts</span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-auto pt-8 text-center">
        <p className="mb-4 font-heading text-sm font-bold uppercase tracking-[0.3em] opacity-60">Next Victim…</p>
        <motion.button
          onClick={next}
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          className="inline-flex items-center gap-2 rounded-full border-4 border-[hsl(var(--ink))] bg-primary px-9 py-4 font-display text-2xl uppercase tracking-wide text-primary-foreground shadow-[0_6px_0_0_hsl(var(--ink))]"
        >
          {isLast ? "Final Results" : "Next Round"} <ArrowRight size={22} />
        </motion.button>
        {isHost && <div className="mt-4 flex justify-center"><button onClick={onEnd} className="text-xs uppercase tracking-wider opacity-50 hover:opacity-100">Host: End game now</button></div>}
      </div>
    </div>
  );
}