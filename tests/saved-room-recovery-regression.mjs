import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifySavedRoomResponse, isCurrentSavedRoomRecovery } from '../src/game/savedRoomRecovery.js';

const sessionId = 'android-player';
const activeRoom = {
  code: 'AB12',
  status: 'playing',
  mode: 'family',
  length: 'quick',
  game_state: { phase: 'writing' },
};
const me = { session_id: sessionId, nickname: 'Alpha', avatar_id: 'smile', last_seen: '2026-10-13T00:00:00.000Z' };

// Fresh app launch: absence of a saved response cannot create a resume offer.
assert.deepEqual(
  classifySavedRoomResponse(undefined, sessionId),
  { status: 'unavailable', reason: 'resume_unavailable' },
  'a fresh launch has no room to activate',
);

// An app update may preserve local storage. It must offer the known room, not
// automatically make it active or navigate to a gameplay phase.
const available = classifySavedRoomResponse({ room: activeRoom, players: [me] }, sessionId);
assert.equal(available.status, 'available', 'a valid saved membership is resumable');
assert.equal(available.room.code, 'AB12');
assert.equal(available.player.session_id, sessionId);

// A temporarily inactive player remains a valid member and can reconnect; the
// server's 60-second active window governs eligibility, not local restoration.
const inactive = classifySavedRoomResponse({
  room: activeRoom,
  players: [{ ...me, connected: false, last_seen: '2026-10-12T00:00:00.000Z' }],
}, sessionId);
assert.equal(inactive.status, 'available', 'an inactive member can explicitly reconnect');

for (const error of ['not_found', 'closed', 'not_in_room']) {
  assert.deepEqual(
    classifySavedRoomResponse({ error }, sessionId),
    { status: 'stale', reason: error },
    `${error} clears a stale saved room without entering gameplay`,
  );
}

assert.deepEqual(
  classifySavedRoomResponse({ room: activeRoom, players: [] }, sessionId),
  { status: 'stale', reason: 'not_in_room' },
  'a removed player clears the saved session',
);
assert.deepEqual(
  classifySavedRoomResponse({ error: 'rate_limited' }, sessionId),
  { status: 'unavailable', reason: 'rate_limited' },
  'a rate-limited check preserves a retryable saved-room choice',
);

// A late pre-leave roster response is never allowed to restore the room after
// resetRoomState invalidates the lifecycle and clears the active room code.
assert.equal(
  isCurrentSavedRoomRecovery({ attempt: 7, currentAttempt: 7, code: 'AB12', activeRoomCode: 'AB12' }),
  true,
  'the currently selected saved room may be applied',
);
assert.equal(
  isCurrentSavedRoomRecovery({ attempt: 7, currentAttempt: 8, code: 'AB12', activeRoomCode: '' }),
  false,
  'leave invalidates an in-flight recovery response',
);

const [context, landing, profile, dialog] = await Promise.all([
  readFile(new URL('../src/game/GameContext.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/Landing.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/ProfileSetup.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/QuitGameDialog.jsx', import.meta.url), 'utf8'),
]);

assert.match(context, /classifySavedRoomResponse\(data, sessionId\)/, 'startup checks classify saved-room state before activation');
assert.match(context, /setResumeOfferState\(\{ code, status: "available"/, 'valid saved rooms create an explicit resume offer');
assert.doesNotMatch(context, /const resumeActiveRoom/, 'startup no longer auto-activates a saved room');
assert.match(context, /resumeOffer\?\.status === "checking" && !roomCode/, 'a restored Android gameplay URL returns to the menu while the saved room is checked');
assert.match(context, /savedRoomRecoveryAttemptRef\.current \+= 1/, 'leave invalidates stale recovery responses');
assert.match(context, /leaveRequestRef\.current\?\.\(resumeOfferRef\.current\?\.code\)/, 'saved-room Leave sends the server request before clearing local storage');
assert.match(context, /const leaveSavedRoom = useCallback/, 'the landing choice exposes a server-confirmed Leave action');
assert.match(landing, /Resume Game/);
assert.match(landing, /Leave Room/);
assert.match(profile, /resumeOffer \|\| savedActiveRoomCode/, 'profile setup cannot bypass the saved-room choice');
assert.match(dialog, /leaveRoom\(\)/, 'active-game Leave remains server-confirmed through the coordinator');

console.log('Saved room recovery regressions passed.');
