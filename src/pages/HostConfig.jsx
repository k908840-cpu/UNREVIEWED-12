import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Star, AlertTriangle, Check, Skull, Zap, Clock, Flame, Infinity as InfinityIcon } from "lucide-react";
import { useGame } from "@/game/GameContext";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";
import Stamp from "@/components/Stamp";
import Scribble from "@/components/Scribble";

const LENGTHS = [
  { id: "quick", label: "Quick", desc: "2 rounds each", cycles: "2", icon: Zap },
  { id: "standard", label: "Standard", desc: "4 rounds each", cycles: "4", icon: Clock, recommended: true },
  { id: "party", label: "Party", desc: "5 rounds each", cycles: "5", icon: Flame },
  { id: "endless", label: "Endless", desc: "Till somebody cries", cycles: "∞", icon: InfinityIcon },
];

export default function HostConfig() {
  const navigate = useNavigate();
  const { mode, setMode, length, setLength, goToProfile, persistConfig } = useGame();
  const [showAdultWarning, setShowAdultWarning] = useState(false);

  const pickMode = (m) => {
    if (m === "adult" && mode !== "adult") { setShowAdultWarning(true); return; }
    setMode(m); sfx.starSelect();
  };

  const confirmAdult = () => { setMode("adult"); setShowAdultWarning(false); sfx.reveal(); };

  const next = () => { sfx.lobby(); persistConfig(mode, length); goToProfile(); navigate("/profile"); };

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <button onClick={() => navigate("/create")} className="mb-5 inline-flex items-center gap-1.5 text-sm text-[hsl(var(--ink))]/60 hover:text-[hsl(var(--ink))]">
        <ArrowLeft size={16} /> Back
      </button>

      {/* PICK YOUR POISON */}
      <div className="text-center">
        <h1 className="text-display text-5xl sm:text-7xl">PICK YOUR POISON</h1>
        <div className="mt-1 flex justify-center"><Scribble color="yellow" width={220} /></div>
        <p className="mt-2 text-sm text-[hsl(var(--ink))]/60">Choose your content mode. Choose your fate.</p>
      </div>

      <div className="mt-7 grid gap-4 md:grid-cols-2">
        <ModePoster
          active={mode === "family"}
          onClick={() => pickMode("family")}
          title="FAMILY"
          subtitle="KEEP IT CLEAN(ISH)"
          tagline="Roasts, chaos & bad decisions."
          tone="family"
        />
        <ModePoster
          active={mode === "adult"}
          onClick={() => pickMode("adult")}
          title="ADULTS ONLY"
          subtitle="ABSOLUTELY NOT CLEAN"
          tagline="Dark. Filthy. Questionable."
          tone="adult"
        />
      </div>

      {/* LENGTH */}
      <div className="mt-10 text-center">
        <h2 className="text-display text-3xl sm:text-4xl">SET THE DAMAGE</h2>
        <p className="mt-1 text-sm text-[hsl(var(--ink))]/60">How long can your friendship survive?</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {LENGTHS.map((l, i) => (
          <LengthTicket
            key={l.id}
            l={l}
            active={length === l.id}
            onClick={() => { setLength(l.id); sfx.tap(); }}
            rotate={i % 2 === 0 ? -1.5 : 1.5}
          />
        ))}
      </div>

      <div className="mt-10 text-center">
        <motion.button
          onClick={next}
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-9 py-4 font-display text-2xl uppercase tracking-wide text-primary-foreground shadow-[0_6px_0_0_hsl(250_20%_9%)]"
        >
          Let's go <ArrowRight size={22} />
        </motion.button>
      </div>

      {/* adult warning modal */}
      <AnimatePresence>
        {showAdultWarning && (
          <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div
              initial={{ scale: 0.9, y: 20, rotate: -2 }} animate={{ scale: 1, y: 0, rotate: 0 }} exit={{ scale: 0.9, y: 20 }}
              className="paper-grain relative w-full max-w-md rounded-3xl border-4 border-[hsl(var(--mode-adult))] bg-cream p-7 text-[hsl(var(--cream-foreground))]"
            >
              <div className="absolute -top-3 left-0 right-0 h-3 hazard-tape" />
              <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--mode-adult))] text-white"><AlertTriangle size={28} /></div>
              <h3 className="font-display text-3xl uppercase">Adults Only</h3>
              <p className="mt-3 text-sm">
                Dark, sexual, morbid and morally questionable comedy intended for adults. Not for everyone — and definitely not for anyone who can't take a joke.
              </p>
              <div className="mt-6 flex gap-3">
                <button onClick={() => setShowAdultWarning(false)} className="flex-1 rounded-full border-2 border-[hsl(var(--ink))] py-3 font-semibold">Cancel</button>
                <button onClick={confirmAdult} className="flex-1 rounded-full bg-[hsl(var(--mode-adult))] py-3 font-bold text-white">I'm 18+</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModePoster({ active, onClick, title, subtitle, tagline, tone }) {
  const isAdult = tone === "adult";
  const surface = active
    ? (isAdult ? "bg-[hsl(var(--mode-adult))]" : "bg-[hsl(var(--mode-family))]")
    : (isAdult ? "bg-background" : "bg-cream");
  const titleColor = active ? "text-cream" : isAdult ? "text-[hsl(var(--mode-adult))]" : "text-[hsl(var(--mode-family))]";
  const subColor = active ? "text-cream/90" : isAdult ? "text-cream" : "text-[hsl(var(--ink))]";
  const tagColor = active ? "text-cream/80" : isAdult ? "text-cream/70" : "text-[hsl(var(--ink))]/70";
  const hintColor = isAdult ? "text-cream/50" : "text-[hsl(var(--ink))]/50";

  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02, rotate: isAdult ? 0.6 : -0.6 }}
      whileTap={{ scale: 0.98 }}
      animate={active ? { scale: 1.03 } : { scale: 1 }}
      className={cn(
        "paper-grain relative overflow-hidden rounded-[1.75rem] border-4 p-6 text-left transition-colors",
        isAdult ? "border-[hsl(var(--mode-adult))]" : "border-[hsl(var(--mode-family))]",
        surface
      )}
    >
      <span className="pointer-events-none absolute -right-3 -bottom-6 font-display text-[7rem] leading-none opacity-10">{isAdult ? "18" : "★"}</span>
      {isAdult && <div className="absolute top-0 left-0 right-0 h-2.5 hazard-tape opacity-80" />}

      <div className="relative flex items-start justify-between">
        <span className={cn("grid h-12 w-12 place-items-center rounded-full border-2", isAdult ? (active ? "border-cream bg-black text-cream" : "border-[hsl(var(--mode-adult))] bg-black text-[hsl(var(--mode-adult))]") : (active ? "border-cream bg-white text-primary" : "border-[hsl(var(--mode-family))] bg-white text-[hsl(var(--mode-family))]"))}>
          {isAdult ? <Skull size={24} /> : <Star size={24} fill="currentColor" />}
        </span>
        {active && <Stamp tone="cream" rotate={-10} press>Picked</Stamp>}
      </div>

      <h3 className={cn("relative mt-5 font-display text-5xl uppercase leading-[0.9] sm:text-6xl", titleColor)}>{title}</h3>
      <p className={cn("relative mt-1 font-display text-lg uppercase tracking-wide", subColor)}>{subtitle}</p>
      <p className={cn("relative mt-3 text-sm", tagColor)}>“{tagline}”</p>

      {!active && (
        <div className={cn("relative mt-5 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest", hintColor)}>
          <Check size={13} /> Tap to choose
        </div>
      )}
    </motion.button>
  );
}

function LengthTicket({ l, active, onClick, rotate }) {
  const Icon = l.icon;
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.04, rotate: 0 }}
      whileTap={{ scale: 0.96 }}
      animate={{ rotate }}
      className={cn(
        "paper-grain relative overflow-visible rounded-2xl border-4 p-4 text-left transition-colors",
        active ? "border-[hsl(var(--ink))] bg-primary text-primary-foreground" : "border-[hsl(var(--ink))] bg-cream text-[hsl(var(--cream-foreground))]"
      )}
    >
      {l.recommended && (
        <span className="absolute -right-1 -top-2 z-10" style={{ transform: "rotate(8deg)" }}>
          <Stamp tone={active ? "cream" : "red"} rotate={8}>Top pick</Stamp>
        </span>
      )}
      <Icon size={22} className={active ? "text-primary-foreground" : "text-[hsl(var(--mode-family))]"} />
      <div className="mt-2 font-display text-3xl uppercase leading-none">{l.label}</div>
      <div className="mt-1 font-display text-2xl tabular-nums opacity-80">{l.cycles}<span className="ml-1 text-xs lowercase">×each</span></div>
      <div className="mt-1 text-[11px] leading-tight opacity-70">{l.desc}</div>
    </motion.button>
  );
}