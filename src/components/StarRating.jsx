import React, { useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

// Interactive 1–5 star rater (or readonly display).
export default function StarRating({ value = 0, onChange, size = 40, readonly = false, accent = "primary", className }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;

  const color = accent === "mode" ? "text-[hsl(var(--accent-mode))]" : "text-primary";

  return (
    <div className={cn("flex items-center gap-1", className)} role="group" aria-label="star rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= shown;
        return (
          <button
            key={n}
            type="button"
            disabled={readonly}
            onMouseEnter={() => { if (!readonly) { setHover(n); sfx.starHover(); } }}
            onMouseLeave={() => !readonly && setHover(0)}
            onClick={() => { if (!readonly) { onChange?.(n); sfx.starSelect(); } }}
            className={cn("transition-transform", !readonly && "hover:scale-110 active:scale-90", readonly && "cursor-default")}
            style={{ width: size, height: size }}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
          >
            <Star
              size={size}
              strokeWidth={active ? 0 : 2}
              className={cn("transition-colors", active ? color : "text-muted-foreground/40", active && "drop-shadow-[0_0_8px_hsl(var(--primary)/0.45)]")}
              fill={active ? "currentColor" : "none"}
            />
          </button>
        );
      })}
    </div>
  );
}