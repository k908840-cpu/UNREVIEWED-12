// UNREVIEWED audio engine — Web Audio synth (no asset files).
// Playful, mischievous party-game direction. All sounds are temporary
// and replaceable: swap the synth bodies for real samples later without
// changing the public API (sfx.*, music.*, useAudioSettings).
import { useEffect, useState } from "react";

const STORAGE_KEY = "unreviewed:settings:v2";

const DEFAULT_SETTINGS = {
  music: { on: true, volume: 0.45 },
  sfx: { on: true, volume: 0.8 },
  voice: { on: true, volume: 0.85 },
  showTimer: true,
  reducedMotion: false,
};

// ---- settings store (persisted) ----
function loadSettings() {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const p = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...p,
      music: { ...DEFAULT_SETTINGS.music, ...(p.music || {}) },
      sfx: { ...DEFAULT_SETTINGS.sfx, ...(p.sfx || {}) },
      voice: { ...DEFAULT_SETTINGS.voice, ...(p.voice || {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();
const listeners = new Set();
function notify() { listeners.forEach((l) => l(settings)); }

export function getSettings() { return settings; }

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  persist(); applyAudioSettings(); notify();
  return settings;
}
export function updateChannel(channel, patch) {
  settings = { ...settings, [channel]: { ...settings[channel], ...patch } };
  persist(); applyAudioSettings(); notify();
  return settings;
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

export function useAudioSettings() {
  const [s, setS] = useState(settings);
  useEffect(() => {
    const l = (v) => setS(v);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return s;
}

export function prefersReducedMotion() { return !!settings.reducedMotion; }

// ---- audio context + gains ----
let ctx = null, masterGain, musicGain, sfxGain, voiceGain;
let _masterMuted = false, _masterVolume = 0.85;

function ensure() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain(); masterGain.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.connect(masterGain);
    sfxGain = ctx.createGain(); sfxGain.connect(masterGain);
    voiceGain = ctx.createGain(); voiceGain.connect(masterGain);
    applyAudioSettings();
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function effective(channel) {
  const c = settings[channel];
  if (!c.on || _masterMuted) return 0;
  return Math.max(0, Math.min(1, c.volume * _masterVolume));
}
function applyAudioSettings() {
  if (!ctx) return;
  const now = ctx.currentTime;
  musicGain.gain.setTargetAtTime(effective("music"), now, 0.08);
  sfxGain.gain.setTargetAtTime(effective("sfx"), now, 0.04);
  voiceGain.gain.setTargetAtTime(effective("voice"), now, 0.04);
  if (settings.music.on && currentTrack && !_masterMuted) startScheduler();
  if (!settings.music.on || _masterMuted) stopScheduler();
}

// legacy master mute/volume (kept for the quick VolumeControl in the top bar)
export function setMuted(m) { _masterMuted = m; applyAudioSettings(); }
export function setVolume(v) { _masterVolume = Math.max(0, Math.min(1, v)); applyAudioSettings(); }
export function isMuted() { return _masterMuted; }
export function getVolume() { return _masterVolume; }

// ---- low-level voices ----
function sTone(freq, dur = 0.15, type = "sine", gain = 0.3, when = 0, glideTo = null) {
  const ac = ensure(); if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(sfxGain);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}
function sNoise(dur = 0.2, gain = 0.2, when = 0, hp = false) {
  const ac = ensure(); if (!ac) return;
  const t0 = ac.currentTime + when;
  const len = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource(); src.buffer = buf;
  const g = ac.createGain(); g.gain.value = gain;
  let node = src;
  if (hp) { const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 6000; src.connect(f); node = f; }
  node.connect(g).connect(sfxGain);
  src.start(t0);
}

// music voices -> musicGain
function mTone(freq, dur, type, gain, when) {
  const ac = ctx; if (!ac) return;
  const t0 = ac.currentTime + when;
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(musicGain);
  osc.start(t0); osc.stop(t0 + dur + 0.05);
}
// ---- music patterns (replaceable temporary loops) ----
const N = { C2:65.41, D2:73.42, E2:82.41, F2:87.31, G2:98, A2:110, B2:123.47,
  C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196, A3:220, B3:246.94,
  C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392, A4:440, B4:493.88, C5:523.25, E5:659.25, G5:783.99 };

const TRACKS = {
  lobby: {
    bpm: 104, bassType: "triangle", stabType: "sine",
    bass: [N.C2,null,N.C2,null, N.G2,null,N.G2,null, N.A2,null,N.A2,null, N.F2,null,N.G2,null],
    stab: [null,null,null,null, [N.C4,N.E4,N.G4],null,null,null, null,null,null,null, [N.F4,N.A4,N.C5],null,null,null],
    hat: [0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],
  },
  writing: {
    bpm: 112, bassType: "sine", stabType: "triangle",
    bass: [N.C2,null,null,null, N.G2,null,null,null, N.A2,null,null,null, N.F2,null,null,null],
    stab: [N.C4,null,N.E4,null,N.G4,null,N.A4,null, N.C5,null,N.A4,null,N.G4,null,N.E4,null],
    hat: [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],
  },
  rating: {
    bpm: 120, bassType: "sawtooth", stabType: "sine",
    bass: [N.A2,null,N.A2,null, N.F2,null,N.F2,null, N.G2,null,N.G2,null, N.E2,null,N.E2,null],
    stab: [null,null,[N.A3,N.C4,N.E4],null, null,null,null,null, null,null,[N.G3,N.B3,N.D4],null, null,null,null,null],
    hat: [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
  },
  prediction: {
    bpm: 84, bassType: "sine", stabType: "sine",
    bass: [N.A2,null,null,null, N.A2,null,null,null, N.G2,null,null,null, N.F2,null,null,null],
    stab: [null,null,null,null, null,null,null,null, [N.G3,N.C4],null,null,null, null,null,null,null],
    hat: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],
  },
  results: {
    bpm: 120, bassType: "triangle", stabType: "triangle",
    bass: [N.C2,null,N.C2,null, N.D2,null,N.D2,null, N.E2,null,N.E2,null, N.G2,null,N.G2,null],
    stab: [[N.C4,N.E4,N.G4],null,null,null, [N.D4,N.F4,N.A4],null,null,null, [N.E4,N.G4,N.B4],null,null,null, [N.G4,N.B4,N.D5],null,null,null],
    hat: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  },
};

let currentTrack = null;
let schedulerId = null;
let step = 0;
let nextNoteTime = 0;

function playStep(track, s, t) {
  const b = track.bass[s];
  if (b) mTone(b, 0.22, track.bassType, 0.16, t - ctx.currentTime);
  const stab = track.stab[s];
  if (stab) stab.forEach((f) => mTone(f, 0.16, track.stabType, 0.07, t - ctx.currentTime));
}

function startScheduler() {
  if (schedulerId) return;
  const ac = ensure(); if (!ac) return;
  nextNoteTime = ac.currentTime + 0.08;
  step = 0;
  schedulerId = setInterval(() => {
    if (!ctx || !currentTrack) return;
    const spb = 60 / currentTrack.bpm / 4;
    while (nextNoteTime < ctx.currentTime + 0.15) {
      playStep(currentTrack, step, nextNoteTime);
      step = (step + 1) % 16;
      nextNoteTime += spb;
    }
  }, 40);
}
function stopScheduler() {
  if (schedulerId) { clearInterval(schedulerId); schedulerId = null; }
}

function rampTo(node, target, time = 0.3) {
  if (!ctx) return;
  const now = ctx.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(Math.max(0.0001, node.gain.value), now);
  node.gain.linearRampToValueAtTime(Math.max(0.0001, target), now + time);
}

export const music = {
  play(track) {
    const ac = ensure(); if (!ac) return;
    if (!TRACKS[track]) return;
    if (currentTrack === track) { // ensure audible if just toggled on
      if (settings.music.on && !_masterMuted) startScheduler();
      return;
    }
    currentTrack = TRACKS[track];
    startScheduler();
    // smooth crossfade dip so the loop change isn't abrupt
    const target = effective("music");
    rampTo(musicGain, target * 0.35, 0.2);
    setTimeout(() => rampTo(musicGain, target, 0.35), 220);
  },
  stop() {
    currentTrack = null;
    stopScheduler();
    if (ctx) rampTo(musicGain, 0, 0.3);
  },
  sting(name) {
    if (name === "winner") winnerSting();
  },
};

function winnerSting() {
  const ac = ensure(); if (!ac) return;
  const seq = [N.C4, N.E4, N.G4, N.C5, N.E5];
  seq.forEach((f, i) => mTone(f, 0.3, "triangle", 0.18, i * 0.09));
  mTone(N.C2, 0.6, "triangle", 0.18, 0);
  mTone(N.G2, 0.6, "triangle", 0.14, 0.05);
  [N.C5, N.E5, N.G5].forEach((f) => mTone(f, 0.5, "sine", 0.1, 0.45));
}

// ---- sound effects (playful, restrained) ----
export const sfx = {
  tap() { sTone(560, 0.06, "triangle", 0.16); },
  starHover() { sTone(880, 0.05, "sine", 0.06); },
  starSelect() { sTone(880, 0.08, "triangle", 0.18); sTone(1175, 0.1, "sine", 0.12, 0.05); },
  submit() { sNoise(0.05, 0.06, 0, true); sTone(440, 0.12, "triangle", 0.16, 0, 660); sTone(660, 0.14, "sine", 0.12, 0.06); },
  tick(urgent = false) { sTone(urgent ? 740 : 440, urgent ? 0.08 : 0.05, "triangle", urgent ? 0.14 : 0.08); },
  countdownEnd() { sTone(330, 0.18, "triangle", 0.18, 0, 220); sTone(220, 0.4, "sine", 0.16, 0.12); },
  reveal() { sNoise(0.3, 0.05); sTone(196, 0.5, "sawtooth", 0.12, 0, 392); sTone(392, 0.5, "triangle", 0.12, 0.18); sTone(523, 0.4, "sine", 0.1, 0.3); },
  answerReveal() { sTone(660, 0.1, "triangle", 0.16); sTone(990, 0.14, "sine", 0.12, 0.07); },
  whoosh() { sNoise(0.22, 0.07, 0, true); sTone(140, 0.22, "sine", 0.08, 0, 420); },
  barRise() { sTone(330, 0.2, "sine", 0.12, 0, 660); },
  scoreLand() { sTone(784, 0.1, "triangle", 0.16); sTone(1047, 0.16, "sine", 0.12, 0.06); },
  second() { sTone(523, 0.16, "triangle", 0.16); sTone(659, 0.2, "triangle", 0.14, 0.1); },
  predictionLock() { sNoise(0.04, 0.06, 0, true); sTone(220, 0.08, "square", 0.1); sTone(165, 0.2, "sine", 0.12, 0.05); },
  plus1() { sTone(784, 0.12, "triangle", 0.16); },
  plus2() { sTone(659, 0.1, "triangle", 0.16); sTone(988, 0.16, "sine", 0.14, 0.08); },
  correct() { sTone(659, 0.1, "sine", 0.18); sTone(988, 0.12, "sine", 0.16, 0.08); sTone(1319, 0.18, "sine", 0.12, 0.16); },
  wrong() { sTone(311, 0.18, "sawtooth", 0.16, 0, 196); sTone(196, 0.3, "sine", 0.14, 0.12); sNoise(0.18, 0.05, 0.1); },
  winner() {
    [523, 659, 784, 1047].forEach((f, i) => sTone(f, 0.22, "triangle", 0.2, i * 0.11));
    sTone(1568, 0.5, "sine", 0.16, 0.5);
  },
  podium() { [392, 523, 659, 784, 1047].forEach((f, i) => sTone(f, 0.3, "triangle", 0.2, i * 0.16)); },
  lobby() { sTone(440, 0.1, "sine", 0.1); sTone(550, 0.12, "sine", 0.1, 0.08); },
};

// unlock audio on first user gesture
export function unlockAudio() { ensure(); }