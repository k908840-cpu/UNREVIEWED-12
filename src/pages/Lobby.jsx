import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, Users, Crown, Copy, Check, X, LogOut, WifiOff } from "lucide-react";
import { useGame } from "@/game/GameContext";
import Avatar from "@/components/Avatar";
import Stamp from "@/components/Stamp";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

const MAX_PLAYERS = 8;
const MIN_PLAYERS = 4;

export default function Lobby() {
  const navigate = useNavigate();
  const {
    players, roomCode, room, isHost, mode, length,
    startGame, kickPlayer, leaveRoom, endRoom, leftReason, acknowledgeLeft,
  } = useGame();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { sfx.lobby(); }, []);

  // Everyone drops into the round together once the Host starts.
  useEffect(() => {
    if (room?.status === "playing") navigate("/reveal");
  }, [room?.status, navigate]);

  const hasMinimumRoster = players.length >= MIN_PLAYERS;

  const copyCode = () => {
    navigator.clipboard?.writeText(roomCode);
    setCopied(true); sfx.tap();
    setTimeout(() => setCopied(false), 1500);
  };

  const start = async () => {
    setBusy(true); setError("");
    const res = await startGame();
    setBusy(false);
    if (res?.error) { setError(res.error === "not_enough_players" ? `Need at least ${MIN_PLAYERS} active players` : "Couldn't start. Try again."); sfx.wrong(); return; }
    sfx.reveal(); navigate("/reveal");
  };

  const leave = async () => { sfx.tap(); await leaveRoom(); navigate("/"); };
  const end = async () => { sfx.tap(); await endRoom(); navigate("/"); };

  if (leftReason) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5 text-center text-[hsl(var(--ink))]">
        <Stamp tone="red" rotate={-6} press>{leftReason === "removed" ? "Removed" : "Room closed"}</Stamp>
        <h1 className="mt-5 font-display text-4xl uppercase">
          {leftReason === "removed" ? "The Host showed you the door." : "This room is over."}
        </h1>
        <p className="mt-3 opacity-70">
          {leftReason === "removed" ? "Don't take it personally. (Take it a little personally.)" : "The party's wrapped. Start a new one?"}
        </p>
        <button
          onClick={() => { acknowledgeLeft(); navigate("/"); }}
          className="mt-7 rounded-full border-4 border-[hsl(var(--ink))] bg-primary px-8 py-3.5 font-display text-xl uppercase text-primary-foreground shadow-[0_5px_0_0_hsl(var(--ink))]"
        >
          Back to start
        </button>
      </div>
    );
  }

  const lengthLabel = { quick: "Quick · 2 cycles", standard: "Standard · 4 cycles", party: "Party · 5 cycles", endless: "Endless" }[length];
  const slots = [...players, ...Array(Math.max(0, MAX_PLAYERS - players.length)).fill(null)];

  return (
    <div className="relative mx-auto min-h-screen max-w-3xl px-5 py-10 text-[hsl(var(--ink))]">
      <div className="paper-grain relative rounded-[1.5rem] border-4 border-[hsl(var(--ink))] bg-white p-6 text-center">
        <div className="absolute -top-3 left-1/2 -translate-x-1/2"><Stamp tone="yellow" rotate={-3}>Room code</Stamp></div>
        <button onClick={copyCode} className="group mt-2 inline-flex items-center gap-3">
          <span className="font-display text-5xl tracking-[0.2em] sm:text-6xl">{roomCode}</span>
          <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-[hsl(var(--ink))] transition group-hover:bg-primary group-hover:text-primary-foreground">
            {copied ? <Check size={16} /> : <Copy size={16} />}
          </span>
        </button>
        <p className="mt-2 text-sm opacity-60">Share this code with your so-called friends.</p>
      </div>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <span className={cn("rounded-full border-2 border-[hsl(var(--ink))] px-3 py-1.5 text-xs font-bold uppercase tracking-wider", mode === "adult" ? "bg-[hsl(var(--mode-adult))] text-cream" : "bg-[hsl(var(--mode-family))] text-cream")}>
          {mode === "adult" ? "Adults Only" : "Family"}
        </span>
        <span className="rounded-full border-2 border-[hsl(var(--ink))] bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wider">{lengthLabel}</span>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-heading text-sm font-bold uppercase tracking-widest opacity-70">
            <Users size={16} /> Players ({players.length}/{MAX_PLAYERS})
          </div>
          {isHost && <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider opacity-60"><Crown size={13} className="text-primary" /> You're the Host</span>}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {slots.map((p, i) => (
            <motion.div
              key={p?.sessionId || i}
              initial={{ opacity: 0, scale: 0.9, rotate: -1 }} animate={{ opacity: 1, scale: 1, rotate: i % 2 ? 1 : -1 }}
              transition={{ delay: i * 0.04 }}
              className={cn("paper-grain relative flex items-center gap-3 rounded-2xl border-4 bg-white p-3", p && !p.connected ? "border-[hsl(var(--ink))]/40 opacity-60" : "border-[hsl(var(--ink))]")}
            >
              {p ? (
                <>
                  <span className="absolute -top-2 left-1/2 h-4 w-12 -translate-x-1/2 rotate-2 bg-primary/50" />
                  <Avatar player={p} size={44} ring={p.isHost} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-semibold">{p.nickname}</span>
                      {p.isHost && <Crown size={13} className="shrink-0 text-primary" />}
                      {!p.connected && <WifiOff size={12} className="shrink-0 opacity-60" />}
                    </div>
                    <span className={cn("mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", p.isYou ? "bg-primary text-primary-foreground" : "bg-cream text-[hsl(var(--ink))]")}>
                      {p.isYou ? "You" : p.isHost ? "Host" : p.connected ? "Ready" : "Away"}
                    </span>
                  </div>
                  {isHost && !p.isYou && (
                    <button onClick={() => { sfx.tap(); kickPlayer(p.sessionId); }} className="grid h-7 w-7 place-items-center rounded-full border-2 border-[hsl(var(--ink))] text-[hsl(var(--ink))] hover:bg-[hsl(var(--mode-adult))] hover:text-cream" title="Remove player">
                      <X size={13} />
                    </button>
                  )}
                </>
              ) : (
                <>
                  <div className="grid h-11 w-11 place-items-center rounded-full border border-dashed border-[hsl(var(--ink))]/40 text-[hsl(var(--ink))]/30">+</div>
                  <span className="text-sm opacity-50">Waiting…</span>
                </>
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {error && <p className="mt-4 text-center text-sm font-semibold text-[hsl(var(--mode-adult))]">{error}</p>}

      <div className="mt-10 text-center">
        {isHost ? (
          <>
            <motion.button
              onClick={start}
              disabled={busy}
              whileHover={{ scale: hasMinimumRoster ? 1.03 : 1 }} whileTap={{ scale: 0.97 }}
              className={cn("inline-flex items-center gap-2 rounded-full border-4 border-[hsl(var(--ink))] px-10 py-4 font-display text-2xl uppercase tracking-wide shadow-[0_6px_0_0_hsl(var(--ink))]", hasMinimumRoster ? "bg-primary text-primary-foreground" : "bg-white text-[hsl(var(--ink))]/40")}
            >
              <Play size={24} fill="currentColor" /> {busy ? "Starting…" : "Start Game"}
            </motion.button>
            <p className="mt-3 text-xs uppercase tracking-wider opacity-50">
              {hasMinimumRoster ? `${players.length} players joined — server checks who is active` : `${players.length}/${MIN_PLAYERS} joined — waiting for more`}
            </p>
            <div className="mt-5"><button onClick={end} className="text-xs uppercase tracking-wider opacity-50 hover:opacity-100">End the room</button></div>
          </>
        ) : (
          <>
            <div className="inline-flex items-center gap-2 rounded-full border-2 border-[hsl(var(--ink))] bg-white px-6 py-3.5">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary" /> Waiting for the Host to start…
            </div>
            <div className="mt-5">
              <button onClick={leave} className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider opacity-50 hover:opacity-100">
                <LogOut size={13} /> Leave room
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
