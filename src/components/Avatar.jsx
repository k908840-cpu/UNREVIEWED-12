import React, { useState } from "react";
import { cn } from "@/lib/utils";

// Avatar: photo (with graceful fallback) → preset emoji avatar → initials.
export default function Avatar({ player, size = 48, className, ring = false, square = false }) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const dim = { width: size, height: size };
  const shape = square ? "rounded-2xl" : "rounded-full";

  const initials = (player?.nickname || "?")
    .split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const showPhoto = player?.photo && !imgError;
  const showAvatar = !showPhoto && player?.avatar;

  return (
    <div
      className={cn("relative overflow-hidden shrink-0 bg-secondary", shape, ring && "ring-2 ring-primary ring-offset-2 ring-offset-background", className)}
      style={dim}
    >
      {showPhoto && (
        <img
          src={player.photo}
          alt={player.nickname}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgError(true)}
          className={cn("absolute inset-0 h-full w-full object-cover transition-opacity duration-300", imgLoaded ? "opacity-100" : "opacity-0")}
        />
      )}
      {showAvatar && (
        <div className={cn("absolute inset-0 grid place-items-center bg-gradient-to-br", player.avatar.bg)}>
          <span style={{ fontSize: size * 0.5 }}>{player.avatar.emoji}</span>
        </div>
      )}
      {!showPhoto && !showAvatar && (
        <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-primary/30 to-primary/10">
          <span className="font-display text-foreground" style={{ fontSize: size * 0.36 }}>{initials}</span>
        </div>
      )}
      {player?.isYou && (
        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-primary px-1 text-[8px] font-bold leading-tight text-primary-foreground border-2 border-background">YOU</span>
      )}
    </div>
  );
}