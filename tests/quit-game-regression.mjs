import assert from 'node:assert/strict';
import { createLeaveRoomCoordinator } from '../src/game/leaveRoomCoordinator.js';
import { installActiveRoomBackGuard } from '../src/game/activeRoomBackGuard.js';
import { removeDepartedPlayers } from '../src/game/rosterPresence.js';

let sendCount = 0;
let resolveLeave;
let resetCount = 0;
const pendingCoordinator = createLeaveRoomCoordinator({
  send: () => {
    sendCount += 1;
    return new Promise((resolve) => { resolveLeave = resolve; });
  },
  onSuccess: () => { resetCount += 1; },
});

const first = pendingCoordinator.leave();
const duplicate = pendingCoordinator.leave();
assert.equal(first, duplicate, 'duplicate Leave Game clicks share one in-flight request');
assert.equal(sendCount, 1, 'only one authoritative leave request is sent');
resolveLeave({ ok: true });
assert.deepEqual(await first, { ok: true });
assert.equal(resetCount, 1, 'local state clears only after backend confirmation');
assert.equal(pendingCoordinator.isPending(), false, 'the coordinator releases after success');

let failedResets = 0;
const failedCoordinator = createLeaveRoomCoordinator({
  send: async () => ({ error: 'rate_limited', retryable: true }),
  onSuccess: () => { failedResets += 1; },
});
assert.deepEqual(await failedCoordinator.leave(), { error: 'rate_limited', retryable: true });
assert.equal(failedResets, 0, 'a failed leave keeps the local room session intact');
assert.equal(failedCoordinator.isPending(), false, 'a failed leave remains retryable');

const players = [
  { sessionId: 'alpha', nickname: 'Alpha' },
  { sessionId: 'bravo', nickname: 'Bravo' },
  { sessionId: 'charlie', nickname: 'Charlie' },
];
assert.deepEqual(
  removeDepartedPlayers(players, ['alpha', 'charlie']).map((player) => player.sessionId),
  ['alpha', 'charlie'],
  'a gameplay heartbeat removes only the departed player without fetching the roster again',
);

const listeners = new Map();
const pushedRoutes = [];
const fakeWindow = {
  history: {
    state: { existing: true },
    pushState: (state, _title, path) => pushedRoutes.push({ state, path }),
  },
  addEventListener: (event, listener) => listeners.set(event, listener),
  removeEventListener: (event) => listeners.delete(event),
};
let guardedRoute = '/write';
const navigations = [];
let leaveIntentCount = 0;
const removeBackGuard = installActiveRoomBackGuard({
  windowObject: fakeWindow,
  getProtectedPath: () => guardedRoute,
  navigate: (path, options) => navigations.push({ path, options }),
  onLeaveIntent: () => { leaveIntentCount += 1; },
});
assert.equal(pushedRoutes[0].path, '/write', 'entering an Android room creates a Back-button guard');
guardedRoute = '/rate';
listeners.get('popstate')();
assert.deepEqual(navigations, [{ path: '/rate', options: { replace: true } }], 'Back restores the active game route');
assert.equal(leaveIntentCount, 1, 'Back opens Quit Game confirmation instead of abandoning the room');
removeBackGuard();
assert.equal(listeners.has('popstate'), false, 'leaving the room removes the Back-button guard');

const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/components/QuitGameDialog.jsx', import.meta.url), 'utf8'));
assert.match(source, /Leave the game\?/);
assert.match(source, /You'll leave this game and return to the home screen\. Your current progress in this game may be lost\./);
assert.match(source, /Stay in Game/);
assert.match(source, /Leave Game/);

const layout = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/components/Layout.jsx', import.meta.url), 'utf8'));
assert.match(layout, /installActiveRoomBackGuard/);
assert.match(layout, /window\.Capacitor\?\.isNativePlatform\?\.\(\) === true/);
assert.match(layout, /document\.addEventListener\("backbutton", openQuitDialog\)/);
assert.match(layout, /Plugins\?\.App\?\.addListener\?\.\("backButton", openQuitDialog\)/);

const context = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/game/GameContext.jsx', import.meta.url), 'utf8'));
assert.match(context, /removeDepartedPlayers\(current, data\.roster_session_ids\)/);

const roomFunction = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../base44/functions/room/entry.ts', import.meta.url), 'utf8'));
assert.match(roomFunction, /case 'leave'/);
assert.match(roomFunction, /selectActiveHost\(remaining, now\)/, 'host departure selects a current-room replacement');
assert.match(roomFunction, /Player\.deleteMany\(\{ room_code: room\.code \}\)/, 'only an empty current room cleans up its own memberships');

console.log('Quit Game regressions passed.');
