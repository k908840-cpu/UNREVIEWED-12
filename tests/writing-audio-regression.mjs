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
    this.frequency = { setValueAtTime() {} };
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
// Run the scheduler's first Writing beat synchronously. That beat uses the
// scalar N.C4 stab entry which previously caused .forEach() to throw.
globalThis.setInterval = (callback) => { callback(); return 1; };
globalThis.clearInterval = () => {};
globalThis.setTimeout = (callback) => { callback(); return 1; };

try {
  const { music } = await import(new URL('../src/lib/sound.js', import.meta.url));
  assert.doesNotThrow(() => music.play('writing'));
  music.stop();
  console.log('Writing audio regression passed.');
} finally {
  globalThis.window = originalWindow;
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  globalThis.setTimeout = originalSetTimeout;
}
