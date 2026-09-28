import React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// Chunky animated rating bar (1–5 scale). Solid fill (no gradients).
export default function RatingBar({ value = 0, max = 5, animate = true, delay = 0, className, barClassName, showValue = true, height = 22 }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const fill = value >= 4.5 ? "bg-amber-300" : value >= 3.5 ? "bg-amber-400" : value >= 2.5 ? "bg-orange-500" : value >= 1.5 ? "bg-rose-500" : "bg-red-700";

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="relative flex-1 overflow-hidden rounded-full border-2 border-[hsl(var(--ink))] bg-[hsl(var(--paper))]" style={{ height }}>
        <motion.div
          className={cn("relative h-full rounded-full", fill, barClassName)}
          initial={animate ? { width: 0 } : false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.1, delay, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      {showValue && (
        <motion.span
          initial={animate ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: delay + 0.8, duration: 0.4 }}
          className="font-display text-lg tabular-nums w-16 text-right"
        >
          {value.toFixed(1)}<span className="text-primary"> ★</span>
        </motion.span>
      )}
    </div>
  );
}