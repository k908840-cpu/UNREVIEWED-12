import React, { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Star, ArrowRight, Trophy, Medal, Target } from "lucide-react";
import { useGame } from "@/game/GameContext";
import { REACTION_LINES } from "@/game/mockData";
import Avatar from "@/components/Avatar";
import RatingBar from "@/components/RatingBar";
import Stamp from "@/components/Stamp";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function getReaction(item, isTop) {
  if (isTop) return item.avg >= 4.8 ? pick(REACTION_LINES.perfect) : pick(REACTION_LINES.midRound);
  if (item.avg <= 1.2) return pick(REACTION_LINES.veryLow);
  if (item.avg <= 1.05) return pick(REACTION_LINES.oneStar);
  return null;
}
function getPredictionLine(predictedTop, subject) {
  if (!subject) return null;
  if (predictedTop) return { tone: "good", text: `${subject.nickname} called it!`, sub: "+1 POINT", reaction: pick(REACTION_LINES.predictedCorrect) };
  return { tone: "bad", text: `${subject.nickname} was wrong.`, sub: "No bonus point.", reaction: pick(REACTION_LINES.predictedWrong).replace("{subject}", subject.nickname) };
}

export default function RoundResults() {
  const navigate = useNavigate();
  const { roundResult, players, advance } = useGame();
  const [step, setStep] = useState(0);

  const ordered = useMemo(() => roundResult ? [...roundResult.ranked].reverse() : [], [roundResult]);
  const n = ordered.length;
  const totalSteps = 1 + n * 2 + 1;
  const subject = players.find((p) => p.id === roundResult?.subjectId);

  useEffect(() => {
    if (!roundResult || step >= totalSteps) return;
    const isIntro = step === 0;
    const isBar = step >= 1 && step < 1 + n * 2 && (step - 1) % 2 === 0;
    const isAuthor = step >= 1 && step < 1 + n * 2 && (step - 1) % 2 === 1;
    const isTopAuthor = isAuthor && ordered[(step - 1) / 2]?.place === 1;
    const isPrediction = step === 1 + n * 2;
    const dur = isIntro ? 1600 : isTopAuthor ? 2600 : isBar ? 1700 : isPrediction ? 2000 : 1200;
    if (isIntro) sfx.whoosh();
    if (isBar) sfx.barRise();
    if (isAuthor && !isTopAuthor) { sfx.second(); sfx.scoreLand(); }
    if (isTopAuthor) sfx.winner();
    if (isPrediction) { roundResult.predictedTop ? sfx.correct() : sfx.wrong(); }
    const t = setTimeout(() => setStep((s) => s + 1), dur);
    return () => clearTimeout(t);
  }, [step, roundResult, n, totalSteps, ordered]);

  if (!roundResult) {
    return <div className="grid min-h-screen place-items-center px-5 text-center text-[hsl(var(--ink))]">
      <button onClick={() => advance({ force: true })} className="rounded-full border-4 border-[hsl(var(--ink))] bg-primary px-6 py-3 font-display uppercase text-primary-foreground">Continue →</button>
    </div>;
  }

  const showPrediction = step >= 1 + n * 2;
  const predLine = getPredictionLine(roundResult.predictedTop, subject);

  return (
    <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-8 text-[hsl(var(--ink))]">
      <AnimatePresence>
        {step === 0 && (
          <motion.div key="intro" exit={{ opacity: 0, scale: 1.1 }} className="absolute inset-0 grid place-items-center">
            <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 14 }} className="relative text-center">
              <div className="flex justify-center"><Stamp tone="yellow" rotate={-4}>Verdict</Stamp></div>
              <p className="mt-4 font-heading text-sm font-bold uppercase tracking-[0.4em] opacity-60">The Reviews Are In</p>
              <div className="mt-4 flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <motion.span key={i} initial={{ rotate: -90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} transition={{ delay: i * 0.08, type: "spring", stiffness: 260 }}>
                    <Star size={36} className="text-primary" fill="currentColor" />
                  </motion.span>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {step > 0 && step < 1 + n * 2 && (
        <div className="flex flex-1 flex-col justify-center">
          <RevealList ordered={ordered} step={step} players={players} />
        </div>
      )}

      <AnimatePresence>
        {showPrediction && (
          <motion.div key="pred" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="flex flex-1 flex-col justify-center rounded-3xl border-4 border-[hsl(var(--ink))] bg-white p-8 text-center shadow-[0_6px_0_0_hsl(var(--ink))]">
            {predLine && (
              <>
                <div className="flex justify-center"><Stamp tone={roundResult.predictedTop ? "green" : "red"} rotate={-4}>{roundResult.predictedTop ? "Nailed it" : "Wrong call"}</Stamp></div>
                <motion.h2 initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 14 }} className="mt-4 text-display text-4xl leading-tight sm:text-5xl">{predLine.text}</motion.h2>
                {roundResult.predictedTop ? (
                  <motion.p initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ delay: 0.3, type: "spring", stiffness: 240 }} className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 font-display text-xl uppercase text-primary-foreground">
                    <Target size={20} /> {predLine.sub}
                  </motion.p>
                ) : (
                  <p className="mt-4 font-display text-2xl uppercase text-[hsl(var(--mode-adult))]">{predLine.sub}</p>
                )}
                <p className="mt-4 text-lg italic opacity-70">“{predLine.reaction}”</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {step >= totalSteps && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="pb-4 text-center">
            <button onClick={() => advance({ force: true })} className="inline-flex items-center gap-2 rounded-full border-4 border-[hsl(var(--ink))] bg-primary px-8 py-4 font-display text-2xl uppercase tracking-wide text-primary-foreground shadow-[0_6px_0_0_hsl(var(--ink))]">
              Leaderboard <ArrowRight size={22} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {step > 0 && step < totalSteps && (
        <button onClick={() => setStep((s) => s + 1)} className="absolute bottom-5 right-5 text-xs opacity-50 hover:opacity-100">tap to skip →</button>
      )}
    </div>
  );
}

function RevealList({ ordered, step, players }) {
  return (
    <div className="space-y-5">
      {ordered.map((item, i) => {
        const barStep = 1 + i * 2;
        const authorStep = barStep + 1;
        const showBar = step >= barStep;
        const showAuthor = step >= authorStep;
        const rank = ordered.length - i;
        const isTop = rank === 1;
        const isSecond = rank === 2;
        const author = players.find((p) => p.id === item.playerId);
        const reaction = getReaction(item, isTop);
        if (!showBar) return null;

        const cardTone = isTop
          ? "border-primary bg-background text-foreground"
          : isSecond ? "border-[hsl(var(--ink))] bg-[hsl(var(--mode-adult))] text-cream"
          : rank === 3 ? "border-[hsl(var(--ink))] bg-[hsl(var(--mode-family))] text-cream"
          : "border-[hsl(var(--ink))] bg-white text-[hsl(var(--ink))]";

        return (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 24, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: isTop ? 0 : -0.6 }}
            className={cn("paper-grain relative overflow-visible rounded-3xl border-4 p-5 shadow-[0_6px_0_0_hsl(var(--ink))]", cardTone)}
          >
            <span className="pointer-events-none absolute -right-2 -top-6 select-none font-display text-7xl leading-none opacity-20">#{rank}</span>

            {isTop && showAuthor && (
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {[...Array(10)].map((_, k) => (
                  <motion.span key={k} className="absolute left-1/2 top-1/2 text-primary"
                    initial={{ scale: 0, x: 0, y: 0, opacity: 1 }}
                    animate={{ scale: 1, x: Math.cos((k / 10) * Math.PI * 2) * 160, y: Math.sin((k / 10) * Math.PI * 2) * 120, opacity: 0 }}
                    transition={{ duration: 1, ease: "easeOut" }}>
                    <Star size={22} fill="currentColor" />
                  </motion.span>
                ))}
              </div>
            )}

            <p className="relative text-balance text-center text-xl font-semibold leading-snug sm:text-2xl">“{item.text}”</p>

            <div className="relative mt-4"><RatingBar value={item.avg} delay={0.1} height={26} /></div>

            <AnimatePresence>
              {showAuthor && (
                <motion.div initial={{ opacity: 0, y: 14, height: 0 }} animate={{ opacity: 1, y: 0, height: "auto" }} className="overflow-visible">
                  <div className="relative mt-5 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                    <div className="-mt-12"><Avatar player={author} size={72} ring={isTop} /></div>
                    <div className="text-center sm:text-left">
                      <p className="text-[10px] uppercase tracking-widest opacity-60">Written by</p>
                      <p className="font-display text-2xl uppercase leading-none">{author?.nickname}</p>
                    </div>
                    {isTop && (
                      <motion.span initial={{ scale: 0, rotate: -12 }} animate={{ scale: 1, rotate: -8 }} transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.2 }} className="ml-0 sm:ml-2">
                        <Stamp tone="yellow" rotate={-8}><Trophy size={16} className="inline" /> +2</Stamp>
                      </motion.span>
                    )}
                    {isSecond && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 12, delay: 0.2 }} className="ml-0 sm:ml-2">
                        <Stamp tone="ink" rotate={4}><Medal size={16} className="inline" /> +1</Stamp>
                      </motion.span>
                    )}
                  </div>
                  {reaction && <p className="mt-3 text-center text-sm italic opacity-70">“{reaction}”</p>}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}