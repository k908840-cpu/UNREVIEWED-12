import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { makeCode, normalizeCode, MAX_PLAYERS, MIN_PLAYERS, HOST_MIGRATION_GRACE_MS, isActive, activePlayers, selectActiveHost } from '../../shared/rooms.ts';
import { BACKEND_BUILD_ID, BACKEND_BUILD_HEADER } from '../../shared/build.ts';
import { PHASE_DURATIONS, LENGTH_CYCLES, buildSubjectOrder, selectPrompt, tryAdvance, doAdvance, matchesAdvanceExpectation } from '../../shared/game.ts';

const LENGTHS = ['quick', 'standard', 'party', 'endless'];
const rid = () => Math.random().toString(36).slice(2, 9);
const CAPABILITY_BYTES = 32;
const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Room session ids identify a local browser for display/reconnection only.
// They are intentionally not credentials: every membership operation below
// also requires one of these server-issued, 256-bit capabilities. The stored
// value is a SHA-256 verifier, never the bearer capability itself.
const capabilityFromBody = (value: unknown) => {
  const capability = typeof value === 'string' ? value : '';
  return CAPABILITY_PATTERN.test(capability) ? capability : '';
};
const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const makeCapability = () => {
  const bytes = new Uint8Array(CAPABILITY_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};
const capabilityHash = async (capability: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(capability));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
};
// Compare fixed-size hex digests without returning early. This does not turn
// a browser capability into a user account, but avoids making the verifier a
// byte-at-a-time oracle.
const hashesMatch = (stored: unknown, supplied: string) => {
  if (typeof stored !== 'string' || stored.length !== supplied.length) return false;
  let difference = 0;
  for (let index = 0; index < stored.length; index += 1) difference |= stored.charCodeAt(index) ^ supplied.charCodeAt(index);
  return difference === 0;
};

// Authoritative room + game endpoint. Clients never write room/player records
// directly; every mutation is validated here against an opaque server-issued
// membership capability and, where needed, the room's stored host_session.
// All round state is authoritative — clients render shared state, they never
// generate their own.
async function handle(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) return Response.json({ error: 'missing_session' }, { status: 400 });
    const suppliedCapability = capabilityFromBody(body.membership_capability);
    const suppliedCapabilityHash = suppliedCapability ? await capabilityHash(suppliedCapability) : '';

    const Room = base44.asServiceRole.entities.Room;
    const Player = base44.asServiceRole.entities.RoomPlayer;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    const findRoom = async (raw) => {
      const code = normalizeCode(raw);
      if (!code) return null;
      const list = await Room.filter({ code });
      return list[0] || null;
    };
    const playersOf = async (code) => await Player.filter({ room_code: code });
    // Keep internal capability verifiers out of every response, including
    // create/join responses, lookup, and game action reconciliation payloads.
    const displayRoom = (room) => {
      if (!room) return room;
      const { creator_capability_hash: _creatorCapabilityHash, ...safeRoom } = room;
      return safeRoom;
    };
    // A game action proves the player is connected. Persisting that lets the
    // client skip a redundant standalone heartbeat invocation. Reports whether
    // a fresh presence record is stored; the client only skips heartbeats when
    // it is told so (presence_recorded), so an undeployed backend or a failed
    // write simply keeps the normal heartbeat cadence.
    const PRESENCE_REFRESH_MS = 5000;
    const refreshPresence = async (players) => {
      const me = players.find((p) => p.session_id === sessionId);
      if (!me) return false;
      const age = now - (Date.parse(me.last_seen || '') || 0);
      if (me.connected !== false && age >= 0 && age < PRESENCE_REFRESH_MS) return true;
      try {
        await Player.update(me.id, { connected: true, last_seen: nowIso });
        return true;
      } catch {
        return false;
      }
    };
    const displayRoster = (players) => players.map((p) => ({
      session_id: p.session_id, nickname: p.nickname, avatar_id: p.avatar_id,
      photo_url: p.photo_url, is_host: p.is_host, connected: p.connected, last_seen: p.last_seen,
    }));
    const membershipError = async (players) => {
      const me = players.find((p) => p.session_id === sessionId);
      if (!me) return { error: 'not_in_room', status: 403, player: null };
      if (!suppliedCapability) return { error: 'missing_membership_capability', status: 401, player: null };
      // No session-id-only migration path exists. A seat created before this
      // deployment must expire or be left by a client that still holds a
      // capability; issuing one merely from a known session id would preserve
      // the impersonation flaw this change removes.
      if (!me.membership_capability_hash) return { error: 'legacy_membership', status: 409, player: null };
      if (!hashesMatch(me.membership_capability_hash, suppliedCapabilityHash)) {
        return { error: 'invalid_membership_capability', status: 403, player: null };
      }
      return { error: '', status: 200, player: me };
    };
    const requireMembership = async (players) => {
      const result = await membershipError(players);
      if (result.error) return { result, response: Response.json({ error: result.error }, { status: result.status }) };
      return { result, response: null };
    };
    const creatorCapabilityMatches = (room) => (
      !!suppliedCapabilityHash
      && !!room?.creator_capability_hash
      && hashesMatch(room.creator_capability_hash, suppliedCapabilityHash)
    );
    switch (action) {
      case 'create': {
        let code = makeCode();
        for (let attempt = 0; attempt < 12; attempt++) {
          const clash = await Room.filter({ code });
          if (!clash.length) break;
          code = makeCode();
        }
        const creatorCapability = makeCapability();
        const room = await Room.create({
          code,
          status: 'lobby',
          mode: body.mode === 'adult' ? 'adult' : 'family',
          length: LENGTHS.includes(body.length) ? body.length : 'standard',
          host_session: sessionId,
          creator_capability_hash: await capabilityHash(creatorCapability),
          max_players: MAX_PLAYERS,
        });
        // The host needs this capability to configure its pending room before
        // Profile Setup creates the first RoomPlayer record. It is sent once,
        // to the creating browser only, and is never stored in a response
        // object or entity readable by other clients.
        return Response.json({ room: displayRoom(room), membership_capability: creatorCapability });
      }

      case 'lookup': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.status === 'closed') return Response.json({ error: 'closed' }, { status: 410 });
        // No RoomPlayer read: the client only needs joinability here. Return
        // no host session, game state, or capability verifier before join.
        return Response.json({ room: {
          code: room.code, status: room.status, mode: room.mode,
          length: room.length, max_players: room.max_players,
        }, build: BACKEND_BUILD_ID });
      }

      // Server-authoritative roster fetch. Clients never read RoomPlayer
      // directly; this validates room existence + caller membership and
      // returns only the display fields needed by the lobby/game UI.
      case 'getRoster': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.status === 'closed') return Response.json({ error: 'closed' }, { status: 410 });
        const players = await playersOf(room.code);
        const { response } = await requireMembership(players);
        if (response) return response;
        return Response.json({ room: displayRoom(room), players: displayRoster(players), build: BACKEND_BUILD_ID });
      }

      case 'join': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.status === 'closed') return Response.json({ error: 'closed' }, { status: 410 });
        if (room.status !== 'lobby') return Response.json({ error: 'in_progress' }, { status: 409 });
        const nickname = String(body.nickname || '').slice(0, 24).trim() || 'Player';
        const avatarId = String(body.avatar_id || '').slice(0, 24);
        const photo = typeof body.photo_url === 'string' && body.photo_url.length < 120000 ? body.photo_url : '';
        const players = await playersOf(room.code);
        const existing = players.find((p) => p.session_id === sessionId);
        if (existing) {
          const { response } = await requireMembership(players);
          if (response) return response;
          const player = await Player.update(existing.id, {
            nickname, avatar_id: avatarId, photo_url: photo, connected: true, last_seen: nowIso,
            is_host: room.host_session === sessionId,
          });
          return Response.json({ room: displayRoom(room), player: displayRoster([player])[0], players: displayRoster(players.map((p) => p.id === player.id ? player : p)), build: BACKEND_BUILD_ID });
        }
        if (activePlayers(players, now).length >= (room.max_players || MAX_PLAYERS)) {
          return Response.json({ error: 'full' }, { status: 409 });
        }
        let membershipCapability = suppliedCapability;
        let membershipCapabilityHash = suppliedCapabilityHash;
        if (room.host_session === sessionId) {
          if (!creatorCapabilityMatches(room)) return Response.json({ error: suppliedCapability ? 'invalid_membership_capability' : 'missing_membership_capability' }, { status: suppliedCapability ? 403 : 401 });
        } else {
          // Join capabilities are generated here, after capacity validation.
          // A caller cannot select or recycle a token for another player.
          membershipCapability = makeCapability();
          membershipCapabilityHash = await capabilityHash(membershipCapability);
        }
        const player = await Player.create({
          room_code: room.code, session_id: sessionId, nickname, avatar_id: avatarId, photo_url: photo,
          membership_capability_hash: membershipCapabilityHash,
          is_host: room.host_session === sessionId, connected: true, last_seen: nowIso,
        });
        // The joining browser needs an authoritative lobby snapshot
        // immediately. Returning it with join avoids an additional getRoster
        // request from every browser during a multi-player join burst.
        return Response.json({ room: displayRoom(room), player: displayRoster([player])[0], players: displayRoster([...players, player]), membership_capability: membershipCapability, build: BACKEND_BUILD_ID });
      }

      case 'heartbeat': {
        const room = await findRoom(body.code);
        if (!room || room.status === 'closed') return Response.json({ error: 'gone' }, { status: 404 });
        const players = await playersOf(room.code);
        const membership = await membershipError(players);
        const me = membership.player;
        if (!me) return Response.json(
          { error: membership.error },
          { status: membership.error === 'not_in_room' ? 404 : membership.status },
        );

        // Common path: 2 reads + 1 write. Membership and room status were
        // validated by the reads immediately above, so the write is not
        // followed by a second room+roster read. If the player was removed or
        // the room closed in the meantime, the update fails (or returns
        // nothing); only then is the state re-read to report the right error.
        let written = null;
        try {
          written = await Player.update(me.id, { connected: true, last_seen: nowIso });
        } catch (error) {
          written = null;
          const recheckRoom = await findRoom(room.code);
          if (!recheckRoom || recheckRoom.status === 'closed') return Response.json({ error: 'gone' }, { status: 404 });
          const recheckPlayers = await playersOf(recheckRoom.code);
          if (!recheckPlayers.some((p) => p.session_id === sessionId)) {
            return Response.json({ error: 'not_in_room' }, { status: 404 });
          }
          throw error;
        }
        if (!written) {
          const recheckRoom = await findRoom(room.code);
          if (!recheckRoom || recheckRoom.status === 'closed') return Response.json({ error: 'gone' }, { status: 404 });
          return Response.json({ error: 'not_in_room' }, { status: 404 });
        }

        const freshPlayers = players.map((player) => player.id === me.id
          ? { ...player, connected: true, last_seen: nowIso }
          : player);
        let hostSession = room.host_session;
        const currentHost = freshPlayers.find((p) => p.session_id === hostSession);
        if (!isActive(currentHost, now, HOST_MIGRATION_GRACE_MS)) {
          const next = selectActiveHost(freshPlayers, now, HOST_MIGRATION_GRACE_MS);
          if (next && next.session_id !== hostSession) {
            // Concurrent stale-host heartbeats select the same deterministic
            // replacement. Room.host_session remains the source of truth.
            await Room.update(room.id, { host_session: next.session_id });
            hostSession = next.session_id;
          }
        }

        if (hostSession !== room.host_session) {
          const newHost = freshPlayers.find((p) => p.session_id === hostSession);
          if (newHost && !newHost.is_host) await Player.update(newHost.id, { is_host: true });
          const stale = freshPlayers.find((p) => p.is_host && p.session_id !== hostSession);
          if (stale) await Player.update(stale.id, { is_host: false });
        }

        const rosterIds = freshPlayers.map((p) => p.session_id);
        const response: Record<string, unknown> = {
          ok: true,
          build: BACKEND_BUILD_ID,
          host_session: hostSession,
          active_session_ids: activePlayers(freshPlayers, now).map((p) => p.session_id),
          roster_session_ids: rosterIds,
        };
        // Lobby only: when the caller says which members it already knows and
        // that differs from the server, return the roster now. The client can
        // apply it directly instead of sending a follow-up getRoster request.
        // Nothing is added when the caller's roster is current, so steady-state
        // heartbeats stay small.
        if (room.status === 'lobby' && Array.isArray(body.known_roster_ids)) {
          const known = new Set(body.known_roster_ids.filter((id) => typeof id === 'string').slice(0, 64));
          const differs = known.size !== rosterIds.length || rosterIds.some((id) => !known.has(id));
          if (differs) {
            response.players = displayRoster(freshPlayers.map((p) => ({ ...p, is_host: p.session_id === hostSession })));
          }
        }
        return Response.json(response);
      }

      case 'leave': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ ok: true });
        const players = await playersOf(room.code);
        const membership = await membershipError(players);
        const me = membership.player;
        if (!me) return Response.json({ error: membership.error }, { status: membership.status });
        await Player.delete(me.id);
        const remaining = players.filter((p) => p.id !== me.id);
        if (room.host_session === sessionId) {
          const next = selectActiveHost(remaining, now);
          if (next) {
            await Room.update(room.id, { host_session: next.session_id });
            await Player.update(next.id, { is_host: true });
          } else {
            await Room.update(room.id, { status: 'closed' });
            // A room with no active successor cannot be resumed. Remove
            // only this room's remaining stale memberships so closed rooms
            // do not leave a misleading roster behind.
            await Player.deleteMany({ room_code: room.code });
          }
        }
        return Response.json({ ok: true });
      }

      case 'kick': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        const players = await playersOf(room.code);
        const { result: membership, response } = await requireMembership(players);
        if (response) return response;
        if (room.host_session !== membership.player?.session_id) return Response.json({ error: 'forbidden' }, { status: 403 });
        const target = String(body.target_session || '');
        const victim = players.find((p) => p.session_id === target);
        if (victim) await Player.delete(victim.id);
        return Response.json({ ok: true });
      }

      case 'config': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.status !== 'lobby') return Response.json({ error: 'in_progress' }, { status: 409 });
        const players = await playersOf(room.code);
        // Hosts configure a just-created room before Profile Setup has added
        // the first RoomPlayer. Afterwards config requires the same verified
        // membership capability as every other host operation.
        if (room.host_session !== sessionId) return Response.json({ error: 'forbidden' }, { status: 403 });
        if (players.some((p) => p.session_id === sessionId)) {
          const { response } = await requireMembership(players);
          if (response) return response;
        } else if (!creatorCapabilityMatches(room)) {
          return Response.json({ error: suppliedCapability ? 'invalid_membership_capability' : 'missing_membership_capability' }, { status: suppliedCapability ? 403 : 401 });
        }
        const patch = {};
        if (body.mode === 'family' || body.mode === 'adult') patch.mode = body.mode;
        if (LENGTHS.includes(body.length)) patch.length = body.length;
        const updated = await Room.update(room.id, patch);
        return Response.json({ room: displayRoom(updated) });
      }

      case 'start': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        const players = await playersOf(room.code);
        const { result: membership, response } = await requireMembership(players);
        if (response) return response;
        if (room.host_session !== membership.player?.session_id) return Response.json({ error: 'forbidden' }, { status: 403 });
        if (room.status === 'playing' && room.game_state) return Response.json({ room: displayRoom(room) });
        const active = activePlayers(players, now);
        if (active.length < MIN_PLAYERS) {
          return Response.json({ error: 'not_enough_players', active: active.length }, { status: 409 });
        }
        const playerIds = active.map((p) => p.session_id);
        const cycles = LENGTH_CYCLES[room.length] || 4;
        const subjectOrder = buildSubjectOrder(playerIds, cycles);
        const firstSubject = subjectOrder[0];
        const prompt = await selectPrompt(base44, room.mode, [], null, []);
        const gameState = {
          status: 'playing', mode: room.mode, length: room.length, cycles,
          round_index: 0, subject_order: subjectOrder, current_subject: firstSubject,
          current_prompt: { id: prompt.id, text: prompt.text, category: prompt.category },
          phase: 'reveal',
          phase_deadline: new Date(now + PHASE_DURATIONS.reveal * 1000).toISOString(),
          phase_duration: PHASE_DURATIONS.reveal,
          answers: [], rating_index: 0, ratings: {}, prediction: null, results: null,
          scores: Object.fromEntries(playerIds.map((id) => [id, 0])),
          used_prompts: [prompt.id],
          subject_categories: { [firstSubject]: [prompt.category] },
          round_history: [], started_at: nowIso,
        };
        const updated = await Room.update(room.id, { status: 'playing', game_state: gameState });
        return Response.json({ room: displayRoom(updated) });
      }

      case 'submit_answer': {
        const room = await findRoom(body.code);
        if (!room || room.status !== 'playing') return Response.json({ error: 'not_found' }, { status: 404 });
        // Authorization: only a current member of this room may act. The roster
        // is read before any write (it is also the eligibility/presence read the
        // later steps use, so this adds no extra request).
        const players = await playersOf(room.code);
        const { response } = await requireMembership(players);
        if (response) return response;
        const gs = room.game_state;
        if (!gs || gs.phase !== 'writing') return Response.json({ error: 'wrong_phase' }, { status: 400 });
        if (sessionId === gs.current_subject) return Response.json({ error: 'is_subject' }, { status: 403 });
        const text = String(body.text || '').slice(0, 80).trim();
        if (!text) return Response.json({ error: 'empty' }, { status: 400 });
        const answers = gs.answers || [];
        if (answers.some((a) => a.author === sessionId)) return Response.json({ error: 'already_submitted' }, { status: 409 });
        const newAnswer = { id: rid(), author: sessionId, text };
        await Room.updateMany({ id: room.id }, { $push: { 'game_state.answers': newAnswer } });
        const updated = await findRoom(room.code);
        const presenceRecorded = await refreshPresence(players);
        const refreshed = players.map((p) => p.session_id === sessionId ? { ...p, last_seen: nowIso, connected: true } : p);
        const reRoom = await tryAdvance(base44, Room, updated, refreshed, now);
        return Response.json({ room: displayRoom(reRoom), presence_recorded: presenceRecorded });
      }

      case 'submit_rating': {
        const room = await findRoom(body.code);
        if (!room || room.status !== 'playing') return Response.json({ error: 'not_found' }, { status: 404 });
        // Authorization: only a current member of this room may act. The roster
        // is read before any write (it is also the eligibility/presence read the
        // later steps use, so this adds no extra request).
        const players = await playersOf(room.code);
        const { response } = await requireMembership(players);
        if (response) return response;
        const gs = room.game_state;
        if (!gs || gs.phase !== 'rating') return Response.json({ error: 'wrong_phase' }, { status: 400 });
        const answerId = String(body.answer_id || '');
        const stars = Math.max(1, Math.min(5, Math.round(Number(body.stars) || 0)));
        if (stars < 1 || stars > 5) return Response.json({ error: 'invalid_rating' }, { status: 400 });
        const currentAnswer = (gs.answers || [])[gs.rating_index];
        if (!currentAnswer || currentAnswer.id !== answerId) return Response.json({ error: 'not_current_answer' }, { status: 400 });
        if (sessionId === gs.current_subject) return Response.json({ error: 'is_subject' }, { status: 403 });
        if (sessionId === currentAnswer.author) return Response.json({ error: 'is_author' }, { status: 403 });
        const ratings = gs.ratings || {};
        const answerRatings = ratings[answerId] || {};
        if (answerRatings[sessionId] !== undefined) return Response.json({ error: 'already_rated' }, { status: 409 });
        const ratingKey = `game_state.ratings.${answerId}.${sessionId}`;
        await Room.updateMany({ id: room.id }, { $set: { [ratingKey]: stars } });
        const updated = await findRoom(room.code);
        const presenceRecorded = await refreshPresence(players);
        const refreshed = players.map((p) => p.session_id === sessionId ? { ...p, last_seen: nowIso, connected: true } : p);
        const reRoom = await tryAdvance(base44, Room, updated, refreshed, now);
        return Response.json({ room: displayRoom(reRoom), presence_recorded: presenceRecorded });
      }

      case 'submit_prediction': {
        const room = await findRoom(body.code);
        if (!room || room.status !== 'playing') return Response.json({ error: 'not_found' }, { status: 404 });
        // Authorization: only a current member of this room may act. The roster
        // is read before any write (it is also the eligibility/presence read the
        // later steps use, so this adds no extra request).
        const players = await playersOf(room.code);
        const { response } = await requireMembership(players);
        if (response) return response;
        const gs = room.game_state;
        if (!gs || gs.phase !== 'prediction') return Response.json({ error: 'wrong_phase' }, { status: 400 });
        if (sessionId !== gs.current_subject) return Response.json({ error: 'not_subject' }, { status: 403 });
        const answerId = String(body.answer_id || '');
        if (!(gs.answers || []).some((a) => a.id === answerId)) return Response.json({ error: 'invalid_answer' }, { status: 400 });
        // A lost response can make the subject safely retry the same choice.
        // It is accepted idempotently, but never runs scoring/advancement a
        // second time. A different second choice remains forbidden.
        if (gs.prediction) {
          if (gs.prediction === answerId) return Response.json({ room: displayRoom(room), accepted: true, already_predicted: true });
          return Response.json({ room: displayRoom(room), error: 'already_predicted' }, { status: 409 });
        }
        await Room.updateMany({ id: room.id }, { $set: { 'game_state.prediction': answerId } });
        const updated = await findRoom(room.code);
        const presenceRecorded = await refreshPresence(players);
        const refreshed = players.map((p) => p.session_id === sessionId ? { ...p, last_seen: nowIso, connected: true } : p);
        const reRoom = await tryAdvance(base44, Room, updated, refreshed, now);
        return Response.json({ room: displayRoom(reRoom), presence_recorded: presenceRecorded });
      }

      case 'advance': {
        const room = await findRoom(body.code);
        if (!room || room.status !== 'playing') return Response.json({ error: 'not_found' }, { status: 404 });
        const players = await playersOf(room.code);
        const { result: membership, response } = await requireMembership(players);
        if (response) return response;
        const gs = room.game_state;
        if (!gs) return Response.json({ error: 'no_game' }, { status: 400 });
        if (!matchesAdvanceExpectation(gs, body.expected_phase, body.expected_deadline, body.expected_round)) {
          return Response.json({ room: displayRoom(room), advanced: false, stale: true });
        }
        // Only members may advance the game, including the any-player "continue"
        // force on reveal/results/leaderboard. Authorization happens before the
        // stale-return so a guessed session id cannot retrieve room state.
        const isHost = room.host_session === membership.player?.session_id;
        const force = body.force === true;
        const activeIds = new Set(activePlayers(players, now).map((p) => p.session_id));

        // Force-advance: host can always force; any player can force on
        // reveal/results/leaderboard (visual "continue" moments).
        if (force && (isHost || gs.phase === 'reveal' || gs.phase === 'results' || gs.phase === 'leaderboard')) {
          const newGs = await doAdvance(base44, gs, activeIds, now);
          if (newGs && newGs !== gs) {
            const updated = await Room.update(room.id, { game_state: newGs });
            return Response.json({ room: displayRoom(updated), advanced: true });
          }
          return Response.json({ room: displayRoom(room), advanced: false });
        }

        // Auto-advance (deadline-based or all-submitted).
        const reRoom = await tryAdvance(base44, Room, room, players, now);
        return Response.json({ room: displayRoom(reRoom), advanced: reRoom !== room });
      }

      case 'reset_to_lobby': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        const players = await playersOf(room.code);
        const { result: membership, response } = await requireMembership(players);
        if (response) return response;
        if (room.host_session !== membership.player?.session_id) return Response.json({ error: 'forbidden' }, { status: 403 });
        const updated = await Room.update(room.id, { status: 'lobby', game_state: null });
        return Response.json({ room: displayRoom(updated) });
      }

      case 'close': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ ok: true });
        const players = await playersOf(room.code);
        const { result: membership, response } = await requireMembership(players);
        if (response) return response;
        if (room.host_session !== membership.player?.session_id) return Response.json({ error: 'forbidden' }, { status: 403 });
        await Room.update(room.id, { status: 'closed', game_state: null });
        await Player.deleteMany({ room_code: room.code });
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ error: 'unknown_action' }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}

// Stamp every response with the backend revision for diagnostics. The header is
// best-effort; `build` is also included in the body of diagnostic actions.
export default async function (req) {
  const res = await handle(req);
  try { res.headers.set(BACKEND_BUILD_HEADER, BACKEND_BUILD_ID); } catch { /* immutable headers: body field still carries build */ }
  return res;
}
