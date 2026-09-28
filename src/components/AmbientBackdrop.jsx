import React from "react";
import { Star } from "lucide-react";

// Sparse, very low-opacity oversized motifs so the canvas reads as
// designed + tactile, never competing with prompts/answers/controls.
const SHOW_MOTIFS = [
  { top: "7%", left: "5%", size: 130, rot: -12, op: 0.035 },
  { top: "68%", left: "86%", size: 190, rot: 14, op: 0.03 },
  { top: "38%", left: "91%", size: 78, rot: -8, op: 0.045 },
  { top: "83%", left: "11%", size: 96, rot: 6, op: 0.03 },
];

const PAPER_MOTIFS = [
  { top: "9%", left: "7%", size: 120, rot: -14, op: 0.06, color: "text-primary" },
  { top: "72%", left: "84%", size: 160, rot: 12, op: 0.05, color: "text-[hsl(var(--mode-adult))]" },
  { top: "34%", left: "90%", size: 70, rot: -8, op: 0.07, color: "text-sky-500" },
  { top: "80%", left: "9%", size: 90, rot: 6, op: 0.05, color: "text-[hsl(var(--mode-family))]" },
];

export default function AmbientBackdrop({ variant = "paper" }) {
  if (variant === "show") {
    return (
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-background">
        <div className="absolute inset-0 grain-noise opacity-[0.04]" />
        {SHOW_MOTIFS.map((m, i) => (
          <span key={i} className="absolute text-foreground" style={{ top: m.top, left: m.left, opacity: m.op, transform: `rotate(${m.rot}deg)` }}>
            <Star size={m.size} fill="currentColor" />
          </span>
        ))}
        <span className="absolute text-[hsl(var(--accent))]" style={{ top: "20%", right: "7%", opacity: 0.05, transform: "rotate(-6deg)" }}>
          <Star size={150} fill="currentColor" />
        </span>
        <span className="absolute -bottom-7 -left-6 select-none font-display text-[8rem] leading-none text-foreground opacity-[0.025] sm:text-[12rem]" style={{ transform: "rotate(-3deg)" }}>REVIEW</span>
        <span className="absolute -right-10 top-1/3 select-none font-display text-[10rem] leading-none text-foreground opacity-[0.02] sm:text-[16rem]" style={{ transform: "rotate(4deg)" }}>★</span>
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: "hsl(var(--accent))", opacity: 0.45 }} />
        <span className="absolute left-4 top-4 h-3 w-3 border-l border-t" style={{ borderColor: "hsl(var(--accent))", opacity: 0.35 }} />
        <span className="absolute right-4 top-4 h-3 w-3 border-r border-t" style={{ borderColor: "hsl(var(--accent))", opacity: 0.35 }} />
      </div>
    );
  }

  // paper / cream default
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-cream">
      <div className="absolute inset-0 grain-noise opacity-[0.05]" />
      {PAPER_MOTIFS.map((m, i) => (
        <span key={i} className={`absolute ${m.color}`} style={{ top: m.top, left: m.left, opacity: m.op, transform: `rotate(${m.rot}deg)` }}>
          <Star size={m.size} fill="currentColor" />
        </span>
      ))}
      <span className="absolute -bottom-7 -left-6 select-none font-display text-[8rem] leading-none text-[hsl(var(--ink))] opacity-[0.04] sm:text-[12rem]" style={{ transform: "rotate(-3deg)" }}>REVIEW</span>
      <span className="absolute -right-10 top-1/4 select-none font-display text-[10rem] leading-none text-[hsl(var(--ink))] opacity-[0.03] sm:text-[15rem]" style={{ transform: "rotate(4deg)" }}>★</span>
      <div className="absolute inset-x-0 top-0 h-px bg-[hsl(var(--ink))]/30" />
      <span className="absolute left-4 top-4 h-3 w-3 border-l border-t border-[hsl(var(--ink))]/40" />
      <span className="absolute right-4 top-4 h-3 w-3 border-r border-t border-[hsl(var(--ink))]/40" />
    </div>
  );
}