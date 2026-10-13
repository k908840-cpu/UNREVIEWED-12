import assert from "node:assert/strict";

let contexts = 0;
const audioElements = [];
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

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.loop = false;
    this.preload = "";
    this.volume = 1;
    this.paused = true;
    this.currentTime = 0;
    this.playCalls = 0;
    this.pauseCalls = 0;
    audioElements.push(this);
  }

  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }
}

const originalWindow = globalThis.window;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

globalThis.window = {
  AudioContext: FakeAudioContext,
  Audio: FakeAudio,
  localStorage: {
    getItem: (key) => savedSettings.get(key) || null,
    setItem: (key, value) => savedSettings.set(key, value),
  },
  addEventListener(event, listener) { listeners.set(event, listener); },
  removeEventListener(event) { listeners.delete(event); },
};
globalThis.setInterval = () => 1;
globalThis.clearInterval = () => {};
globalThis.setTimeout = (callback) => { callback(); return 1; };
globalThis.clearTimeout = () => {};

try {
  const sound = await import(new URL("../src/lib/sound.js", import.meta.url));

  // Selecting background music cannot start playback before a gesture.
  sound.music.play();
  assert.equal(contexts, 0, "music must not autoplay before user interaction");
  assert.equal(audioElements.length, 0, "music must not allocate a media element before user interaction");

  const disarm = sound.armAudioUnlock();
  listeners.get("pointerdown")?.();
  // The listener intentionally starts the unlock asynchronously so it never
  // blocks a tap. Await the same public gesture API before asserting state.
  await sound.unlockAudio();
  assert.equal(contexts, 1, "the first gesture should unlock exactly one context");
  assert.equal(audioElements.length, 1, "the first gesture should create one background track");
  assert.equal(sound.getAudioDiagnostics().musicPlaying, true);
  assert.equal(audioElements[0].loop, true, "the MP3 must use native gapless looping");

  // Repeated route changes reuse one media element rather than layering loops.
  sound.music.play();
  sound.music.play();
  assert.equal(audioElements.length, 1, "route changes must not create overlapping media elements");
  assert.equal(sound.getAudioDiagnostics().musicInstances, 1);

  sound.updateChannel("music", { on: false });
  assert.equal(sound.getAudioDiagnostics().musicPlaying, false, "music toggle pauses the MP3");
  sound.updateChannel("music", { on: true, volume: 0.25 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sound.getAudioDiagnostics().musicPlaying, true, "music toggle resumes the selected MP3");
  sound.updateChannel("sfx", { on: false, volume: 0.2 });
  assert.equal(sound.getAudioDiagnostics().musicPlaying, true, "SFX controls must not stop music");
  const persisted = JSON.parse(savedSettings.get("unreviewed:settings:v2"));
  assert.deepEqual(persisted.music, { on: true, volume: 0.25 }, "music settings persist locally");
  assert.deepEqual(persisted.sfx, { on: false, volume: 0.2 }, "SFX settings persist independently");

  await sound.music.pause();
  assert.equal(sound.getAudioDiagnostics().musicPlaying, false, "backgrounding pauses the MP3");
  await sound.music.resume();
  assert.equal(sound.getAudioDiagnostics().musicPlaying, true, "resuming restores the MP3");
  assert.equal(audioElements.length, 1, "backgrounding must not create another MP3 instance");

  disarm();
  sound.music.stop();
  assert.equal(sound.getAudioDiagnostics().musicPlaying, false, "stopping ends background playback");
  console.log("Background audio regression passed.");
} finally {
  globalThis.window = originalWindow;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}
