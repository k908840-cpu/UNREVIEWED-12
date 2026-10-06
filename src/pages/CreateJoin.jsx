import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Plus, LogIn, ArrowLeft, Star } from "lucide-react";
import { useGame } from "@/game/GameContext";
import Stamp from "@/components/Stamp";
import { sfx } from "@/lib/sound";

export default function CreateJoin() {
  const navigate = useNavigate();
  const { createRoom, lookupRoom } = useGame();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const ERRORS = {
    not_found: "No room with that code",
    closed: "That room has already ended",
    in_progress: "That game already started",
    full: "That room is full",
    rate_limited: "Server is busy. Try again in a moment.",
  };

  const handleCreate = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { sfx.reveal(); await createRoom(); navigate("/config"); }
    catch { setError("Couldn't create the room. Try again."); sfx.wrong(); }
    finally { setBusy(false); }
  };

  const handleJoin = async () => {
    if (code.length < 4) { setError("Enter a 4-character room code"); sfx.wrong(); return; }
    if (busy) return;
    setBusy(true); setError("");
    try {
      const res = await lookupRoom(code);
      if (res?.error) { setError(ERRORS[res.error] || "Couldn't find that room"); sfx.wrong(); return; }
      sfx.lobby(); navigate("/profile");
    } catch { setError("Couldn't join. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-5 py-10 text-[hsl(var(--ink))]">
      <button onClick={() => navigate("/")} className="mb-6 inline-flex items-center gap-1.5 text-sm text-[hsl(var(--ink))]/60 hover:text-[hsl(var(--ink))]">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="mb-8 text-center">
        <div className="flex justify-center"><Stamp tone="yellow" rotate={-3}>Start here</Stamp></div>
        <h1 className="mt-3 text-display text-5xl sm:text-6xl">GET IN HERE</h1>
        <p className="mt-2 text-[hsl(var(--ink))]/60">Create a room or join one with a code.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* create */}
        <motion.button
          onClick={handleCreate}
          disabled={busy}
          whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }}
          className="group relative overflow-hidden rounded-3xl border-4 border-[hsl(var(--ink))] bg-primary p-7 text-left text-primary-foreground shadow-[0_6px_0_0_hsl(var(--ink))]"
        >
          <div className="absolute -right-8 -top-8 text-white/20 transition-transform group-hover:scale-110">
            <Star size={120} fill="currentColor" />
          </div>
          <div className="relative">
            <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border-2 border-[hsl(var(--ink))] bg-white text-primary"><Plus size={24} /></div>
            <h2 className="font-display text-3xl uppercase">Create a Room</h2>
            <p className="mt-2 text-sm opacity-80">You'll be the Host. Pick the mode, set the length, start the chaos.</p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-bold">Start hosting →</span>
          </div>
        </motion.button>

        {/* join */}
        <div className="rounded-3xl border-4 border-[hsl(var(--ink))] bg-white p-7 shadow-[0_6px_0_0_hsl(var(--ink))]">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border-2 border-[hsl(var(--ink))] bg-[hsl(var(--mode-family))] text-cream"><LogIn size={24} /></div>
          <h2 className="font-display text-3xl uppercase">Join a Room</h2>
          <p className="mt-2 text-sm text-[hsl(var(--ink))]/60">Got a code from your Host? Drop it in.</p>
          <div className="mt-5">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase().slice(0, 4)); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="ABCD" maxLength={4}
              className="w-full rounded-2xl border-4 border-[hsl(var(--ink))] bg-cream px-4 py-4 text-center font-mono text-3xl font-bold uppercase tracking-[0.4em] text-[hsl(var(--ink))] outline-none focus:border-primary"
            />
            {error && <p className="mt-2 text-sm text-[hsl(var(--mode-adult))]">{error}</p>}
            <button
              onClick={handleJoin}
              disabled={busy}
              className="mt-3 w-full rounded-full border-4 border-[hsl(var(--ink))] bg-[hsl(var(--ink))] py-3.5 font-display text-lg uppercase tracking-wide text-cream transition hover:opacity-90 disabled:opacity-50"
            >
              Join Room
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}