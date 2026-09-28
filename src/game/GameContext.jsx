import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { PRESET_AVATARS } from "./mockData";
import { setMuted as setSfxMuted, setVolume as setSfxVolume } from "@/lib/sound";
import { getSessionId, getActiveRoomCode, setActiveRoomCode, clearActiveRoom } from "@/lib/session";

const GameContext = createContext(null);

const FRESH_MS = 30000;
const rid = () => Math.random().toString(36).slice(2, 9);

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

  const setVolume = useCallback((v) => { setVol(v); setSfxVolume(v); }, []);
  const toggleMute = useCallback(() => setMutedState((m) => { const next = !m; setSfxMuted(next); return next; }), []);

  const resetRoomState = useCallback(() => {
    clearActiveRoom();
    seenSelfRef.current = false;
    setRoomCode(""); setRoom(null); setIsHost(false); setPlayers([]);
    setYou({ nickname: "", photo: null, avatar: PRESET_AVATARS[0] });
    setLeftReason(null); setPhase("landing");
  }, []);

  // Fetch the complete authoritative player roster for the current room.
  // RoomPlayer is intentionally not made globally readable for anonymous clients.
  const refreshPlayers = useCallback(async () => {
    if (!roomCode) return;
    try {
      const res = await base44.functions.invoke("room", { action: "getRoster", code: roomCode, sessionId });
      const data = res?.data || {};
      if (data.error) {
        if (data.error === "not_in_room" && seenSelfRef.current) setLeftReason("removed");
        return;
      }
      const mapped = (data.players || []).map((rp) => mapPlayer(rp, sessionId));
      if (mapped.some((p) => p.isYou)) seenSelfRef.current = true;
      else if (seenSelfRef.current) setLeftReason("removed");
      setPlayers(mapped);
    } catch { /* transient */ }
  }, [roomCode, sessionId]);

  // ---- lobby actions (unchanged) ----
  const createRoom = useCallback(async () => {
    const res = await base44.functions.invoke("room", { action: "create", sessionId, mode, length });
    const created = res?.data?.room;
    if (!created) throw new Error("create_failed");
    setRoom(created); setRoomCode(created.code); setActiveRoomCode(created.code);
    setIsHost(true); setMode(created.mode); setLength(created.length); setPhase("config");
    return created;
  }, [sessionId, mode, length]);

  const lookupRoom = useCallback(async (rawCode) => {
    const code = String(rawCode || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);
    try {
      const res = await base44.functions.invoke("room", { action: "lookup", code, sessionId });
      const data = res?.data || {};
      if (data.error) return { error: data.error };
      if (data.room.status === "playing") return { error: "in_progress" };
      if (data.room.status === "closed") return { error: "closed" };
      setRoom(data.room); setRoomCode(data.room.code);
      setMode(data.room.mode); setLength(data.room.length);
      setIsHost(data.room.host_session === sessionId);
      return { ok: true, room: data.room };
    } catch (e) {
      return { error: e?.response?.data?.error || "not_found" };
    }
  }, [sessionId]);

  const commitJoin = useCallback(async ({ nickname, avatar, photo }) => {
    try {
      const res = await base44.functions.invoke("room", {
        action: "join", sessionId, code: roomCode,
        nickname, avatar_id: avatar?.id || "", photo_url: photo || "",
      });
      const data = res?.data || {};
      if (data.error) throw new Error(data.error);
      const joinedRoom = data.room;
      const hostNow = joinedRoom ? joinedRoom.host_session === sessionId : isHost;
      if (joinedRoom) { setRoom(joinedRoom); setMode(joinedRoom.mode); setLength(joinedRoom.length); }
      setYou({
        id: sessionId,
        nickname: data.player?.nickname || nickname,
        photo: data.player?.photo_url || photo || null,
        avatar: avatar || PRESET_AVATARS[0],
        isHost: hostNow,
      });
      setIsHost(hostNow);
      setActiveRoomCode(roomCode);
      seenSelfRef.current = false;
      setPhase("lobby");
      refreshPlayers();
      return { ok: true };
    } catch (e) {
      throw new Error(e?.response?.data?.error || e?.message || "join_failed");
    }
  }, [sessionId, roomCode, isHost, refreshPlayers]);

  const persistConfig = useCallback(async (m, l) => {
    if (!roomCode || !isHost) return;
    try {
      const res = await base44.functions.invoke("room", { action: "config", code: roomCode, sessionId, mode: m, length: l });
      if (res?.data?.room) setRoom(res.data.room);
    } catch { /* non-critical */ }
  }, [roomCode, isHost, sessionId]);

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
      refreshPlayers();
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

    refreshPlayers();
    refreshRoom();

    const unsubPlayers = base44.entities.RoomPlayer.subscribe((e) => {
      if (!active) return;
      const d = e?.data || {};
      // Refresh on any player event for this room; delete events may omit room_code
      if (!d.room_code || d.room_code === roomCode) refreshPlayers();
    });

    const unsubRoom = base44.entities.Room.subscribe((e) => {
      if (!active) return;
      const d = e?.data || {};
      if (d.code !== roomCode) return;
      if (e.type === "delete" || d.status === "closed") { setLeftReason("closed"); return; }
      setRoom(d);
      // When the game starts, ensure every client has the complete roster
      if (d.status === "playing") refreshPlayers();
    });

    const beat = () => base44.functions.invoke("room", { action: "heartbeat", code: roomCode, sessionId }).catch(() => {});
    beat();
    const beatTimer = setInterval(beat, 5000);
    const rosterTimer = setInterval(refreshPlayers, 5000);

    return () => {
      active = false;
      if (typeof unsubPlayers === "function") unsubPlayers();
      if (typeof unsubRoom === "function") unsubRoom();
      clearInterval(beatTimer);
      clearInterval(rosterTimer);
    };
  }, [roomCode, sessionId, refreshPlayers]);

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

  // ---- reconnect on load + periodic cleanup ----
  useEffect(() => {
    base44.functions.invoke("cleanupRooms", {}).catch(() => {});
    const code = getActiveRoomCode();
    if (!code) return;
    (async () => {
      try {
        const res = await base44.functions.invoke("room", { action: "lookup", code, sessionId });
        const existing = res?.data?.room;
        if (!existing || existing.status === "closed") { clearActiveRoom(); return; }
        const roster = await base44.functions.invoke("room", { action: "getRoster", code, sessionId });
        const data = roster?.data || {};
        if (data.error) { clearActiveRoom(); return; }
        const mine = (data.players || []).find((p) => p.session_id === sessionId);
        if (!mine) { clearActiveRoom(); return; }
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
      } catch {
        clearActiveRoom();
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
    mode, setMode, length, setLength, roomCode, room, isHost,
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
