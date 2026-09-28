import React from "react";
import { cn } from "@/lib/utils";

// Rotated rubber-stamp label. tone: yellow | green | red | ink | cream
const TONES = {
  yellow: "border-primary text-primary",
  green: "border-[hsl(var(--mode-family))] text-[hsl(var(--mode-family-bright))]",
  pink: "border-[hsl(var(--mode-adult))] bg-[hsl(var(--mode-adult))] text-cream",
  red: "border-[hsl(var(--mode-adult))] text-[hsl(var(--mode-adult))]",
  ink: "border-[hsl(var(--ink))] text-[hsl(var(--ink))]",
  cream: "border-cream text-cream",
};

// A rubber-stamp: double border, uppercase display, slight rotation + ink texture.
export default function Stamp({ children, tone = "yellow", rotate = -8, className, press = false }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border-[3px] px-3 py-1 font-display text-base uppercase tracking-wide",
        TONES[tone] || TONES.yellow,
        press && "anim-stamp"
      )}
      style={{ "--stamp-rot": `${rotate}deg`, transform: `rotate(${rotate}deg)` }}
    >
      {children}
    </span>
  );
}