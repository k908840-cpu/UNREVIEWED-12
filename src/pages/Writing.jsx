import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, EyeOff, SkipForward, Star } from "lucide-react";
import { useGame } from "@/game/GameContext";
import Avatar from "@/components/Avatar";
import Timer from "@/components/Timer";
import Stamp from "@/components/Stamp";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

const WRITE_SECONDS = 30;

export default function Writing() {
  const { currentSubjectId, players, currentPrompt, submitAnswer, submittedCount, isHost, myAnswerId, phaseDeadline, phaseDuration, advance } = useGame();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const subject = players.find((p) => p.id === currentSubjectId);
  const you = players.find((p) => p.isYou);
  const isSubject = you?.id === currentSubjectId;

  const eligible = players.filter((p) => p.id !== currentSubjectId && p.connected);
  const submitted = !!myAnswerId;

  const displayPrompt = (currentPrompt?.text || "").replace(/\[NAME\]/g, subject?.nickname || "[NAME]");

  const submit = async () => {
    if (!text.trim() || submitted || submitting) return;
    setSubmitting(true);
    await submitAnswer(text);
    setSubmitting(false);
    setText("");
    sfx.submit();
  };

  const onExpire = () => advance();

  const totalSubs = Math.min(submittedCount, eligible.length);

  return (
    <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-6 text-[hsl(var(--ink))]">
      <span className="pointer-events-none absolute -top-4 left-1/2 -z-0 -translate-x-1/2 select-none font-display text-[8rem] leading-none opacity-[0.05]">REVIEW</span>

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Avatar player={subject} size={42} ring />
          <div>
            <p className="text-[10px] uppercase tracking-wider opacity-60">Tonight's victim</p>
            <p className="font-display text-lg leading-none">{subject?.nickname}</p>
          </div>
        </div>
        <Timer seconds={phaseDuration || WRITE_SECONDS} deadline={phaseDeadline} onExpire={onExpire} size={56} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16, rotate: -1.5 }} animate={{ opacity: 1, y: 0, rotate: -1.2 }}
        className="relative mt-6 rounded-3xl border-4 border-[hsl(var(--ink))] bg-primary p-6 text-center text-primary-foreground shadow-[0_6px_0_0_hsl(var(--ink))]"
      >
        <div className="absolute -top-3 left-5" style={{ transform: "rotate(-6deg)" }}><Stamp tone="ink" rotate={-6}>Prompt</Stamp></div>
        <p className="text-display text-2xl leading-tight sm:text-3xl">{displayPrompt}</p>
        <div className="mt-3 flex justify-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} fill="currentColor" />)}
        </div>
      </motion.div>

      {isSubject ? (
        <div className="relative mt-8 flex flex-1 flex-col items-center justify-center text-center">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid h-24 w-24 place-items-center rounded-full border-4 border-[hsl(var(--ink))] bg-white">
            <EyeOff size={40} className="opacity-50" />
          </motion.div>
          <h2 className="mt-5 font-display text-3xl uppercase">You're the Subject</h2>
          <p className="mt-2 max-w-sm opacity-70">Everyone else is writing about you right now. Sit tight — you'll predict the winner after everyone rates.</p>
          <div className="mt-6 w-full max-w-xs"><SubmissionProgress done={totalSubs} total={eligible.length} /></div>
          {isHost && <button onClick={onExpire} className="mt-6 inline-flex items-center gap-1.5 text-xs opacity-60 hover:opacity-100"><SkipForward size={13} /> Host: skip to rating</button>}
        </div>
      ) : (
        <div className="relative mt-6 flex flex-1 flex-col">
          <div className="relative flex-1">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 80))}
              disabled={submitted}
              autoFocus rows={3}
              placeholder="Write something funny…"
              className={cn("w-full resize-none rounded-2xl border-4 border-[hsl(var(--ink))] bg-white p-4 text-lg font-medium text-[hsl(var(--ink))] shadow-[0_5px_0_0_hsl(var(--ink))] outline-none transition focus:border-primary", submitted && "opacity-60")}
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <span className={cn("font-mono text-sm tabular-nums", text.length >= 70 ? "text-[hsl(var(--mode-adult))]" : "opacity-50")}>{text.length}/80</span>
            </div>
          </div>
          <p className="mt-2 text-center text-sm italic opacity-60">Keep it short. They're judging you.</p>

          <AnimatePresence>
            {submitted ? (
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 grid place-items-center rounded-2xl border-4 border-[hsl(var(--ink))] bg-[hsl(var(--mode-family))] py-4 text-cream">
                <p className="font-semibold">Submitted. Now we wait for the others…</p>
              </motion.div>
            ) : (
              <motion.button
                onClick={submit}
                disabled={!text.trim() || submitting}
                whileTap={{ scale: 0.97 }}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border-4 border-[hsl(var(--ink))] bg-primary py-4 font-display text-xl uppercase tracking-wide text-primary-foreground shadow-[0_5px_0_0_hsl(var(--ink))] disabled:opacity-40"
              >
                <Send size={20} /> {submitting ? "Submitting…" : "Submit"}
              </motion.button>
            )}
          </AnimatePresence>

          <div className="mt-5"><SubmissionProgress done={totalSubs} total={eligible.length} /></div>

          {isHost && (
            <button onClick={onExpire} className="mt-4 inline-flex items-center justify-center gap-1.5 text-xs opacity-60 hover:opacity-100">
              <SkipForward size={13} /> Host: skip to rating
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SubmissionProgress({ done, total }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs opacity-70">
        <span>Anonymous submissions</span>
        <span className="tabular-nums">{done}/{total}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border-2 border-[hsl(var(--ink))] bg-white">
        <motion.div className="h-full bg-primary" animate={{ width: `${(done / Math.max(1, total)) * 100}%` }} transition={{ ease: "easeOut" }} />
      </div>
    </div>
  );
}