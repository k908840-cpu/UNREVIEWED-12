import assert from "node:assert/strict";

let contexts = 0;
let scheduledIntervals = 0;
const listeners = new Map();
const savedSettings = new Map();

class FakeGain {
  constructor() {
    this.gain = {
      value: 1,
      setTargetAtTime() {},
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelScheduledValues() {},
      linearRampToValueAtTime() {},
    };
  }

  connect() { return this; }
}

class FakeOscillator {
  constructor() {
    this.frequency = {
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
    };
  }

  connect(target) { return target; }
  start() {}
  stop() {}
}

class FakeAudioContext {
  constructor() {
    contexts += 1;
    this.state = "suspended";
    this.destination = {};
  }

  get currentTime() { return 0; }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  createGain() { return new FakeGain(); }
  createOscillator() { return new FakeOscillator(); }
}

const originalWindow = globalThis.window;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

globalThis.window = {
  AudioContext: FakeAudioContext,
  localStorage: {
    getItem: (key) => savedSettings.get(key) || null,
    setItem: (key, value) => savedSettings.set(key, value),
  },
  addEventListener(event, listener) { listeners.set(event, listener); },
  removeEventListener(event) { listeners.delete(event); },
};
globalThis.setInterval = (callback) => {
  scheduledIntervals += 1;
  callback();
  return scheduledIntervals;
};
globalThis.clearInterval = () => {};
globalThis.setTimeout = (callback) => { callback(); return 1; };
globalThis.clearTimeout = () => {};

try {
  const sound = await import(new URL("../src/lib/sound.js", import.meta.url));

  // Selecting a route track cannot start an AudioContext before a gesture.
  sound.music.play("lobby");
  assert.equal(contexts, 0, "music must not autoplay before user interaction");

  const disarm = sound.armAudioUnlock();
  listeners.get("pointerdown")?.();
  // The listener intentionally starts the unlock asynchronously so it never
  // blocks a tap. Await the same public gesture API before asserting state.
  await sound.unlockAudio();
  assert.equal(contexts, 1, "the first gesture should unlock exactly one context");
  assert.equal(sound.getAudioDiagnostics().schedulerRunning, true);

  // Repeated route changes use the single scheduler rather than layering loops.
  sound.music.play("writing");
  sound.music.play("results");
  assert.equal(contexts, 1, "route changes must reuse the existing AudioContext");
  assert.equal(scheduledIntervals, 1, "route changes must not create overlapping schedulers");

  sound.updateChannel("music", { on: false });
  assert.equal(sound.getAudioDiagnostics().schedulerRunning, false, "music toggle stops the scheduler");
  sound.updateChannel("music", { on: true, volume: 0.25 });
  assert.equal(sound.getAudioDiagnostics().schedulerRunning, true, "music toggle restores the selected track");
  assert.match(savedSettings.get("unreviewed:settings:v2"), /"music"/, "channel settings persist locally");

  await sound.music.pause();
  assert.equal(sound.getAudioDiagnostics().schedulerRunning, false, "backgrounding stops the scheduler");
  await sound.music.resume();
  assert.equal(sound.getAudioDiagnostics().schedulerRunning, true, "resuming restores one scheduler");

  disarm();
  sound.music.stop();
  console.log("Background audio regression passed.");
} finally {
  globalThis.window = originalWindow;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
