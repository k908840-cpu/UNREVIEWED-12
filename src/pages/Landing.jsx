import React from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Star, ArrowRight, Sparkles } from "lucide-react";
import { PRESET_AVATARS } from "@/game/mockData";
import Avatar from "@/components/Avatar";
import Stamp from "@/components/Stamp";
import Scribble from "@/components/Scribble";
import { sfx } from "@/lib/sound";
import { useGame } from "@/game/GameContext";

// Review cards live in a dedicated side rail on desktop so they never
// collide with the headline, PLAY button, copy or avatar strip.
const REVIEWS = [
  { stars: 1, text: "He'd promote his SoundCloud at a funeral.", name: "SARAH", tone: "pink", rot: -6, pos: "top-0 left-0" },
  { stars: 5, text: "Do it again. But louder.", name: "KEV", tone: "green", rot: 5, pos: "top-[150px] left-[84px]" },
  { stars: 2, text: "Blames Mercury retrograde.", name: "MAYA", tone: "blue", rot: -3, pos: "top-[300px] left-0" },
  { stars: 4, text: "Suspiciously good at karaoke.", name: "DEV", tone: "yellow", rot: 4, pos: "top-[446px] left-[74px]" },
];

const TONE_BG = {
  pink: "bg-[hsl(var(--mode-adult))] text-cream",
  green: "bg-[hsl(var(--mode-family))] text-cream",
  blue: "bg-sky-500 text-white",
  yellow: "bg-primary text-primary-foreground",
};

export default function Landing() {
  const navigate = useNavigate();
  const { resumeOffer, resumeSavedRoom, leaveSavedRoom } = useGame();
  const [resumeBusy, setResumeBusy] = React.useState(false);
  const [resumeError, setResumeError] = React.useState("");
  const resumeChecking = resumeOffer?.status === "checking";
  const play = () => { sfx.reveal(); navigate("/create"); };

  const resume = async () => {
    if (resumeBusy) return;
    setResumeBusy(true); setResumeError("");
    const result = await resumeSavedRoom();
    setResumeBusy(false);
    if (!result?.ok && result?.error !== "resume_cancelled") {
      setResumeError(result?.stale ? "That room is no longer available." : "We couldn't reconnect yet. Check your connection and try again.");
    }
  };

  const leaveSaved = async () => {
    if (resumeBusy) return;
    setResumeBusy(true); setResumeError("");
    const result = await leaveSavedRoom();
    setResumeBusy(false);
    if (!result?.ok) setResumeError("We couldn't leave that room yet. You're still in it — please try again.");
  };

  return (
    <div className="app-page app-page--landing relative mx-auto flex max-w-6xl flex-col px-4 pt-5 text-[hsl(var(--ink))] sm:px-5 sm:pt-8">
      {/* decorative shapes — always behind content */}
      <motion.span
        initial={{ rotate: -20, scale: 0 }} animate={{ rotate: -12, scale: 1 }} transition={{ type: "spring", stiffness: 120, damping: 12 }}
        className="pointer-events-none absolute right-[1%] top-[9%] z-0 hidden text-primary lg:block"
      >
        <Star size={210} fill="currentColor" className="opacity-90" />
      </motion.span>
      <span className="pointer-events-none absolute bottom-5 left-[-3%] z-0 hidden h-36 w-36 rotate-12 bg-[hsl(var(--mode-adult))] lg:block" style={{ clipPath: "polygon(0 0, 100% 0, 100% 82%, 82% 100%, 0 100%)" }} />

      {/* masthead */}
      <div className="relative z-20 flex items-center justify-between">
        <div className="inline-flex items-center gap-2 rounded-full border-2 border-[hsl(var(--ink))] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-widest">
          <Sparkles size={13} className="text-primary" /> A party game for 4–8 so-called friends
        </div>
        <div className="hidden sm:block"><Stamp tone="ink" rotate={4}>Est. Tonight</Stamp></div>
      </div>

      {/* hero + review rail */}
      <div className="relative z-20 mt-10 grid items-start gap-10 md:mt-16 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* hero column */}
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="text-display text-[clamp(3rem,10vw,7rem)] leading-[0.82]"
          >
            <span className="text-primary">UN</span>REVIEWED
          </motion.h1>
          <div className="mt-2 flex items-center gap-3">
            <Scribble color="yellow" width={170} />
            <p className="font-heading text-sm font-bold uppercase tracking-widest text-[hsl(var(--mode-adult))]">Your friends have opinions. Unfortunately.</p>
          </div>

          {resumeOffer ? (
            <section className="mt-8 max-w-xl rounded-3xl border-4 border-[hsl(var(--ink))] bg-white p-5 shadow-[0_6px_0_0_hsl(var(--ink))] sm:p-6" aria-label="Saved game">
              <p className="font-heading text-xs font-bold uppercase tracking-widest text-[hsl(var(--mode-adult))]">Saved game found</p>
              <h2 className="mt-2 font-display text-3xl uppercase">
                {resumeChecking ? "Checking your saved game…" : resumeOffer.status === "unavailable" ? "Reconnect to your game?" : "Resume your game?"}
              </h2>
              <p className="mt-2 text-sm leading-relaxed opacity-70">
                {resumeChecking
                  ? "Verifying that this device is still in the saved room."
                  : resumeOffer.status === "unavailable"
                  ? "We couldn't verify the saved room yet. You can retry safely, or leave it before starting something new."
                  : `Room ${resumeOffer.code} is still ${resumeOffer.room?.status === "playing" ? "in progress" : "waiting in the lobby"}.`}
              </p>
              {resumeError && <p role="alert" className="mt-3 text-sm font-semibold text-[hsl(var(--mode-adult))]">{resumeError}</p>}
              {!resumeChecking && (
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={resume}
                    disabled={resumeBusy}
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border-4 border-[hsl(var(--ink))] bg-primary px-6 py-3.5 font-display text-xl uppercase text-primary-foreground shadow-[0_4px_0_0_hsl(var(--ink))] disabled:opacity-50"
                  >
                    {resumeBusy ? "Checking…" : resumeOffer.status === "unavailable" ? "Try Again" : "Resume Game"} <ArrowRight size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={leaveSaved}
                    disabled={resumeBusy}
                    className="flex-1 rounded-full border-2 border-[hsl(var(--ink))] bg-white px-6 py-3.5 font-display text-xl uppercase disabled:opacity-50"
                  >
                    Leave Room
                  </button>
                </div>
              )}
            </section>
          ) : (
            <div className="mt-8 flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <motion.button
                onClick={play}
                whileHover={{ scale: 1.04, rotate: -1 }} whileTap={{ scale: 0.97 }}
                className="group inline-flex items-center gap-3 rounded-full border-4 border-[hsl(var(--ink))] bg-primary px-12 py-5 font-display text-3xl uppercase tracking-wide text-primary-foreground shadow-[0_7px_0_0_hsl(var(--ink))]"
              >
                Play <ArrowRight size={28} className="transition-transform group-hover:translate-x-1" />
              </motion.button>
              <div className="max-w-xs">
                <p className="text-sm opacity-60">Write anonymous reviews. Rate the damage. Predict the winner.</p>
              </div>
            </div>
          )}

          {/* photo cutouts row */}
          <div className="mt-10 flex flex-wrap items-end gap-3">
            {[0, 3, 6, 9].map((idx, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 + i * 0.1 }} className="relative" style={{ transform: `rotate(${[-4, 3, -2, 5][i]}deg)` }}>
                <span className="absolute -top-2 left-1/2 z-10 h-4 w-10 -translate-x-1/2 rotate-2 bg-primary/50" />
                <div className="rounded-md border-4 border-[hsl(var(--ink))] bg-white p-1">
                  <Avatar player={{ nickname: "?", avatar: PRESET_AVATARS[idx] }} size={62} square />
                </div>
              </motion.div>
            ))}
            <p className="w-full font-heading text-xs font-bold uppercase tracking-wide opacity-60 sm:w-auto sm:max-w-[10rem] sm:ml-2">4–8 friends · 1 victim · ★★★★½</p>
          </div>
        </div>

        {/* taped review rail (desktop only) */}
        <div className="relative hidden min-h-[560px] lg:block">
          {REVIEWS.map((r, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20, rotate: r.rot * 2 }} animate={{ opacity: 1, y: 0, rotate: r.rot }} transition={{ delay: 0.5 + i * 0.12 }}
              className={`absolute w-52 p-3 shadow-[0_6px_0_0_hsl(var(--ink))] ${r.pos} ${TONE_BG[r.tone]}`}
              style={{ transform: `rotate(${r.rot}deg)` }}
            >
              <span className="absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 rotate-2 bg-white/50" />
              <div className="mb-1 flex gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={13} className={n <= r.stars ? "" : "opacity-30"} fill={n <= r.stars ? "currentColor" : "none"} />
                ))}
              </div>
              <p className="text-sm font-bold leading-snug">“{r.text}”</p>
              <p className="mt-1 text-[10px] uppercase tracking-wider opacity-70">— {r.name}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
