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
      exponentialRampToValueAtTime(value) {
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
// Preserve the timer countdown effect after replacing procedural music.
globalThis.setInterval = (callback) => { callback(); return 1; };
globalThis.clearInterval = () => {};
globalThis.setTimeout = (callback) => { callback(); return 1; };

try {
  const { sfx, unlockAudio } = await import(new URL('../src/lib/sound.js', import.meta.url));
  await unlockAudio();
  assert.doesNotThrow(() => sfx.tick(true));
  assert.doesNotThrow(() => sfx.countdownEnd());
  console.log('Countdown audio regression passed.');
} finally {
  globalThis.window = originalWindow;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  globalThis.setTimeout = originalSetTimeout;
}
