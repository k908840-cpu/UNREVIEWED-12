import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Music, Volume2, Mic, Eye, Zap, X } from "lucide-react";
import { useAudioSettings, updateChannel, updateSettings } from "@/lib/sound";
import Stamp from "@/components/Stamp";
import { cn } from "@/lib/utils";

export default function SettingsPanel({ open, onClose }) {
  const s = useAudioSettings();
  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60"
        onClick={onClose}
      >
        <motion.aside
          key="panel"
          initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
          onClick={(e) => e.stopPropagation()}
          className="paper-grain absolute right-0 top-0 flex h-full w-full max-w-md flex-col overflow-y-auto border-l-4 border-[hsl(var(--ink))] bg-cream p-6 text-[hsl(var(--cream-foreground))]"
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-display text-4xl">SETTINGS</h2>
              </div>
              <div className="mt-1"><Stamp tone="yellow" rotate={-4}>Your call</Stamp></div>
            </div>
            <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full border-2 border-[hsl(var(--ink))] bg-white hover:bg-primary hover:text-primary-foreground" aria-label="Close settings">
              <X size={18} />
            </button>
          </div>

          <div className="mt-7 space-y-6">
            <ChannelRow icon={Music} label="Music" channel="music" s={s} />
            <ChannelRow icon={Volume2} label="Sound Effects" channel="sfx" s={s} />
            <ChannelRow icon={Mic} label="Voice Chat" channel="voice" s={s} />

            <ToggleRow icon={Eye} label="Show Timer" desc="Display countdowns on timed screens."
              on={s.showTimer} onChange={(v) => updateSettings({ showTimer: v })} />
            <ToggleRow icon={Zap} label="Reduced Motion" desc="Tame animations and big reveals."
              on={s.reducedMotion} onChange={(v) => updateSettings({ reducedMotion: v })} />
          </div>

          <div className="mt-auto pt-8">
            <p className="text-center text-[11px] uppercase tracking-widest opacity-50">Saved on this device</p>
          </div>
        </motion.aside>
      </motion.div>
    </AnimatePresence>
  );
}

function ChannelRow({ icon: Icon, label, channel, s }) {
  const c = s[channel];
  return (
    <div className="rounded-2xl border-2 border-[hsl(var(--ink))] bg-white/70 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={18} className="text-[hsl(var(--ink))]" />
          <span className="font-heading text-sm font-bold uppercase tracking-wide">{label}</span>
        </div>
        <Toggle on={c.on} onChange={(v) => updateChannel(channel, { on: v })} />
      </div>
      <div className={cn("mt-3 flex items-center gap-3 transition-opacity", !c.on && "opacity-40")}>
        <input
          type="range" min={0} max={1} step={0.05} value={c.volume} disabled={!c.on}
          onChange={(e) => updateChannel(channel, { volume: parseFloat(e.target.value) })}
          className="w-full accent-[hsl(var(--primary))]"
        />
        <span className="w-9 text-right font-mono text-xs">{Math.round(c.volume * 100)}</span>
      </div>
    </div>
  );
}

function ToggleRow({ icon: Icon, label, desc, on, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border-2 border-[hsl(var(--ink))] bg-white/70 p-4">
      <div className="flex items-center gap-2">
        <Icon size={18} className="text-[hsl(var(--ink))]" />
        <div>
          <div className="font-heading text-sm font-bold uppercase tracking-wide">{label}</div>
          <div className="text-xs opacity-60">{desc}</div>
        </div>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={cn("relative h-7 w-12 shrink-0 rounded-full border-2 border-[hsl(var(--ink))] transition", on ? "bg-primary" : "bg-white")}
      aria-pressed={on}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full border-2 border-[hsl(var(--ink))] bg-white transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}