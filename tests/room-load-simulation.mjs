/**
 * Offline four-player load simulation for the room backend.
 *
 * The REAL base44/functions/room/entry.ts handler runs against an in-memory
 * stand-in for the Base44 SDK, on a simulated clock. Nothing touches the live
 * backend. Every function invocation and every entity operation is counted.
 *
 * What is exact: the server-side request handling and entity-op counts.
 * What is modelled: the browser clients. Their request schedule (heartbeat
 * timers, lobby sync, scripted answers/ratings with the same 1.25s pacing as
 * tests/multiplayer-smoke.mjs, host-driven advances) follows the logic in
 * src/game/GameContext.jsx, and the heartbeat-skip decision uses the real
 * src/game/presenceTracker.js. It is not the React app itself.
 *
 * Usage:
 *   node tests/room-load-simulation.mjs                      # current backend + current client
 *   node tests/room-load-simulation.mjs --backend=/tmp/baseline/base44/functions/room/entry.ts --client=baseline
 *   add --json to print machine-readable output; --length=quick|standard
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPresenceTracker } from '../src/game/presenceTracker.js';
import { createFakeBase44, loadRoomHandler } from './support/fake-base44.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const BACKEND = path.resolve(args.backend || path.join(ROOT, 'base44/functions/room/entry.ts'));
const CLIENT = args.client === 'baseline' ? 'baseline' : 'current';
const LENGTH = args.length || 'quick';
const AS_JSON = Boolean(args.json);

// ---------- simulated clock ----------
let simNow = Date.parse('2026-10-14T10:00:00.000Z');
Date.now = () => simNow;

// ---------- in-memory Base44 (real handler, fake SDK) ----------
const fake = createFakeBase44({ now: () => simNow });
const { tables, entityOps, presenceWrites } = fake;

// Prompt pool logging is noise for this measurement.
const realConsole = { log: console.log, error: console.error, warn: console.warn };
console.log = () => {}; console.error = () => {}; console.warn = () => {};

const handler = await loadRoomHandler(BACKEND);

// ---------- invocation log ----------
const invocations = [];
async function invoke(player, body) {
  invocations.push({ t: simNow, player: player.name, action: body.action });
  const needsCapability = body.code && body.action !== 'lookup' && body.action !== 'create';
  const payload = {
    sessionId: player.sid,
    ...body,
    ...(needsCapability && !Object.hasOwn(body, 'membership_capability') && player.capability
      ? { membership_capability: player.capability }
      : {}),
  };
  const req = new Request('http://local/functions/room', { method: 'POST', body: JSON.stringify(payload) });
  const res = await handler(req);
  const data = await res.json().catch(() => ({}));
  const outcome = { status: res.status, data };
  if (res.status >= 500 && !data.room) failures.push({ t: simNow, player: player.name, action: body.action, error: data.error });
  return outcome;
}
const failures = [];

// ---------- event scheduler ----------
const queue = [];
let seq = 0;
const at = (t, fn) => queue.push({ t, seq: seq++, fn });
const after = (ms, fn) => at(simNow + ms, fn);
async function run(untilMs) {
  while (queue.length) {
    queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
    const ev = queue.shift();
    if (ev.t > untilMs) break;
    simNow = Math.max(simNow, ev.t);
    await ev.fn();
  }
}

// ---------- modelled clients ----------
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
const HEARTBEAT_MS = 20000;
const HEARTBEAT_STAGGER_MS = 2000;
const LOBBY_SYNC_INITIAL_MS = 5000;
const LOBBY_SYNC_MS = 10000;
const ROSTER_DEBOUNCE_MS = 400;
const ROSTER_MIN_INTERVAL_MS = 2000;
const PACE_MS = Number(args.pace) || 1250;

const players = NAMES.map((name, idx) => ({
  idx, name, sid: `sess-${name.toLowerCase()}-${1000 + idx * 7}`,
  capability: '',
  known: new Set(), status: 'lobby', joinedAt: null, lastRosterAt: -1e9,
  rosterTimer: false, tracker: createPresenceTracker({ now: () => simNow }),
  skippedHeartbeats: 0,
}));
const host = players[0];
let code = '';
const roomRow = () => tables.Room.find((r) => r.code === code);

async function fetchRoster(p) {
  p.lastRosterAt = simNow;
  const { data } = await invoke(p, { action: 'getRoster', code });
  if (Array.isArray(data.players)) p.known = new Set(data.players.map((x) => x.session_id));
}
// Debounced + min-interval roster refresh, as in GameContext.refreshPlayers/fetchRoster.
function refreshPlayers(p) {
  if (p.rosterTimer || p.status === 'playing') return;
  p.rosterTimer = true;
  const wait = Math.max(ROSTER_DEBOUNCE_MS, p.lastRosterAt + ROSTER_MIN_INTERVAL_MS - simNow);
  after(wait, async () => { p.rosterTimer = false; if (p.status !== 'playing') await fetchRoster(p); });
}

function startClientTimers(p) {
  // First heartbeat deferred by one interval plus a deterministic stagger.
  const offset = [...p.sid].reduce((s, c) => s + c.charCodeAt(0), 0) % HEARTBEAT_STAGGER_MS;
  const beat = async () => {
    if (finished) return;
    if (CLIENT === 'current' && p.tracker.shouldSkipHeartbeat()) {
      p.skippedHeartbeats += 1;
    } else {
      const body = { action: 'heartbeat', code };
      if (CLIENT === 'current') body.known_roster_ids = [...p.known];
      const { data } = await invoke(p, body);
      const remote = new Set(data.roster_session_ids || []);
      const changed = remote.size !== p.known.size || [...remote].some((id) => !p.known.has(id));
      if (changed && p.status === 'lobby') {
        if (CLIENT === 'current' && Array.isArray(data.players)) p.known = new Set(data.players.map((x) => x.session_id));
        else refreshPlayers(p);
      }
    }
    after(HEARTBEAT_MS, beat);
  };
  after(HEARTBEAT_MS + offset, beat);
  if (p === host) {
    const lobbySync = async () => {
      if (p.status !== 'lobby' || finished) return;
      refreshPlayers(p);
      after(LOBBY_SYNC_MS, lobbySync);
    };
    after(LOBBY_SYNC_INITIAL_MS, lobbySync);
  }
}

async function call(p, action, extra = {}) {
  const out = await invoke(p, { action, code, ...extra });
  if (CLIENT === 'current') p.tracker.record(action, out.data);
  return out;
}

// ---------- lobby script ----------
let finished = false;
async function joinPlayer(p) {
  const { data } = await invoke(p, { action: 'join', code, nickname: p.name, avatar_id: 'a1', photo_url: '' });
  assert(data.room, `${p.name} join failed: ${JSON.stringify(data)}`);
  assert.equal(typeof data.membership_capability, 'string', `${p.name} must receive its server-issued membership capability`);
  p.capability = data.membership_capability;
  p.joinedAt = simNow;
  p.known = new Set((data.players || [data.player]).map((x) => x.session_id));
  startClientTimers(p);
}
{
  const { data } = await invoke(host, { action: 'create', mode: 'family', length: LENGTH });
  code = data.room.code;
  assert.equal(typeof data.membership_capability, 'string', 'creator must receive a pending-room capability');
  host.capability = data.membership_capability;
  await invoke(host, { action: 'config', code, mode: 'family', length: LENGTH });
  at(simNow + 500, () => joinPlayer(host));
  players.slice(1).forEach((p, i) => {
    const lookupAt = simNow + 3000 + i * 3000;
    at(lookupAt, () => invoke(p, { action: 'lookup', code }));
    at(lookupAt + 4000, () => joinPlayer(p));
  });
}
// Host presses Start once its own roster shows four players.
let startQueued = false;
const startWatcher = async () => {
  if (finished || startQueued) return;
  if (host.known.size >= 4) {
    startQueued = true;
    after(1000, async () => {
      await invoke(host, { action: 'start', code });
      players.forEach((p) => after(300, () => { p.status = 'playing'; }));
    });
    return;
  }
  after(500, startWatcher);
};
after(500, startWatcher);

// ---------- gameplay driver (reacts to authoritative room state) ----------
const handled = new Set();
const ONCE = (key, fn) => { if (handled.has(key)) return; handled.add(key); fn(); };
let roundsSeen = 0;
const driver = async () => {
  if (finished) return;
  const room = roomRow();
  const gs = room?.game_state;
  if (room?.status === 'playing' && gs) {
    const base = `${gs.round_index}:${gs.phase}`;
    const subject = players.find((p) => p.sid === gs.current_subject);
    const others = players.filter((p) => p !== subject);
    const expect = { expected_phase: gs.phase, expected_deadline: gs.phase_deadline, expected_round: gs.round_index };
    if (gs.phase === 'finished') { finished = true; return; }
    if (gs.phase === 'reveal') ONCE(base, () => {
      roundsSeen += 1;
      at(Date.parse(gs.phase_deadline) + 50, async () => {
        const cur = roomRow()?.game_state;
        if (cur?.phase === 'reveal' && cur.round_index === gs.round_index) await call(host, 'advance', expect);
      });
    });
    if (gs.phase === 'writing') ONCE(base, () => others.forEach((p, k) => {
      after(2000 + k * PACE_MS, () => call(p, 'submit_answer', { text: `Review from ${p.name} r${gs.round_index}` }));
    }));
    if (gs.phase === 'rating') {
      const answer = (gs.answers || [])[gs.rating_index];
      ONCE(`${base}:${gs.rating_index}`, () => {
        const raters = others.filter((p) => p.sid !== answer?.author);
        raters.forEach((p, k) => after(1500 + k * PACE_MS, () => call(p, 'submit_rating', { answer_id: answer.id, stars: 5 })));
        at(Date.parse(gs.phase_deadline) + 50, async () => {
          const cur = roomRow()?.game_state;
          if (cur?.phase === 'rating' && cur.rating_index === gs.rating_index && cur.round_index === gs.round_index) await call(host, 'advance', { ...expect, expected_deadline: gs.phase_deadline });
        });
      });
    }
    if (gs.phase === 'prediction') ONCE(base, () => {
      after(2000, () => call(subject, 'submit_prediction', { answer_id: gs.answers[0].id }));
    });
    if (gs.phase === 'results') ONCE(base, () => after(6000, () => call(host, 'advance', { force: true, ...expect })));
    if (gs.phase === 'leaderboard') ONCE(base, () => after(3000, () => call(host, 'advance', { force: true, ...expect })));
  }
  after(250, driver);
};
after(250, driver);

// ---------- run ----------
const MAX_SIM_MS = 3 * 60 * 60 * 1000;
const t0 = simNow;
await run(t0 + MAX_SIM_MS);
Object.assign(console, realConsole);

// ---------- report ----------
const finalRoom = roomRow();
assert.equal(finalRoom?.game_state?.phase, 'finished', `game did not finish (phase=${finalRoom?.game_state?.phase})`);
const gs = finalRoom.game_state;

const times = invocations.map((i) => i.t);
const peak = (windowMs) => {
  let best = 0; let bestAt = 0;
  for (let i = 0; i < times.length; i += 1) {
    let n = 0;
    for (let j = i; j < times.length && times[j] - times[i] < windowMs; j += 1) n += 1;
    if (n > best) { best = n; bestAt = times[i]; }
  }
  return { count: best, atSecond: Math.round((bestAt - t0) / 1000) };
};
const byAction = {};
invocations.forEach((i) => { byAction[i.action] = (byAction[i.action] || 0) + 1; });
const totalOps = Object.values(entityOps).reduce((a, b) => a + b, 0);

// Longest gap between presence writes for each player while the game ran.
const endAt = Math.max(...times);
const maxPresenceGapMs = {};
players.forEach((p) => {
  const stamps = [...(presenceWrites.get(p.sid) || []), endAt].sort((a, b) => a - b);
  let gap = 0;
  for (let i = 1; i < stamps.length; i += 1) gap = Math.max(gap, stamps[i] - stamps[i - 1]);
  maxPresenceGapMs[p.name] = gap;
});

const report = {
  backend: path.relative(ROOT, BACKEND) || BACKEND,
  client: CLIENT,
  length: LENGTH,
  roundsPlayed: roundsSeen,
  simulatedGameSeconds: Math.round((endAt - t0) / 1000),
  invocations: { total: invocations.length, byAction: Object.fromEntries(Object.entries(byAction).sort()) },
  peakInvocations: { in20s: peak(20000), in30s: peak(30000) },
  entityOps: { total: totalOps, byOperation: Object.fromEntries(Object.entries(entityOps).sort()) },
  skippedHeartbeats: players.reduce((n, p) => n + p.skippedHeartbeats, 0),
  maxPresenceGapSeconds: Object.fromEntries(Object.entries(maxPresenceGapMs).map(([k, v]) => [k, Math.round(v / 1000)])),
  unexpectedFailures: failures,
  finalScores: Object.fromEntries(players.map((p) => [p.name, gs.scores[p.sid]])),
};

// Safety assertions: the optimisations must never let a player look inactive.
for (const [name, gap] of Object.entries(maxPresenceGapMs)) {
  assert(gap < 60000, `${name} had a ${Math.round(gap / 1000)}s gap between presence writes (must stay under the 60s active window)`);
}
assert.equal(failures.length, 0, `unexpected 5xx responses: ${JSON.stringify(failures)}`);

if (args.dump) {
  const [from, to] = String(args.dump).split('-').map(Number);
  invocations.filter((i) => (i.t - t0) / 1000 >= from && (i.t - t0) / 1000 <= to)
    .forEach((i) => console.log(`${String(((i.t - t0) / 1000).toFixed(1)).padStart(6)}s  ${i.player.padEnd(8)} ${i.action}`));
}
if (AS_JSON) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Backend: ${report.backend}  Client model: ${report.client}  Length: ${report.length}`);
  console.log(`Rounds: ${report.roundsPlayed}  Simulated game time: ${report.simulatedGameSeconds}s`);
  console.log(`Room-function invocations: ${report.invocations.total}`, report.invocations.byAction);
  console.log(`Peak invocations in any 20s window: ${report.peakInvocations.in20s.count} (starting ${report.peakInvocations.in20s.atSecond}s in)`);
  console.log(`Peak invocations in any 30s window: ${report.peakInvocations.in30s.count} (starting ${report.peakInvocations.in30s.atSecond}s in)`);
  console.log(`Entity operations: ${report.entityOps.total}`, report.entityOps.byOperation);
  console.log(`Heartbeats skipped by client: ${report.skippedHeartbeats}`);
  console.log(`Max gap between presence writes (s):`, report.maxPresenceGapSeconds);
  console.log(`Final scores:`, report.finalScores);
}
