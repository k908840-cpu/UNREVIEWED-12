import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Upload, Camera, Check } from "lucide-react";
import { useGame } from "@/game/GameContext";
import { PRESET_AVATARS } from "@/game/mockData";
import Avatar from "@/components/Avatar";
import Stamp from "@/components/Stamp";
import { cn } from "@/lib/utils";
import { sfx } from "@/lib/sound";

export default function ProfileSetup() {
  const navigate = useNavigate();
  const location = useLocation();
  const { you, pendingRoomCode, commitJoin } = useGame();
  const joinRoomCode = location.state?.roomCode || pendingRoomCode || "";
  const [nickname, setNickname] = useState(you.nickname);
  const [photo, setPhoto] = useState(you.photo);
  const [avatar, setAvatar] = useState(you.avatar);
  const [tab, setTab] = useState(you.photo ? "photo" : "avatar");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const JOIN_ERRORS = {
    not_found: "That room doesn't exist anymore",
    closed: "That room has ended",
    in_progress: "That game already started",
    full: "That room is full",
    missing_room: "Choose a room before setting up your profile.",
  };

  useEffect(() => {
    if (joinRoomCode.length !== 4) navigate("/create", { replace: true, state: { roomSetupMissing: true } });
  }, [joinRoomCode, navigate]);

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        const url = canvas.toDataURL("image/jpeg", 0.82);
        setPhoto(url); setTab("photo"); sfx.starSelect();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const previewPlayer = { nickname: nickname || "You", photo, avatar, isYou: true };

  const join = async () => {
    if (!nickname.trim()) { sfx.wrong(); return; }
    if (busy) return;
    if (joinRoomCode.length !== 4) {
      setError(JOIN_ERRORS.missing_room); sfx.wrong();
      navigate("/create", { replace: true, state: { roomSetupMissing: true } });
      return;
    }
    setBusy(true); setError("");
    try {
      await commitJoin({ nickname: nickname.trim(), avatar, photo, roomCode: joinRoomCode });
      sfx.lobby();
      navigate("/lobby");
    } catch (e) {
      setError(JOIN_ERRORS[e.message] || "Couldn't join the room. Try again.");
      sfx.wrong();
    } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 text-[hsl(var(--ink))]">
      <button onClick={() => navigate(-1)} className="mb-6 inline-flex items-center gap-1.5 text-sm text-[hsl(var(--ink))]/60 hover:text-[hsl(var(--ink))]">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-4">
        <h1 className="text-display text-5xl sm:text-6xl">WHO ARE YOU?</h1>
        <Stamp tone="pink" rotate={6}>No account</Stamp>
      </div>
      <p className="mt-2 text-[hsl(var(--ink))]/60">Set your nickname and face. No account needed.</p>

      <div className="mt-8 flex flex-col items-center">
        <div className="relative">
          <div className="rounded-full border-4 border-[hsl(var(--ink))] bg-white p-1.5 shadow-[0_6px_0_0_hsl(var(--ink))]">
            <Avatar player={previewPlayer} size={140} />
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="absolute -bottom-1 -right-1 grid h-11 w-11 place-items-center rounded-full border-4 border-[hsl(var(--ink))] bg-primary text-primary-foreground"
            aria-label="Upload photo"
          >
            <Camera size={18} />
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>

      <div className="mt-8">
        <label className="mb-2 block font-heading text-xs font-bold uppercase tracking-widest text-[hsl(var(--ink))]/60">Nickname</label>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 16))}
          placeholder="Enter a nickname" maxLength={16}
          className="w-full rounded-2xl border-4 border-[hsl(var(--ink))] bg-white px-4 py-4 text-lg font-semibold text-[hsl(var(--ink))] outline-none focus:border-primary"
        />
      </div>

      <div className="mt-6">
        <div className="mb-3 flex gap-2">
          <TabBtn active={tab === "avatar"} onClick={() => setTab("avatar")} icon={Check} label="Preset avatars" />
          <TabBtn active={tab === "photo"} onClick={() => setTab("photo")} icon={Upload} label="Your photo" />
        </div>

        {tab === "avatar" && (
          <div className="grid grid-cols-6 gap-2.5 sm:grid-cols-12">
            {PRESET_AVATARS.map((a) => (
              <button
                key={a.id}
                onClick={() => { setAvatar(a); setPhoto(null); sfx.tap(); }}
                className={cn("grid aspect-square place-items-center rounded-xl bg-gradient-to-br text-2xl transition", a.bg, avatar?.id === a.id ? "ring-2 ring-primary ring-offset-2 ring-offset-cream scale-105" : "opacity-80 hover:opacity-100 hover:scale-105")}
              >
                {a.emoji}
              </button>
            ))}
          </div>
        )}
        {tab === "photo" && (
          <div className="rounded-2xl border-2 border-dashed border-[hsl(var(--ink))]/40 bg-white p-6 text-center">
            {photo ? (
              <div className="flex flex-col items-center gap-3">
                <img src={photo} alt="preview" className="h-24 w-24 rounded-full object-cover" />
                <button onClick={() => fileRef.current?.click()} className="text-sm font-bold text-primary">Change photo</button>
              </div>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="flex flex-col items-center gap-2 py-4 text-[hsl(var(--ink))]/60 hover:text-[hsl(var(--ink))]">
                <Upload size={28} />
                <span className="text-sm font-semibold">Upload a profile photo</span>
                <span className="text-xs">Auto-cropped to a square · compressed</span>
              </button>
            )}
          </div>
        )}
      </div>

      <button
        onClick={join}
        disabled={!nickname.trim() || busy}
        className="group mt-9 inline-flex w-full items-center justify-center gap-2 rounded-full border-4 border-[hsl(var(--ink))] bg-primary px-7 py-4 font-display text-2xl uppercase tracking-wide text-primary-foreground shadow-[0_6px_0_0_hsl(var(--ink))] disabled:opacity-40"
      >
        {busy ? "Joining…" : "Join Room"} <ArrowRight size={22} className="transition-transform group-hover:translate-x-1" />
      </button>
      {error && <p className="mt-3 text-center text-sm font-semibold text-[hsl(var(--mode-adult))]">{error}</p>}
      {joinRoomCode && <p className="mt-3 text-center text-sm text-[hsl(var(--ink))]/60">Joining room <span className="font-mono font-bold text-primary">{joinRoomCode}</span></p>}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-full border-2 border-[hsl(var(--ink))] px-3.5 py-2 text-sm font-semibold transition", active ? "bg-primary text-primary-foreground" : "bg-white text-[hsl(var(--ink))]/60 hover:text-[hsl(var(--ink))]")}>
      <Icon size={14} /> {label}
    </button>
  );
}
