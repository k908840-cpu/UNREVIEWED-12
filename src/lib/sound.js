// UNREVIEWED audio engine — bundled licensed music plus original Web Audio SFX.
// The background track is a local asset; effects stay procedural so gameplay
// feedback does not need downloaded samples.
import { useEffect, useState } from "react";

// Vite fingerprints this bundled URL for the web build; Node can also resolve
// it as a file URL for the lightweight audio regressions.
const localForecastSlower = new URL("../assets/audio/local-forecast-slower.mp3", import.meta.url).href;

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
    const raw = window.localStorage?.getItem(STORAGE_KEY);
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
  try { window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {}
}

export function useAudioSettings() {
  const [s, setS] = useState(settings);
  useEffect(() => {
    const l = (v) => setS(v);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return s;
}

export function prefersReducedMotion() { return !!settings.reducedMotion; }

// ---- audio context + gains ----
let ctx = null, masterGain, musicGain, sfxGain, voiceGain;
let _masterMuted = false, _masterVolume = 0.85;
let audioUnlocked = false;
let appIsForeground = true;
let removeUnlockListeners = null;
let musicElement = null;
let musicStartPromise = null;
let musicRequestVersion = 0;
let backgroundMusicRequested = false;

function createContext() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext;
    if (!AC) return null;
    ctx = new AC();
    masterGain = ctx.createGain(); masterGain.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.connect(masterGain);
    sfxGain = ctx.createGain(); sfxGain.connect(masterGain);
    voiceGain = ctx.createGain(); voiceGain.connect(masterGain);
    applyAudioSettings();
  }
  return ctx;
}

function canPlay(channel) {
  return !!(
    audioUnlocked
    && appIsForeground
    && ctx?.state === "running"
    && effective(channel) > 0
  );
}

function shouldPlayBackgroundMusic() {
  return !!(
    audioUnlocked
    && appIsForeground
    && backgroundMusicRequested
    && settings.music.on
    && !_masterMuted
    && effective("music") > 0
  );
}

function getMusicElement() {
  if (typeof window === "undefined" || !window.Audio) return null;
  if (!musicElement) {
    musicElement = new window.Audio(localForecastSlower);
    musicElement.loop = true;
    musicElement.preload = "auto";
  }
  musicElement.volume = effective("music");
  return musicElement;
}

function pauseBackgroundMusic() {
  musicRequestVersion += 1;
  musicElement?.pause();
}

function syncBackgroundMusic() {
  if (!shouldPlayBackgroundMusic()) {
    pauseBackgroundMusic();
    return Promise.resolve();
  }

  const element = getMusicElement();
  if (!element || !element.paused) return Promise.resolve();
  if (musicStartPromise) return musicStartPromise.then(() => syncBackgroundMusic());
  const requestVersion = ++musicRequestVersion;
  const playResult = element.play();
  const startPromise = Promise.resolve(playResult)
    .catch(() => undefined)
    .then(() => {
      // A muted, backgrounded, or stopped request that resolved late must not
      // leave a second copy of the track playing.
      if (requestVersion !== musicRequestVersion || !shouldPlayBackgroundMusic()) element.pause();
    });
  musicStartPromise = startPromise;
  return startPromise.finally(() => {
    if (musicStartPromise === startPromise) musicStartPromise = null;
    if (shouldPlayBackgroundMusic() && element.paused) void syncBackgroundMusic();
  });
}

function resumeContext() {
  if (!audioUnlocked) return Promise.resolve(null);
  const ac = createContext();
  if (!ac) return Promise.resolve(null);
  if (ac.state !== "suspended") return Promise.resolve(ac);
  return Promise.resolve(ac.resume())
    .then(() => ac)
    .catch(() => null);
}

function effective(channel) {
  const c = settings[channel];
  if (!c.on || _masterMuted) return 0;
  // Music is intentionally lower than SFX at every slider position. This
  // leaves room for countdowns, submissions, and result reveals.
  const headroom = channel === "music" ? 0.55 : 1;
  return Math.max(0, Math.min(1, c.volume * _masterVolume * headroom));
}
function applyAudioSettings() {
  if (!ctx) {
    syncBackgroundMusic();
    return;
  }
  const now = ctx.currentTime;
  musicGain.gain.setTargetAtTime(effective("music"), now, 0.08);
  sfxGain.gain.setTargetAtTime(effective("sfx"), now, 0.04);
  voiceGain.gain.setTargetAtTime(effective("voice"), now, 0.04);
  syncBackgroundMusic();
}

// legacy master mute/volume (kept for the quick VolumeControl in the top bar)
export function setMuted(m) { _masterMuted = m; applyAudioSettings(); }
export function setVolume(v) { _masterVolume = Math.max(0, Math.min(1, v)); applyAudioSettings(); }
export function isMuted() { return _masterMuted; }
export function getVolume() { return _masterVolume; }

// ---- low-level voices ----
function sTone(freq, dur = 0.15, type = "sine", gain = 0.3, when = 0, glideTo = null) {
  if (!canPlay("sfx")) return;
  const ac = ctx; if (!ac) return;
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
  if (!canPlay("sfx")) return;
  const ac = ctx; if (!ac) return;
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

function pauseMusicForBackground() {
  appIsForeground = false;
  pauseBackgroundMusic();
  if (ctx?.state === "running") return Promise.resolve(ctx.suspend()).catch(() => undefined);
  return Promise.resolve();
}

function resumeMusicAfterBackground() {
  appIsForeground = true;
  return resumeContext().then(() => syncBackgroundMusic());
}

export const music = {
  play() {
    backgroundMusicRequested = true;
    return syncBackgroundMusic();
  },
  stop() {
    backgroundMusicRequested = false;
    pauseBackgroundMusic();
    if (musicElement) {
      try { musicElement.currentTime = 0; } catch {}
    }
  },
  pause: pauseMusicForBackground,
  resume: resumeMusicAfterBackground,
};

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

// Android WebViews and mobile browsers reject autoplay. Route changes can set
// the desired track, but only a real user gesture creates/resumes the context.
export function unlockAudio() {
  audioUnlocked = true;
  return resumeContext().then((ac) => {
    applyAudioSettings();
    return ac || null;
  });
}

export function armAudioUnlock() {
  if (typeof window === "undefined" || removeUnlockListeners) return removeUnlockListeners || (() => {});
  const events = ["pointerdown", "touchstart", "keydown"];
  const onInteraction = () => {
    removeUnlockListeners?.();
    void unlockAudio();
  };
  removeUnlockListeners = () => {
    events.forEach((event) => window.removeEventListener(event, onInteraction, true));
    removeUnlockListeners = null;
  };
  events.forEach((event) => window.addEventListener(event, onInteraction, { capture: true, passive: true }));
  return removeUnlockListeners;
}

// Kept intentionally small and non-sensitive for regression diagnostics.
export function getAudioDiagnostics() {
  return {
    unlocked: audioUnlocked,
    contextState: ctx?.state || "none",
    musicInstances: musicElement ? 1 : 0,
    musicPlaying: !!musicElement && !musicElement.paused,
  };
}
