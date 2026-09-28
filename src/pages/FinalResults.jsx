import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, RotateCcw, Settings, DoorOpen, Star, Target, Flame, Skull, Frown } from "lucide-react";
import { useGame } from "@/game/GameContext";
import Avatar from "@/components/Avatar";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

export default function FinalResults() {
  const navigate = useNavigate();
  const { scores, players, history, mode, isHost, resetToLobby, endRoom } = useGame();
  const [stage, setStage] = useState(0);

  const ranked = useMemo(() => players.map((p) => ({ ...p, score: scores[p.id] || 0 })).sort((a, b) => b.score - a.score), [scores, players]);

  useEffect(() => { sfx.podium(); const t1 = setTimeout(() => setStage(1), 600); const t2 = setTimeout(() => setStage(2), 1800); const t3 = setTimeout(() => { setStage(3); sfx.winner(); }, 3000); const t4 = setTimeout(() => setStage(4), 5200); return () => [t1, t2, t3, t4].forEach(clearTimeout); }, []);

  const awards = useMemo(() => computeAwards(history, players, ranked, mode), [history, players, ranked, mode]);

  const third = ranked[2];
  const second = ranked[1];
  const first = ranked[0];

  const playAgain = async () => { sfx.reveal(); await resetToLobby(); navigate("/lobby"); };
  const changeMode = async () => { sfx.tap(); await resetToLobby(); navigate("/config"); };
  const newRoom = async () => { sfx.tap(); await endRoom(); navigate("/"); };

  return (
    <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-8">
      <div className="text-center">
        <p className="font-heading text-xs font-bold uppercase tracking-[0.3em] text-muted-foreground">Game Over</p>
        <h1 className="text-display text-5xl gold-text sm:text-7xl">FINAL RESULTS</h1>
      </div>

      <div className="mt-10 flex items-end justify-center gap-3 sm:gap-6">
        <PodiumColumn player={second} place={2} height="h-32" show={stage >= 2} delay={0} />
        <PodiumColumn player={first} place={1} height="h-44" show={stage >= 3} delay={0.1} big />
        <PodiumColumn player={third} place={3} height="h-24" show={stage >= 1} delay={0} />
      </div>

      <AnimatePresence>
        {stage >= 4 && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="mt-10 space-y-3">
            <h2 className="text-center font-heading text-sm font-bold uppercase tracking-[0.3em] text-muted-foreground">Awards</h2>
            {awards.map((a, i) => (
              <motion.div key={a.label} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.12 }} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5">
                <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", a.tone === "good" ? "bg-primary/15 text-primary" : a.tone === "bad" ? "bg-destructive/15 text-destructive" : "bg-secondary text-foreground")}>
                  <a.icon size={22} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-xs font-bold uppercase tracking-wider text-muted-foreground">{a.label}</p>
                  <p className="truncate font-display text-lg uppercase leading-tight">{a.headline}</p>
                  {a.sub && <p className="truncate text-sm text-muted-foreground">"{a.sub}"</p>}
                </div>
                {a.player && <Avatar player={a.player} size={40} ring={a.tone === "good"} />}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {stage >= 4 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-auto pt-8">
            {isHost ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <ActionBtn onClick={playAgain} icon={RotateCcw} label="Play Again" primary />
                <ActionBtn onClick={changeMode} icon={Settings} label="Change Mode" />
                <ActionBtn onClick={newRoom} icon={DoorOpen} label="New Room" />
              </div>
            ) : (
              <p className="text-center text-sm opacity-60">Waiting for the host to start a new game…</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PodiumColumn({ player, place, height, show, delay = 0, big = false }) {
  if (!player) return <div className="w-1/3" />;
  const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉";
  return (
    <div className="flex w-1/3 flex-col items-center">
      <AnimatePresence>
        {show && (
          <motion.div initial={{ opacity: 0, y: 40, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 14, delay }} className="flex flex-col items-center">
            <div className="text-3xl">{medal}</div>
            <div className={cn("relative mt-1 rounded-full border-2 p-1", place === 1 ? "border-primary" : "border-border")}>
              <Avatar player={player} size={big ? 96 : 64} ring={place === 1} />
              {place === 1 && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3, type: "spring", stiffness: 240 }} className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Trophy size={26} className="text-primary" fill="currentColor" />
                </motion.div>
              )}
            </div>
            <p className="mt-2 font-display text-lg uppercase leading-none sm:text-xl">{player.nickname}</p>
            <p className="font-display text-2xl text-primary tabular-nums">{player.score}<span className="ml-1 text-xs text-muted-foreground">pts</span></p>
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={show ? { height: "100%", opacity: 1 } : {}}
        transition={{ delay: delay + 0.2, duration: 0.5 }}
        className={cn("mt-2 w-full rounded-t-2xl border-x border-t border-border", place === 1 ? "bg-primary/15" : "bg-card", height)}
      />
    </div>
  );
}

function ActionBtn({ onClick, icon: Icon, label, primary }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center justify-center gap-2 rounded-full py-3.5 font-display text-lg uppercase tracking-wide transition", primary ? "bg-primary text-primary-foreground" : "border border-border bg-card text-foreground hover:border-primary")}>
      <Icon size={18} /> {label}
    </button>
  );
}

function computeAwards(history, players, ranked, mode) {
  const playerById = (id) => players.find((p) => p.id === id);
  const allAnswers = history.flatMap((r) => r.ranked.map((a) => ({ ...a, subjectId: r.subjectId })));

  const highest = allAnswers.slice().sort((a, b) => b.avg - a.avg)[0];
  const lowest = allAnswers.slice().sort((a, b) => a.avg - b.avg)[0];
  const predCount = {};
  history.forEach((r) => { if (r.predictedTop) predCount[r.subjectId] = (predCount[r.subjectId] || 0) + 1; });
  const bestPredId = Object.entries(predCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const fiveCount = {};
  allAnswers.forEach((a) => { fiveCount[a.playerId] = (fiveCount[a.playerId] || 0) + (a.c5 || 0); });
  const mostFiveId = Object.entries(fiveCount).sort((a, b) => b[1] - a[1])[0]?.[0];
  const winners = allAnswers.filter((a) => a.place === 1);
  const brutal = winners.slice().sort((a, b) => b.avg - a.avg)[0];

  const awards = [];
  awards.push({ label: "Overall Winner", icon: Trophy, tone: "good", headline: ranked[0]?.nickname || "—", sub: `${ranked[0]?.score || 0} points`, player: ranked[0] });
  if (highest) awards.push({ label: "Highest-Rated Answer", icon: Star, tone: "good", headline: `${highest.avg.toFixed(1)}★ by ${playerById(highest.playerId)?.nickname}`, sub: highest.text, player: playerById(highest.playerId) });
  if (bestPredId) awards.push({ label: "Best Predictor", icon: Target, tone: "good", headline: `${playerById(bestPredId)?.nickname}`, sub: `${predCount[bestPredId]} correct call${predCount[bestPredId] > 1 ? "s" : ""}`, player: playerById(bestPredId) });
  if (mostFiveId) awards.push({ label: "Most 5-Star Ratings", icon: Flame, tone: "good", headline: playerById(mostFiveId)?.nickname, sub: `${fiveCount[mostFiveId]} five-star reviews`, player: playerById(mostFiveId) });
  if (mode === "adult" && brutal) awards.push({ label: "Most Brutal Winning Answer", icon: Skull, tone: "bad", headline: `${brutal.avg.toFixed(1)}★ by ${playerById(brutal.playerId)?.nickname}`, sub: brutal.text, player: playerById(brutal.playerId) });
  if (lowest) awards.push({ label: "Lowest-Rated Answer", icon: Frown, tone: "bad", headline: `${lowest.avg.toFixed(1)}★ by ${playerById(lowest.playerId)?.nickname}`, sub: lowest.text, player: playerById(lowest.playerId) });
  return awards;
}