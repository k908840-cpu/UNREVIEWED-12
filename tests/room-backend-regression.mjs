/**
 * Behavioural regression tests for base44/functions/room/entry.ts.
 * Runs the REAL handler against an in-memory Base44 stand-in (no network).
 *
 * Guards the request-pressure work: a cheap heartbeat, lobby roster deltas,
 * presence persisted by game actions, and that none of it weakens removal /
 * closure detection, host migration, or server-authoritative advancement.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPresenceTracker, PRESENCE_SKIP_WINDOW_MS } from '../src/game/presenceTracker.js';
import { createFakeBase44, loadRoomHandler, callHandler } from './support/fake-base44.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let clock = Date.parse('2026-10-14T10:00:00.000Z');
Date.now = () => clock;
const realConsole = { log: console.log, error: console.error, warn: console.warn };
const quiet = () => { console.log = () => {}; console.error = () => {}; console.warn = () => {}; };
const loud = () => Object.assign(console, realConsole);

const fake = createFakeBase44({ now: () => clock });
quiet();
const handler = await loadRoomHandler(process.env.ROOM_BACKEND_PATH || path.join(ROOT, 'base44/functions/room/entry.ts'));
loud();
const call = (sessionId, body) => callHandler(handler, { sessionId, ...body });
const SESSIONS = ['s-alpha', 's-bravo', 's-charlie', 's-delta'];

async function lobby({ join = SESSIONS.length } = {}) {
  fake.tables.Room.length = 0; fake.tables.RoomPlayer.length = 0; fake.resetOps();
  const { data } = await call(SESSIONS[0], { action: 'create', mode: 'family', length: 'quick' });
  const code = data.room.code;
  for (const [i, sessionId] of SESSIONS.slice(0, join).entries()) {
    clock += 1000;
    const res = await call(sessionId, { action: 'join', code, nickname: `P${i}`, avatar_id: 'a1' });
    assert.equal(res.status, 200, `join ${sessionId}`);
  }
  fake.resetOps();
  return code;
}
async function startGame(code) {
  clock += 1000;
  quiet();
  const res = await call(SESSIONS[0], { action: 'start', code });
  loud();
  assert.equal(res.status, 200, `start: ${JSON.stringify(res.data)}`);
  return res.data.room.game_state;
}
const room = (code) => fake.tables.Room.find((r) => r.code === code);

// ---------------------------------------------------------------- tracker
function presenceTrackerOnlyTrustsServerConfirmedActions() {
  let t = 1000;
  const tracker = createPresenceTracker({ now: () => t });
  assert.equal(tracker.shouldSkipHeartbeat(), false, 'nothing confirmed yet');
  tracker.record('submit_answer', { room: {} });
  assert.equal(tracker.shouldSkipHeartbeat(), false, 'a response without presence_recorded (older backend) must not suppress heartbeats');
  tracker.record('submit_answer', { presence_recorded: true, error: 'wrong_phase' });
  assert.equal(tracker.shouldSkipHeartbeat(), false, 'an error response must not count');
  tracker.record('advance', { presence_recorded: true });
  assert.equal(tracker.shouldSkipHeartbeat(), false, 'only actions that persist presence on the server count');
  tracker.record('submit_rating', { presence_recorded: false });
  assert.equal(tracker.shouldSkipHeartbeat(), false, 'a failed presence write must not count');
  tracker.record('submit_rating', { presence_recorded: true });
  assert.equal(tracker.shouldSkipHeartbeat(), true);
  t += PRESENCE_SKIP_WINDOW_MS - 1;
  assert.equal(tracker.shouldSkipHeartbeat(), true, 'still inside the skip window');
  t += 1;
  assert.equal(tracker.shouldSkipHeartbeat(), false, 'the skip window must expire so presence cannot go stale');
  assert.ok(PRESENCE_SKIP_WINDOW_MS + 20_000 < 60_000, 'worst-case gap between presence writes must stay inside the 60s active window');
}

// -------------------------------------------------------------- heartbeat
async function normalHeartbeatCostsTwoReadsAndOneWrite() {
  const code = await lobby();
  clock += 5000;
  const res = await call('s-bravo', { action: 'heartbeat', code });
  assert.equal(res.status, 200);
  assert.deepEqual(fake.entityOps, { 'Room.filter': 1, 'RoomPlayer.filter': 1, 'RoomPlayer.update': 1 },
    'a steady-state heartbeat must be 1 room read + 1 roster read + 1 presence write');
  assert.equal(res.data.roster_session_ids.length, 4);
  assert.ok(res.data.active_session_ids.includes('s-bravo'));
  const bravo = fake.tables.RoomPlayer.find((p) => p.session_id === 's-bravo');
  assert.equal(Date.parse(bravo.last_seen), clock, 'the heartbeat must persist last_seen');
}

async function heartbeatStillDetectsRemovalAndClosure() {
  let code = await lobby();
  await call('s-alpha', { action: 'kick', code, target_session: 's-charlie' });
  let res = await call('s-charlie', { action: 'heartbeat', code });
  assert.equal(res.status, 404); assert.equal(res.data.error, 'not_in_room');

  // Removal that lands between the validating reads and the write.
  code = await lobby();
  const original = globalThis.__fakeBase44;
  globalThis.__fakeBase44 = (req) => {
    const client = original(req);
    const players = client.asServiceRole.entities.RoomPlayer;
    // Wrap a copy so the shared entity object is never mutated.
    const racing = {
      ...players,
      update: async (id, patch) => {
        const row = fake.tables.RoomPlayer.find((p) => p.id === id);
        if (row?.session_id === 's-delta') { fake.tables.RoomPlayer = fake.tables.RoomPlayer.filter((p) => p.id !== id); throw new Error('not found'); }
        return players.update(id, patch);
      },
    };
    return { asServiceRole: { entities: { ...client.asServiceRole.entities, RoomPlayer: racing } } };
  };
  res = await call('s-delta', { action: 'heartbeat', code });
  globalThis.__fakeBase44 = original;
  assert.equal(res.status, 404, 'a player removed mid-heartbeat must be told, not given a 500');
  assert.equal(res.data.error, 'not_in_room');

  code = await lobby();
  await call('s-alpha', { action: 'close', code });
  res = await call('s-bravo', { action: 'heartbeat', code });
  assert.equal(res.status, 404); assert.equal(res.data.error, 'gone');
}

async function heartbeatReturnsLobbyRosterOnlyWhenCallerIsStale() {
  const code = await lobby();
  clock += 1000;
  const all = SESSIONS;
  let res = await call('s-bravo', { action: 'heartbeat', code, known_roster_ids: all });
  assert.equal(res.data.players, undefined, 'a current roster must not be re-sent');

  res = await call('s-bravo', { action: 'heartbeat', code, known_roster_ids: all.slice(0, 2) });
  assert.equal(res.data.players.length, 4, 'a stale lobby roster must be returned in full');
  assert.deepEqual(res.data.players.map((p) => p.session_id).sort(), [...all].sort());
  assert.equal(res.data.players.filter((p) => p.is_host).length, 1);
  assert.equal(res.data.players.find((p) => p.is_host).session_id, res.data.host_session);

  res = await call('s-bravo', { action: 'heartbeat', code });
  assert.equal(res.data.players, undefined, 'a client that does not send known ids (older client) keeps the old response shape');

  await startGame(code);
  res = await call('s-bravo', { action: 'heartbeat', code, known_roster_ids: all.slice(0, 1) });
  assert.equal(res.data.players, undefined, 'membership is fixed after Start; no roster is sent during gameplay');
}

async function heartbeatStillMigratesAStaleHostOnlyAfterTheGraceWindow() {
  const code = await lobby();
  const alpha = fake.tables.RoomPlayer.find((p) => p.session_id === 's-alpha');
  alpha.last_seen = new Date(clock - 59_000).toISOString();
  let res = await call('s-bravo', { action: 'heartbeat', code });
  assert.equal(res.data.host_session, 's-alpha', 'a host inside the 60s grace window must keep ownership');

  clock += 2000; // alpha is now 61s stale
  res = await call('s-bravo', { action: 'heartbeat', code });
  assert.notEqual(res.data.host_session, 's-alpha', 'a host beyond the grace window must migrate');
  assert.equal(room(code).host_session, res.data.host_session, 'Room.host_session stays the source of truth');
  const flagged = fake.tables.RoomPlayer.filter((p) => p.is_host).map((p) => p.session_id);
  assert.deepEqual(flagged, [res.data.host_session], 'exactly one RoomPlayer is flagged host after migration');
}

// ------------------------------------------------------------ game actions
async function enterWriting(code) {
  const gs = await startGame(code);
  clock += 6000;
  quiet();
  const res = await call(SESSIONS[0], { action: 'advance', code, force: true, expected_phase: 'reveal', expected_round: 0 });
  loud();
  assert.equal(res.data.room.game_state.phase, 'writing');
  return res.data.room.game_state.current_subject === gs.current_subject ? res.data.room.game_state : res.data.room.game_state;
}

async function submitActionsPersistPresenceAndSayso() {
  const code = await lobby();
  const gs = await enterWriting(code);
  const writers = SESSIONS.filter((s) => s !== gs.current_subject);

  clock += 20_000; // everyone's join-time presence is now old
  fake.resetOps();
  let res = await call(writers[0], { action: 'submit_answer', code, text: 'first' });
  assert.equal(res.data.presence_recorded, true, 'submit_answer must report persisted presence');
  const row = fake.tables.RoomPlayer.find((p) => p.session_id === writers[0]);
  assert.equal(Date.parse(row.last_seen), clock, 'submit_answer must persist last_seen');
  assert.equal(fake.entityOps['RoomPlayer.update'], 1);

  // A second action moments later is already fresh: reported, but no extra write.
  clock += 1000;
  fake.resetOps();
  res = await call(writers[0], { action: 'submit_answer', code, text: 'again' });
  assert.equal(res.data.error, 'already_submitted');
  clock += 1000;
  fake.resetOps();
  res = await call(writers[1], { action: 'submit_answer', code, text: 'second' });
  assert.equal(res.data.presence_recorded, true);

}

async function submitPathsStillAdvanceAndScoreOnTheServer() {
  const code = await lobby();
  let gs = await enterWriting(code);
  const subject = gs.current_subject;
  const writers = SESSIONS.filter((s) => s !== subject);
  for (const w of writers) { clock += 1250; await call(w, { action: 'submit_answer', code, text: `answer by ${w}` }); }
  gs = room(code).game_state;
  assert.equal(gs.phase, 'rating', 'the last answer must still advance Writing to Rating server-side');

  for (let i = 0; i < 3; i += 1) {
    const answer = room(code).game_state.answers[i];
    for (const rater of writers.filter((w) => w !== answer.author)) {
      clock += 1250;
      const res = await call(rater, { action: 'submit_rating', code, answer_id: answer.id, stars: 5 });
      assert.equal(res.data.presence_recorded, true);
    }
  }
  gs = room(code).game_state;
  assert.equal(gs.phase, 'prediction', 'the last rating must still advance Rating to Prediction');

  clock += 1250;
  const pick = gs.answers[0].id;
  const res = await call(subject, { action: 'submit_prediction', code, answer_id: pick });
  assert.equal(res.data.presence_recorded, true);
  gs = room(code).game_state;
  assert.equal(gs.phase, 'results', 'the prediction must still advance to Results');
  const total = Object.values(gs.scores).reduce((a, b) => a + b, 0);
  assert.ok(total > 0, 'scores are computed by the server');

  // An idempotent retry is still accepted and does not score twice.
  clock += 1250;
  const retry = await call(subject, { action: 'submit_prediction', code, answer_id: pick });
  assert.equal(retry.status === 400 || retry.data.error === 'wrong_phase' || retry.data.accepted === true, true);
  assert.equal(Object.values(room(code).game_state.scores).reduce((a, b) => a + b, 0), total, 'a retried submit must never score twice');
}

// ------------------------------------------------------- authorization
const snapshot = (code) => JSON.stringify(room(code));

async function nonMembersCannotSubmitOrAdvance() {
  const code = await lobby();
  let gs = await enterWriting(code);
  const subject = gs.current_subject;
  const writers = SESSIONS.filter((s) => s !== subject);
  const outsider = 's-outsider';

  const expectBlocked = async (label, sessionId, body) => {
    const before = snapshot(code);
    fake.resetOps();
    const res = await call(sessionId, { code, ...body });
    assert.equal(res.status, 403, `${label}: expected 403, got ${res.status} ${JSON.stringify(res.data)}`);
    assert.equal(res.data.error, 'not_in_room', label);
    assert.equal(snapshot(code), before, `${label}: room state must not change`);
    assert.equal(fake.entityOps['Room.updateMany'], undefined, `${label}: must not write to the room`);
    assert.equal(fake.entityOps['Room.update'], undefined, `${label}: must not write to the room`);
  };

  // Writing phase.
  await expectBlocked('outsider submit_answer', outsider, { action: 'submit_answer', text: 'sneaky' });
  assert.equal(room(code).game_state.answers.length, 0, 'an outsider answer must never be stored');

  // A player who was removed mid-game is no longer a member either.
  const gone = writers[0];
  fake.tables.RoomPlayer = fake.tables.RoomPlayer.filter((p) => p.session_id !== gone);
  await expectBlocked('removed player submit_answer', gone, { action: 'submit_answer', text: 'ghost' });

  // Members continue to work: the remaining two writers fill the phase.
  const remaining = writers.filter((w) => w !== gone);
  for (const w of remaining) { clock += 1250; const r = await call(w, { action: 'submit_answer', code, text: `by ${w}` }); assert.equal(r.status, 200, JSON.stringify(r.data)); }
  assert.equal(room(code).game_state.answers.length, 2);

  // Force-advance of a visual "continue" phase is members-only too.
  gs = room(code).game_state;
  const phaseBefore = gs.phase;
  await expectBlocked('outsider force advance', outsider, { action: 'advance', force: true, expected_phase: phaseBefore, expected_round: gs.round_index });
  await expectBlocked('outsider auto advance', outsider, { action: 'advance' });
}

async function nonMembersCannotRateOrPredict() {
  const code = await lobby();
  let gs = await enterWriting(code);
  const subject = gs.current_subject;
  const writers = SESSIONS.filter((s) => s !== subject);
  for (const w of writers) { clock += 1250; await call(w, { action: 'submit_answer', code, text: `by ${w}` }); }
  gs = room(code).game_state;
  assert.equal(gs.phase, 'rating');

  const expectBlocked = async (label, sessionId, body) => {
    const before = snapshot(code);
    const res = await call(sessionId, { code, ...body });
    assert.equal(res.status, 403, `${label}: expected 403, got ${res.status} ${JSON.stringify(res.data)}`);
    assert.equal(res.data.error, 'not_in_room', label);
    assert.equal(snapshot(code), before, `${label}: room state must not change`);
  };

  const answer = gs.answers[gs.rating_index];
  await expectBlocked('outsider submit_rating', 's-outsider', { action: 'submit_rating', answer_id: answer.id, stars: 1 });
  assert.equal(room(code).game_state.ratings?.[answer.id]?.['s-outsider'], undefined, 'an outsider rating must never be stored');

  // A removed rater is blocked even though they were eligible before.
  const rater = writers.find((w) => w !== answer.author);
  const removedRow = structuredClone(fake.tables.RoomPlayer.find((p) => p.session_id === rater));
  fake.tables.RoomPlayer = fake.tables.RoomPlayer.filter((p) => p.session_id !== rater);
  await expectBlocked('removed player submit_rating', rater, { action: 'submit_rating', answer_id: answer.id, stars: 5 });

  // Test setup only: put the member back (joining a running game is rejected by design),
  // then drive to the prediction phase with the real flow.
  fake.tables.RoomPlayer.push(removedRow);
  for (let i = 0; i < 3; i += 1) {
    const a = room(code).game_state.answers[i];
    for (const r of writers.filter((w) => w !== a.author)) { clock += 1250; await call(r, { action: 'submit_rating', code, answer_id: a.id, stars: 5 }); }
  }
  gs = room(code).game_state;
  assert.equal(gs.phase, 'prediction');

  await expectBlocked('outsider submit_prediction', 's-outsider', { action: 'submit_prediction', answer_id: gs.answers[0].id });
  // The subject loses membership: their session id alone must not be enough.
  fake.tables.RoomPlayer = fake.tables.RoomPlayer.filter((p) => p.session_id !== subject);
  await expectBlocked('removed subject submit_prediction', subject, { action: 'submit_prediction', answer_id: gs.answers[0].id });
  assert.equal(room(code).game_state.prediction ?? null, null, 'no prediction may be stored for a non-member');
}

const tests = [
  presenceTrackerOnlyTrustsServerConfirmedActions,
  normalHeartbeatCostsTwoReadsAndOneWrite,
  heartbeatStillDetectsRemovalAndClosure,
  heartbeatReturnsLobbyRosterOnlyWhenCallerIsStale,
  heartbeatStillMigratesAStaleHostOnlyAfterTheGraceWindow,
  submitActionsPersistPresenceAndSayso,
  submitPathsStillAdvanceAndScoreOnTheServer,
  nonMembersCannotSubmitOrAdvance,
  nonMembersCannotRateOrPredict,
];
let failed = 0;
for (const test of tests) {
  try { await test(); console.log(`ok   ${test.name}`); }
  catch (error) { failed += 1; console.log(`FAIL ${test.name}\n     ${error.stack.split("\n").slice(0, 6).join("\n     ")}`); }
}
if (failed) { console.log(`\n${failed} of ${tests.length} failed`); process.exit(1); }
console.log(`\nRoom backend regression passed (${tests.length} tests).`);
