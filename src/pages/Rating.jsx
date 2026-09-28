import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Eye, SkipForward, Lock } from "lucide-react";
import { useGame } from "@/game/GameContext";
import StarRating from "@/components/StarRating";
import Timer from "@/components/Timer";
import Stamp from "@/components/Stamp";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

const RATE_SECONDS = 10;

export default function Rating() {
  const { currentSubjectId, players, currentPrompt, answers, ratingIndex, submitRating, isHost, phaseDeadline, phaseDuration, advance, myRating, ratedCount } = useGame();

  const current = answers[ratingIndex];
  const subject = players.find((p) => p.id === currentSubjectId);
  const you = players.find((p) => p.isYou);
  const isSubject = you?.id === currentSubjectId;
  const isAuthor = current?.playerId === you?.id;
  const youEligible = !isSubject && !isAuthor;

  const displayPrompt = (currentPrompt?.text || "").replace(/\[NAME\]/g, subject?.nickname || "[NAME]");
  const activeCount = players.filter((p) => p.connected).length;
  const eligibleCount = Math.max(0, activeCount - 2); // minus subject and author

  const onUserRate = (stars) => {
    if (!youEligible || myRating > 0 || !current) return;
    submitRating(current.id, stars);
    sfx.starSelect();
  };

  const onExpire = () => advance();

  if (!current) {
    return <div className="grid min-h-screen place-items-center text-[hsl(var(--ink))]"><button onClick={onExpire} className="rounded-full border-4 border-[hsl(var(--ink))] bg-primary px-6 py-3 font-display uppercase text-primary-foreground">Continue →</button></div>;
  }

  return (
    <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-6 text-[hsl(var(--ink))]">
      <div className="flex items-center justify-center gap-1.5">
        {answers.map((_, i) => (
          <span key={i} className={cn("h-2 rounded-full transition-all", i === ratingIndex ? "w-8 bg-primary" : i < ratingIndex ? "w-4 bg-primary/40" : "w-4 bg-[hsl(var(--ink))]/15")} />
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="font-heading text-xs font-bold uppercase tracking-widest opacity-60">Answer {ratingIndex + 1} of {answers.length}</span>
        <Timer seconds={phaseDuration || RATE_SECONDS} deadline={phaseDeadline} onExpire={onExpire} size={52} />
      </div>

      <div className="mt-4 rounded-full border-2 border-[hsl(var(--ink))] bg-white px-4 py-2 text-center">
        <p className="text-display text-base leading-tight sm:text-lg">{displayPrompt}</p>
      </div>

      <motion.div
        key={current.id}
        initial={{ opacity: 0, y: 24, scale: 0.97, rotate: 1 }} animate={{ opacity: 1, y: 0, scale: 1, rotate: -0.8 }}
        className="paper-grain relative mt-5 rounded-3xl border-4 border-[hsl(var(--ink))] bg-white p-6 text-center shadow-[0_6px_0_0_hsl(var(--ink))]"
      >
        <span className="absolute -top-2 left-1/2 h-4 w-14 -translate-x-1/2 rotate-2 bg-[hsl(var(--mode-adult))]/50" />
        <div className="absolute -top-3 right-5" style={{ transform: "rotate(7deg)" }}><Stamp tone="ink" rotate={7}>Anonymous</Stamp></div>
        <p className="text-balance text-2xl font-semibold leading-snug sm:text-3xl">“{current.text}”</p>
        <p className="mt-3 text-[10px] uppercase tracking-[0.3em] opacity-50">— author hidden —</p>
      </motion.div>

      {youEligible ? (
        <div className="mt-7 flex flex-col items-center">
          <p className="mb-4 font-heading text-sm font-bold uppercase tracking-widest opacity-60">Rate this answer</p>
          <StarRating value={myRating} onChange={onUserRate} size={72} />
          <RatedPill done={ratedCount} total={eligibleCount} />
          <p className="mt-4 text-center text-sm opacity-60">{myRating ? "Locked in. Waiting on the others…" : "Tap a star. Don't overthink it."}</p>
        </div>
      ) : (
        <div className="mt-7 flex flex-1 flex-col items-center justify-center text-center">
          <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid h-20 w-20 place-items-center rounded-full border-4 border-[hsl(var(--ink))] bg-white">
            <Eye size={34} className="opacity-50" />
          </motion.div>
          <h2 className="mt-4 font-display text-2xl uppercase">{isSubject ? "You're the Subject" : "You wrote this one"}</h2>
          <p className="mt-2 max-w-xs opacity-60">{isSubject ? "Sit back — the group is rating. You'll predict the winner next." : "No rating your own answer. Watch the verdict instead."}</p>
          <RatedPill done={ratedCount} total={eligibleCount} />
          {isHost && <button onClick={onExpire} className="mt-6 inline-flex items-center gap-1.5 text-xs opacity-60 hover:opacity-100"><SkipForward size={13} /> Skip</button>}
        </div>
      )}
    </div>
  );
}

function RatedPill({ done, total }) {
  return (
    <div className="mt-5 inline-flex items-center gap-2 rounded-full border-2 border-[hsl(var(--ink))] bg-white px-3 py-1.5 text-xs">
      <Lock size={12} className="text-primary" />
      {done}/{total} ratings in
    </div>
  );
}