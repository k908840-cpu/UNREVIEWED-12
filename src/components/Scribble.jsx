import React from "react";
import { cn } from "@/lib/utils";

// Hand-drawn scribble underline accent. color: yellow | green | red | ink
const COLORS = {
  yellow: "stroke-primary",
  green: "stroke-[hsl(var(--mode-family-bright))]",
  red: "stroke-[hsl(var(--mode-adult))]",
  ink: "stroke-[hsl(var(--ink))]",
};

export default function Scribble({ color = "yellow", className, width = 160 }) {
  return (
    <svg
      viewBox="0 0 200 18"
      width={width}
      height={Math.max(14, width * 0.09)}
      fill="none"
      className={cn("overflow-visible", COLORS[color], className)}
      aria-hidden="true"
    >
      <path d="M4 12 C 30 4, 60 16, 92 9 S 150 4, 196 11" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}