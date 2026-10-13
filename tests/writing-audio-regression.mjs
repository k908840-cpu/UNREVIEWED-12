import assert from 'node:assert/strict';

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
      setValueAtTime(value) {
        if (!Number.isFinite(value)) throw new TypeError('frequency must be finite');
      },
    };
  }

  connect(target) { return target; }
  start() {}
  stop() {}
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.destination = {};
  }

  get currentTime() { return 0; }
  resume() { return Promise.resolve(); }
  createGain() { return new FakeGain(); }
  createOscillator() { return new FakeOscillator(); }
}

const originalWindow = globalThis.window;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalSetTimeout = globalThis.setTimeout;

globalThis.window = {
  AudioContext: FakeAudioContext,
  localStorage: { getItem: () => null, setItem() {} },
};
// Run each track's first beat synchronously. Writing contains scalar stab
// entries; prediction and results also exercise their lower/upper note ranges.
globalThis.setInterval = (callback) => { callback(); return 1; };
globalThis.clearInterval = () => {};
globalThis.setTimeout = (callback) => { callback(); return 1; };

try {
  const { music, unlockAudio } = await import(new URL('../src/lib/sound.js', import.meta.url));
  await unlockAudio();
  for (const track of ['lobby', 'writing', 'rating', 'prediction', 'results']) {
    assert.doesNotThrow(() => music.play(track));
    music.stop();
  }
  console.log('Writing audio regression passed.');
} finally {
  globalThis.window = originalWindow;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  globalThis.setTimeout = originalSetTimeout;
}
