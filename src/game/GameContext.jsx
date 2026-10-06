import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { PRESET_AVATARS } from "./mockData";
import { setMuted as setSfxMuted, setVolume as setSfxVolume } from "@/lib/sound";
import {
  getSessionId, getActiveRoomCode, setActiveRoomCode, clearActiveRoom,
  getPendingRoomCode, setPendingRoomCode, clearPendingRoomCode,
} from "@/lib/session";

const GameContext = createContext(null);

const FRESH_MS = 30000;
// Heartbeat interval — presence-only, safely inside the 30s active threshold.
const HEARTBEAT_MS = 20000;
// Debounce window for coalescing bursts of realtime events into one getRoster.
const ROSTER_DEBOUNCE_MS = 400;
// Exponential backoff for rate-limit errors (ms).
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 30000;

// Detects rate-limit errors in either response data or thrown SDK errors.
// A rate-limit error must NEVER be treated as not_found/gone.
const isRateLimited = (data, err) => {
  const msg = (typeof data === "string" ? data : data?.error) || err?.response?.data?.error || err?.message || "";
  return /rate limit/i.test(msg);
};
const rid = () => Math.random().toString(36).slice(2, 9);
const normalizeRoomCode = (value) => String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);

const GAME_PHASE_ROUTES = {
  reveal: "/reveal",
  writing: "/write",
  rating: "/rate",
  prediction: "/predict",
  results: "/results",
  leaderboard: "/leaderboard",
  finished: "/final",
};

function mapPlayer(rp, sessionId) {
  const seen = Date.parse(rp.last_seen || "") || 0;
  return {
    id: rp.session_id,
    sessionId: rp.session_id,
    nickname: rp.nickname || "Player",
    photo: rp.photo_url || null,
    avatar: PRESET_AVATARS.find((a) => a.id === rp.avatar_id) || null,
    isHost: !!rp.is_host,
    isYou: rp.session_id === sessionId,
    connected: !!rp.connected && Date.now() - seen < FRESH_MS,
  };
}

export function GameProvider({ children }) {
  const navigate = useNavigate();
  const sessionId = useRef(getSessionId()).current;

  const [mode, setMode] = useState("family");
  const [length, setLength] = useState("standard");
  const [roomCode, setRoomCode] = useState("");
  const [pendingRoomCode, setPendingRoomCodeState] = useState(() => getPendingRoomCode());
  const [room, setRoom] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [you, setYou] = useState({ nickname: "", photo: null, avatar: PRESET_AVATARS[0] });
  const [players, setPlayers] = useState([]);
  const [leftReason, setLeftReason] = useState(null);
  const [phase, setPhase] = useState("landing");
  const [volume, setVol] = useState(0.7);
  const [muted, setMutedState] = useState(false);
  const [chat, setChat] = useState([]);

  const seenSelfRef = useRef(false);
  const prevStatusRef = useRef(null);
  const prevRoundRef = useRef(-1);
  const playersRef = useRef([]);
  const rosterDebounceRef = useRef(null);
  const inFlightRosterRef = useRef(false);
  const backoffRef = useRef(0);
  const backoffTimerRef = useRef(null);
  const fetchRosterRef = useRef(async () => {});
  const rosterPrimedRoomRef = useRef("");

  // Keep playersRef in sync for the realtime subscription's meaningful-change check.
  useEffect(() => { playersRef.current = players; }, [players]);

  const setVolume = useCallback((v) => { setVol(v); setSfxVolume(v); }, []);
  const toggleMute = useCallback(() => setMutedState((m) => { const next = !m; setSfxMuted(next); return next; }), []);

  const resetRoomState = useCallback(() => {
    clearActiveRoom();
    clearPendingRoomCode();
    seenSelfRef.current = false;
    rosterPrimedRoomRef.current = "";
    if (rosterDebounceRef.current) { clearTimeout(rosterDebounceRef.current); rosterDebounceRef.current = null; }
    if (backoffTimerRef.current) { clearTimeout(backoffTimerRef.current); backoffTimerRef.current = null; }
    backoffRef.current = 0; inFlightRosterRef.current = false;
    setRoomCode(""); setPendingRoomCodeState(""); setRoom(null); setIsHost(false); setPlayers([]);
    setYou({ nickname: "", photo: null, avatar: PRESET_AVATARS[0] });
    setLeftReason(null); setPhase("landing");
  }, []);

  // ---- lobby actions (unchanged) ----
  const createRoom = useCallback(async () => {
    const res = await base44.functions.invoke("room", { action: "create", sessionId, mode, length });
    const created = res?.data?.room;
    if (!created) throw new Error("create_failed");
    // Creating a room leads to profile setup; it is not a joined session yet.
    // Do not start the active-room networking lifecycle until join succeeds.
    clearActiveRoom();
    setPendingRoomCode(created.code); setPendingRoomCodeState(created.code);
    setRoom(created); setRoomCode("");
    setIsHost(true); setMode(created.mode); setLength(created.length); setPhase("config");
    return created;
  }, [sessionId, mode, length]);

  const lookupRoom = useCallback(async (rawCode) => {
    const code = normalizeRoomCode(rawCode);
    try {
      const res = await base44.functions.invoke("room", { action: "lookup", code, sessionId });
      const data = res?.data || {};
      if (data.error) return { error: data.error };
      if (data.room.status === "playing") return { error: "in_progress" };
      if (data.room.status === "closed") return { error: "closed" };
      // Lookup only validates a joinable room. It must not make this browser
      // an active participant before the authoritative join has completed.
      clearActiveRoom();
      setPendingRoomCode(data.room.code); setPendingRoomCodeState(data.room.code);
      setRoom(data.room); setRoomCode("");
      setMode(data.room.mode); setLength(data.room.length);
      setIsHost(data.room.host_session === sessionId);
      return { ok: true, room: data.room, roomCode: data.room.code };
    } catch (e) {
      if (isRateLimited(null, e)) return { error: "rate_limited" };
      const error = e?.response?.data?.error;
      if (["not_found", "closed", "in_progress", "full"].includes(error)) return { error };
      return { error: "request_failed" };
    }
  }, [sessionId]);

  const requestRoster = useCallback(async (code) => {
    const res = await base44.functions.invoke("room", { action: "getRoster", code, sessionId });
    return res?.data || {};
  }, [sessionId]);

  const commitJoin = useCallback(async ({ nickname, avatar, photo, roomCode: requestedRoomCode }) => {
    const joiningCode = normalizeRoomCode(requestedRoomCode || pendingRoomCode);
    if (joiningCode.length !== 4) throw new Error("missing_room");
    try {
      const res = await base44.functions.invoke("room", {
        action: "join", sessionId, code: joiningCode,
        nickname, avatar_id: avatar?.id || "", photo_url: photo || "",
      });
      const data = res?.data || {};
      if (data.error) throw new Error(data.error);

      // Populate the lobby from the service-role roster before enabling the
      // joined-room lifecycle. Anonymous clients cannot rely on a direct
      // RoomPlayer realtime event for their initial roster.
      const rosterData = await requestRoster(joiningCode);
      if (rosterData.error || !rosterData.room || !Array.isArray(rosterData.players)) {
        throw new Error(rosterData.error || "roster_failed");
      }
      const mapped = rosterData.players.map((rp) => mapPlayer(rp, sessionId));
      const me = mapped.find((player) => player.isYou);
      if (!me) throw new Error("not_in_room");

      const joinedRoom = rosterData.room;
      const hostNow = joinedRoom.host_session === sessionId;
      setRoom(joinedRoom); setMode(joinedRoom.mode); setLength(joinedRoom.length);
      setYou({
        id: sessionId,
        nickname: me.nickname,
        photo: me.photo,
        avatar: me.avatar || PRESET_AVATARS[0],
        isHost: hostNow,
      });
      setPlayers(mapped); setIsHost(hostNow);
      seenSelfRef.current = true;
      rosterPrimedRoomRef.current = joiningCode;
      setRoomCode(joiningCode); setActiveRoomCode(joiningCode);
      clearPendingRoomCode(); setPendingRoomCodeState("");
      setPhase("lobby");
      return { ok: true };
    } catch (e) {
      throw new Error(e?.response?.data?.error || e?.message || "join_failed");
    }
  }, [sessionId, pendingRoomCode, requestRoster]);

  const persistConfig = useCallback(async (m, l) => {
    const code = roomCode || pendingRoomCode;
    if (!code || !isHost) return;
    try {
      const res = await base44.functions.invoke("room", { action: "config", code, sessionId, mode: m, length: l });
      if (res?.data?.room) setRoom(res.data.room);
    } catch { /* non-critical */ }
  }, [roomCode, pendingRoomCode, isHost, sessionId]);

  const kickPlayer = useCallback(async (targetSession) => {
    try { await base44.functions.invoke("room", { action: "kick", code: roomCode, sessionId, target_session: targetSession }); } catch {}
  }, [roomCode, sessionId]);

  const leaveRoom = useCallback(async () => {
    try { if (roomCode) await base44.functions.invoke("room", { action: "leave", code: roomCode, sessionId }); } catch {}
    resetRoomState();
  }, [roomCode, sessionId, resetRoomState]);

  const endRoom = useCallback(async () => {
    try { if (roomCode) await base44.functions.invoke("room", { action: "close", code: roomCode, sessionId }); } catch {}
    resetRoomState();
  }, [roomCode, sessionId, resetRoomState]);

  const acknowledgeLeft = useCallback(() => resetRoomState(), [resetRoomState]);

  // Immediate roster fetch with in-flight dedup + exponential backoff on
  // rate-limit errors. Only genuine not_found / closed clear room state.
  const fetchRoster = useCallback(async () => {
    if (!roomCode) return;
    if (inFlightRosterRef.current) return;
    inFlightRosterRef.current = true;
    const handleRateLimit = () => {
      const next = Math.min(backoffRef.current === 0 ? BACKOFF_BASE_MS : backoffRef.current * 2, BACKOFF_MAX_MS);
      backoffRef.current = next;
      if (backoffTimerRef.current) clearTimeout(backoffTimerRef.current);
      backoffTimerRef.current = setTimeout(() => {
        backoffTimerRef.current = null;
        fetchRosterRef.current();
      }, next);
    };
    try {
      const data = await requestRoster(roomCode);
      if (isRateLimited(data)) { handleRateLimit(); return; }
      backoffRef.current = 0;
      if (data.error === "not_found" || data.error === "closed") { setLeftReason("closed"); return; }
      if (data.error === "not_in_room") {
        if (seenSelfRef.current) setLeftReason("removed");
        return;
      }
      const roster = data.players || [];
      const mapped = roster.map((rp) => mapPlayer(rp, sessionId));
      if (mapped.some((p) => p.isYou)) seenSelfRef.current = true;
      else if (seenSelfRef.current) setLeftReason("removed");
      setPlayers(mapped);
    } catch (e) {
      if (isRateLimited(null, e)) handleRateLimit();
      // transient — don't clear room state
    } finally {
      inFlightRosterRef.current = false;
    }
  }, [roomCode, sessionId, requestRoster]);
  fetchRosterRef.current = fetchRoster;

  // Debounced roster refresh — coalesces bursts of realtime events into a
  // single getRoster call. Skipped while a backoff timer is pending.
  // Pass { force: true } for user-initiated actions that must not be delayed.
  const refreshPlayers = useCallback((opts = {}) => {
    if (!roomCode) return;
    if (backoffTimerRef.current) return; // rate-limited; backoff will retry
    if (opts.force) {
      if (rosterDebounceRef.current) { clearTimeout(rosterDebounceRef.current); rosterDebounceRef.current = null; }
      return fetchRoster();
    }
    if (rosterDebounceRef.current) clearTimeout(rosterDebounceRef.current);
    rosterDebounceRef.current = setTimeout(() => {
      rosterDebounceRef.current = null;
      fetchRoster();
    }, ROSTER_DEBOUNCE_MS);
  }, [roomCode, fetchRoster]);

  // ---- game actions (all validated server-side) ----
  const callRoom = useCallback(async (action, extra = {}) => {
    if (!roomCode) return { error: "no_room" };
    try {
      const res = await base44.functions.invoke("room", { action, sessionId, code: roomCode, ...extra });
      if (res?.data?.room) setRoom(res.data.room);
      return res?.data || {};
    } catch (e) {
      return { error: e?.response?.data?.error || e?.message || "error" };
    }
  }, [roomCode, sessionId]);

  const startGame = useCallback(async () => {
    try {
      const res = await base44.functions.invoke("room", { action: "start", code: roomCode, sessionId });
      const data = res?.data || {};
      if (data.error) return { error: data.error, active: data.active };
      if (data.room) setRoom(data.room);
      refreshPlayers({ force: true });
      return { ok: true };
    } catch (e) {
      return { error: e?.response?.data?.error || "start_failed", active: e?.response?.data?.active };
    }
  }, [roomCode, sessionId, refreshPlayers]);

  const submitAnswer = useCallback((text) => callRoom("submit_answer", { text }), [callRoom]);
  const submitRating = useCallback((answerId, stars) => callRoom("submit_rating", { answer_id: answerId, stars }), [callRoom]);
  const submitPrediction = useCallback((answerId) => callRoom("submit_prediction", { answer_id: answerId }), [callRoom]);
  const advance = useCallback((opts = {}) => callRoom("advance", { force: opts.force || false }), [callRoom]);

  const endGame = useCallback(async () => {
    await callRoom("close");
    resetRoomState();
  }, [callRoom, resetRoomState]);

  const resetToLobby = useCallback(async () => {
    if (!roomCode || !isHost) return;
    try {
      const res = await base44.functions.invoke("room", { action: "reset_to_lobby", code: roomCode, sessionId });
      if (res?.data?.room) setRoom(res.data.room);
    } catch {}
  }, [roomCode, sessionId, isHost]);

  const goToProfile = useCallback(() => setPhase("profile"), []);
  const addChat = useCallback((text) => {
    if (!text.trim()) return;
    setChat((c) => [...c, { id: rid(), playerId: sessionId, text: text.trim().slice(0, 200), ts: Date.now() }].slice(-60));
  }, [sessionId]);

  // ---- realtime subscription + heartbeat ----
  useEffect(() => {
    if (!roomCode) return undefined;
    let active = true;

    const refreshRoom = async () => {
      try {
        const list = await base44.entities.Room.filter({ code: roomCode });
        if (active && list && list[0]) setRoom(list[0]);
      } catch { /* transient */ }
    };

    if (rosterPrimedRoomRef.current === roomCode) rosterPrimedRoomRef.current = "";
    else fetchRoster();
    refreshRoom();

    const unsubPlayers = base44.entities.RoomPlayer.subscribe((e) => {
      if (!active) return;
      const d = e?.data || {};
      if (d.room_code && d.room_code !== roomCode) return;
      // create/delete = player joined/left → refresh
      if (e.type === "create" || e.type === "delete") { refreshPlayers(); return; }
      // update — only refresh if meaningful fields changed (not heartbeat last_seen)
      if (e.type === "update") {
        const existing = playersRef.current.find((p) => p.sessionId === d.session_id);
        if (!existing) { refreshPlayers(); return; }
        const meaningful =
          (d.nickname != null && d.nickname !== existing.nickname) ||
          (d.avatar_id != null && d.avatar_id !== (existing.avatar?.id || "")) ||
          (d.photo_url != null && d.photo_url !== existing.photo) ||
          (d.is_host != null && !!d.is_host !== existing.isHost);
        if (meaningful) refreshPlayers();
      }
    });

    const unsubRoom = base44.entities.Room.subscribe((e) => {
      if (!active) return;
      const d = e?.data || {};
      if (d.code !== roomCode) return;
      if (e.type === "delete" || d.status === "closed") { setLeftReason("closed"); return; }
      setRoom(d);
      // When the game starts, ensure every client has the complete roster
      if (d.status === "playing") fetchRoster();
    });

    const beat = async () => {
      try { await base44.functions.invoke("room", { action: "heartbeat", code: roomCode, sessionId }); } catch {}
    };
    beat();
    const beatTimer = setInterval(beat, HEARTBEAT_MS);

    return () => {
      active = false;
      if (typeof unsubPlayers === "function") unsubPlayers();
      if (typeof unsubRoom === "function") unsubRoom();
      clearInterval(beatTimer);
      if (rosterDebounceRef.current) { clearTimeout(rosterDebounceRef.current); rosterDebounceRef.current = null; }
      if (backoffTimerRef.current) { clearTimeout(backoffTimerRef.current); backoffTimerRef.current = null; }
    };
  }, [roomCode, sessionId, fetchRoster, refreshPlayers]);

  // ---- safety: ensure complete roster on game start / new round ----
  useEffect(() => {
    if (!room) return;
    const status = room.status;
    const roundIdx = room.game_state?.round_index ?? 0;
    if (status === "playing" && (prevStatusRef.current !== "playing" || roundIdx !== prevRoundRef.current)) {
      refreshPlayers();
    }
    prevStatusRef.current = status;
    prevRoundRef.current = roundIdx;
  }, [room?.status, room?.game_state?.round_index, refreshPlayers]);

  // ---- centralized game-phase navigation ----
  useEffect(() => {
    if (!room || room.status !== "playing" || !room.game_state) return;
    const target = GAME_PHASE_ROUTES[room.game_state.phase];
    if (target && window.location.pathname !== target) navigate(target);
  }, [room?.status, room?.game_state?.phase, navigate]);

  // ---- auto-advance when shared deadline expires ----
  useEffect(() => {
    if (!room?.game_state?.phase_deadline || room.status !== "playing") return;
    const deadline = Date.parse(room.game_state.phase_deadline);
    const id = setInterval(() => {
      if (Date.now() >= deadline) advance();
    }, 1000);
    return () => clearInterval(id);
  }, [room?.game_state?.phase_deadline, room?.status, advance]);

  // ---- return to lobby when host resets a finished game ----
  useEffect(() => {
    if (!room || room.status !== "lobby") return;
    const onGamePath = ["/reveal", "/write", "/rate", "/predict", "/results", "/leaderboard", "/final"].some((p) => window.location.pathname.startsWith(p));
    if (onGamePath) navigate("/lobby");
  }, [room?.status, navigate]);

  // ---- handle kick / room-closed during gameplay ----
  useEffect(() => {
    if (leftReason && window.location.pathname !== "/lobby") navigate("/lobby");
  }, [leftReason, navigate]);

  // ---- reconnect on load ----
  // NOTE: cleanupRooms is NOT called from the client. It is a server-side
  // maintenance function that lists + deletes all rooms/players matching TTL
  // criteria. Calling it on every page load caused rate-limit storms and
  // sporadic room deletion. It must remain disabled/unscheduled unless
  // explicitly invoked by an admin or a future scheduled task.
  useEffect(() => {
    const code = getActiveRoomCode();
    if (!code) return;
    (async () => {
      try {
        const res = await base44.functions.invoke("room", { action: "getRoster", code, sessionId });
        const data = res?.data || {};
        if (isRateLimited(data)) return; // rate limited — preserve room, don't clear
        // Clear only after an authoritative absence/membership result. A 500
        // or transient SDK failure must not discard a valid active session.
        if (["not_found", "closed", "not_in_room"].includes(data.error)) { clearActiveRoom(); return; }
        if (data.error || !data.room) return;
        const existing = data.room;
        const mine = (data.players || []).find((p) => p.session_id === sessionId);
        if (!mine) { clearActiveRoom(); return; }
        // An already-active room wins over any stale pre-join code left in
        // storage from an interrupted Profile Setup flow.
        clearPendingRoomCode(); setPendingRoomCodeState("");
        setRoom(existing); setRoomCode(code); setMode(existing.mode); setLength(existing.length);
        setIsHost(existing.host_session === sessionId);
        setYou({
          id: sessionId,
          nickname: mine.nickname,
          photo: mine.photo_url || null,
          avatar: PRESET_AVATARS.find((a) => a.id === mine.avatar_id) || PRESET_AVATARS[0],
          isHost: existing.host_session === sessionId,
        });
        seenSelfRef.current = true;
        setPhase("lobby");
        // centralized navigation effect will route to the correct game page
      } catch (e) {
        const error = e?.response?.data?.error;
        if (["not_found", "closed", "not_in_room"].includes(error)) clearActiveRoom();
      }
    })();
  }, [sessionId]);

  // ---- derived game state (sanitized: authors/ratings hidden until results) ----
  const rawGame = room?.game_state;
  const gamePhase = rawGame?.phase || null;
  const showAll = gamePhase === "results" || gamePhase === "leaderboard" || gamePhase === "finished";
  const rawAnswers = rawGame?.answers || [];
  const answers = rawAnswers.map((a) => ({
    id: a.id,
    text: a.text,
    playerId: showAll ? a.author : (a.author === sessionId ? sessionId : null),
  }));
  const currentSubjectId = rawGame?.current_subject || null;
  const currentPrompt = rawGame?.current_prompt || null;
  const ratingIndex = rawGame?.rating_index || 0;
  const scores = rawGame?.scores || {};
  const sanitizeResults = (r) => r ? { ...r, ranked: (r.ranked || []).map((item) => ({ ...item, playerId: item.author })) } : null;
  const roundResult = sanitizeResults(rawGame?.results);
  const roundIndex = rawGame?.round_index || 0;
  const totalRounds = (rawGame?.subject_order || []).length;
  const history = (rawGame?.round_history || []).map(sanitizeResults);
  const phaseDeadline = rawGame?.phase_deadline || null;
  const phaseDuration = rawGame?.phase_duration || 0;
  const submittedCount = rawAnswers.length;
  const myAnswerId = rawAnswers.find((a) => a.author === sessionId)?.id || null;
  const currentAnswer = rawAnswers[ratingIndex];
  const rawRatings = rawGame?.ratings || {};
  const currentRatings = currentAnswer ? (rawRatings[currentAnswer.id] || {}) : {};
  const myRating = currentRatings[sessionId] || 0;
  const ratedCount = currentAnswer ? Object.keys(currentRatings).length : 0;

  const value = {
    sessionId,
    mode, setMode, length, setLength, roomCode, pendingRoomCode, room, isHost,
    you, setYou, players, leftReason, acknowledgeLeft,
    phase, setPhase,
    // game state
    gamePhase, currentSubjectId, currentPrompt, answers, ratingIndex,
    scores, roundResult, roundIndex, totalRounds, history,
    submittedCount, ratedCount, myAnswerId, myRating, phaseDeadline, phaseDuration,
    // lobby actions
    createRoom, lookupRoom, commitJoin, persistConfig, kickPlayer, leaveRoom, endRoom, goToProfile,
    // game actions
    startGame, submitAnswer, submitRating, submitPrediction, advance,
    endGame, resetToLobby,
    newRoom: resetRoomState, changeMode: resetToLobby,
    // audio + chat
    volume, setVolume, muted, toggleMute, chat, addChat,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used within GameProvider");
  return ctx;
}
