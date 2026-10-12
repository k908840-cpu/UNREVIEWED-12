import assert from 'node:assert/strict';
import { createLeaveRoomCoordinator } from '../src/game/leaveRoomCoordinator.js';

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

const source = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/components/QuitGameDialog.jsx', import.meta.url), 'utf8'));
assert.match(source, /Leave the game\?/);
assert.match(source, /You'll leave this game and return to the home screen\. Your current progress in this game may be lost\./);
assert.match(source, /Stay in Game/);
assert.match(source, /Leave Game/);

console.log('Quit Game regressions passed.');
