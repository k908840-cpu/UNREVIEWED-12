import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
import { makeCode, normalizeCode, MAX_PLAYERS, MIN_PLAYERS, isActive, activePlayers } from '../../shared/rooms.ts';
import { PHASE_DURATIONS, LENGTH_CYCLES, buildSubjectOrder, selectPrompt, tryAdvance, doAdvance } from '../../shared/game.ts';

const LENGTHS = ['quick', 'standard', 'party', 'endless'];
const rid = () => Math.random().toString(36).slice(2, 9);

// Authoritative room + game endpoint. Clients never write room/player records
// directly; every mutation is validated here against the caller's session id
// and the room's stored host_session. All round state is authoritative —
// clients render shared state, they never generate their own.
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const sessionId = String(body.sessionId || '').trim();
    if (!sessionId) return Response.json({ error: 'missing_session' }, { status: 400 });

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

    switch (action) {
      case 'create': {
        let code = makeCode();
        for (let attempt = 0; attempt < 12; attempt++) {
          const clash = await Room.filter({ code });
          if (!clash.length) break;
          code = makeCode();
        }
        const room = await Room.create({
          code,
          status: 'lobby',
          mode: body.mode === 'adult' ? 'adult' : 'family',
          length: LENGTHS.includes(body.length) ? body.length : 'standard',
          host_session: sessionId,
          max_players: MAX_PLAYERS,
        });
        return Response.json({ room });
      }

      case 'lookup': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.status === 'closed') return Response.json({ error: 'closed' }, { status: 410 });
        const players = await playersOf(room.code);
        return Response.json({ room, active_count: activePlayers(players, now).length });
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
          const player = await Player.update(existing.id, {
            nickname, avatar_id: avatarId, photo_url: photo, connected: true, last_seen: nowIso,
            is_host: room.host_session === sessionId,
          });
          return Response.json({ room, player });
        }
        if (activePlayers(players, now).length >= (room.max_players || MAX_PLAYERS)) {
          return Response.json({ error: 'full' }, { status: 409 });
        }
        const player = await Player.create({
          room_code: room.code, session_id: sessionId, nickname, avatar_id: avatarId, photo_url: photo,
          is_host: room.host_session === sessionId, connected: true, last_seen: nowIso,
        });
        return Response.json({ room, player });
      }

      case 'heartbeat': {
        const room = await findRoom(body.code);
        if (!room || room.status === 'closed') return Response.json({ error: 'gone' }, { status: 404 });
        const players = await playersOf(room.code);
        const me = players.find((p) => p.session_id === sessionId);
        if (!me) return Response.json({ error: 'not_in_room' }, { status: 404 });
        await Player.update(me.id, { connected: true, last_seen: nowIso });
        let hostSession = room.host_session;
        const hostPlayer = players.find((p) => p.session_id === hostSession);
        if (!isActive(hostPlayer, now)) {
          const candidates = activePlayers(players, now).sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')));
          if (candidates.length) {
            const next = candidates[0];
            hostSession = next.session_id;
            await Room.update(room.id, { host_session: hostSession });
            await Player.update(next.id, { is_host: true });
            const stale = players.find((p) => p.is_host && p.session_id !== hostSession);
            if (stale) await Player.update(stale.id, { is_host: false });
          }
        }
        return Response.json({ ok: true, host_session: hostSession });
      }

      case 'leave': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ ok: true });
        const players = await playersOf(room.code);
        const me = players.find((p) => p.session_id === sessionId);
        if (me) {
          await Player.delete(me.id);
          const remaining = players.filter((p) => p.id !== me.id);
          if (room.host_session === sessionId) {
            const act = activePlayers(remaining, now).sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')));
            if (act.length) {
              await Room.update(room.id, { host_session: act[0].session_id });
              await Player.update(act[0].id, { is_host: true });
            } else {
              await Room.update(room.id, { status: 'closed' });
            }
          }
        }
        return Response.json({ ok: true });
      }

      case 'kick': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.host_session !== sessionId) return Response.json({ error: 'forbidden' }, { status: 403 });
        const target = String(body.target_session || '');
        const players = await playersOf(room.code);
        const victim = players.find((p) => p.session_id === target);
        if (victim) await Player.delete(victim.id);
        return Response.json({ ok: true });
      }

      case 'config': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.host_session !== sessionId) return Response.json({ error: 'forbidden' }, { status: 403 });
        if (room.status !== 'lobby') return Response.json({ error: 'in_progress' }, { status: 409 });
        const patch = {};
        if (body.mode === 'family' || body.mode === 'adult') patch.mode = body.mode;
        if (LENGTHS.includes(body.length)) patch.length = body.length;
        const updated = await Room.update(room.id, patch);
        return Response.json({ room: updated });
      }

      case 'start': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.host_session !== sessionId) return Response.json({ error: 'forbidden' }, { status: 403 });
        if (room.status === 'playing' && room.game_state) return Response.json({ room });
        const players = await playersOf(room.code);
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
        return Response.json({ room: updated });
      }

      case 'submit_answer': {
        const room = await findRoom(body.code);
        if (!room || room.status !== 'playing') return Response.json({ error: 'not_found' }, { status: 404 });
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
        const players = await playersOf(room.code);
        const refreshed = players.map((p) => p.session_id === sessionId ? { ...p, last_seen: nowIso, connected: true } : p);
        const reRoom = await tryAdvance(base44, Room, updated, refreshed, now);
        return Response.json({ room: reRoom });
      }

      case 'submit_rating': {
        const room = await findRoom(body.code);
        if (!room || room.status !== 'playing') return Response.json({ error: 'not_found' }, { status: 404 });
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
        const players = await playersOf(room.code);
        const refreshed = players.map((p) => p.session_id === sessionId ? { ...p, last_seen: nowIso, connected: true } : p);
        const reRoom = await tryAdvance(base44, Room, updated, refreshed, now);
        return Response.json({ room: reRoom });
      }

      case 'submit_prediction': {
        const room = await findRoom(body.code);
        if (!room || room.status !== 'playing') return Response.json({ error: 'not_found' }, { status: 404 });
        const gs = room.game_state;
        if (!gs || gs.phase !== 'prediction') return Response.json({ error: 'wrong_phase' }, { status: 400 });
        if (sessionId !== gs.current_subject) return Response.json({ error: 'not_subject' }, { status: 403 });
        if (gs.prediction) return Response.json({ error: 'already_predicted' }, { status: 409 });
        const answerId = String(body.answer_id || '');
        if (!(gs.answers || []).some((a) => a.id === answerId)) return Response.json({ error: 'invalid_answer' }, { status: 400 });
        await Room.updateMany({ id: room.id }, { $set: { 'game_state.prediction': answerId } });
        const updated = await findRoom(room.code);
        const players = await playersOf(room.code);
        const refreshed = players.map((p) => p.session_id === sessionId ? { ...p, last_seen: nowIso, connected: true } : p);
        const reRoom = await tryAdvance(base44, Room, updated, refreshed, now);
        return Response.json({ room: reRoom });
      }

      case 'advance': {
        const room = await findRoom(body.code);
        if (!room || room.status !== 'playing') return Response.json({ error: 'not_found' }, { status: 404 });
        const gs = room.game_state;
        if (!gs) return Response.json({ error: 'no_game' }, { status: 400 });
        const players = await playersOf(room.code);
        const isHost = room.host_session === sessionId;
        const force = body.force === true;
        const activeIds = new Set(activePlayers(players, now).map((p) => p.session_id));

        // Force-advance: host can always force; any player can force on
        // reveal/results/leaderboard (visual "continue" moments).
        if (force && (isHost || gs.phase === 'reveal' || gs.phase === 'results' || gs.phase === 'leaderboard')) {
          const newGs = await doAdvance(base44, gs, activeIds, now);
          if (newGs && newGs !== gs) {
            const updated = await Room.update(room.id, { game_state: newGs });
            return Response.json({ room: updated, advanced: true });
          }
          return Response.json({ room, advanced: false });
        }

        // Auto-advance (deadline-based or all-submitted).
        const reRoom = await tryAdvance(base44, Room, room, players, now);
        return Response.json({ room: reRoom, advanced: reRoom !== room });
      }

      case 'reset_to_lobby': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ error: 'not_found' }, { status: 404 });
        if (room.host_session !== sessionId) return Response.json({ error: 'forbidden' }, { status: 403 });
        const updated = await Room.update(room.id, { status: 'lobby', game_state: null });
        return Response.json({ room: updated });
      }

      case 'close': {
        const room = await findRoom(body.code);
        if (!room) return Response.json({ ok: true });
        if (room.host_session !== sessionId) return Response.json({ error: 'forbidden' }, { status: 403 });
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