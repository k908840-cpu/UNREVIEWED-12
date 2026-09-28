import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Send, Mic, MicOff, Volume2, VolumeX, Headphones } from "lucide-react";
import { useGame } from "@/game/GameContext";
import Avatar from "./Avatar";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

export default function ChatPanel({ open, onClose }) {
  const { chat, addChat, players, muted, toggleMute, volume, setVolume } = useGame();
  const [text, setText] = useState("");
  const [voiceMuted, setVoiceMuted] = useState(false);
  const scrollRef = useRef(null);

  const playerById = (id) => players.find((p) => p.id === id) || { nickname: "?", id };
  const me = players.find((p) => p.isYou);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chat, open]);

  const send = () => {
    if (!text.trim()) return;
    addChat(text);
    setText("");
    sfx.tap();
  };

  // mock speaking indicator
  const speakingNow = open && Math.random() > 0.5 ? players[Math.floor(Math.random() * Math.min(3, players.length))]?.id : null;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-sm flex-col border-l border-border bg-card"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
          >
            {/* voice placeholder */}
            <div className="border-b border-border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Headphones size={14} /> Room Voice
                </div>
                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-400">Connected</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => { setVoiceMuted((m) => !m); sfx.tap(); }}
                  className={cn("flex h-11 w-11 items-center justify-center rounded-full border transition", voiceMuted ? "border-destructive/40 bg-destructive/15 text-destructive" : "border-emerald-500/40 bg-emerald-500/15 text-emerald-400")}
                  aria-label={voiceMuted ? "Unmute mic" : "Mute mic"}
                >
                  {voiceMuted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                <div className="flex flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {players.slice(0, 6).map((p) => (
                    <div key={p.id} className="relative shrink-0" title={p.nickname}>
                      <Avatar player={p} size={32} />
                      {speakingNow === p.id && !voiceMuted && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 anim-pulse-glow ring-2 ring-card" />
                      )}
                      {!voiceMuted && (
                        <span className="absolute inset-0 rounded-full ring-1 ring-emerald-400/0" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">Tap a mic to mute yourself. Voice is mocked in this prototype.</p>
            </div>

            {/* chat header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="font-heading text-sm font-bold uppercase tracking-wider">Room Chat</h3>
              <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"><X size={18} /></button>
            </div>

            {/* messages */}
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {chat.map((m) => {
                const p = playerById(m.playerId);
                const mine = m.playerId === "p_you";
                return (
                  <div key={m.id} className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
                    <Avatar player={p} size={28} />
                    <div className={cn("max-w-[78%] rounded-2xl px-3 py-2 text-sm", mine ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-secondary text-foreground rounded-bl-sm")}>
                      {!mine && <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{p.nickname}</div>}
                      {m.text}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* input */}
            <div className="border-t border-border p-3 safe-bottom">
              <div className="flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="Say something funny…"
                  maxLength={200}
                  className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm outline-none focus:border-primary"
                />
                <button onClick={send} disabled={!text.trim()} className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
                  <Send size={16} />
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}