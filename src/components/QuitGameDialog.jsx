import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, AlertTriangle } from "lucide-react";
import { useGame } from "@/game/GameContext";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function QuitGameDialog({ open, onOpenChange }) {
  const navigate = useNavigate();
  const { leaveRoom, isHost } = useGame();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  const close = (nextOpen) => {
    if (leaving) return;
    if (!nextOpen) setError("");
    onOpenChange(nextOpen);
  };

  const confirmLeave = async () => {
    if (leaving) return;
    setLeaving(true);
    setError("");
    const result = await leaveRoom();
    setLeaving(false);
    if (result?.ok) {
      onOpenChange(false);
      navigate("/");
      return;
    }
    setError("We couldn't leave the game yet. You're still in the room — please try again.");
  };

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent className="paper-grain max-h-[calc(100dvh-2rem)] w-[calc(100%-2.5rem)] overflow-y-auto rounded-3xl border-4 border-[hsl(var(--ink))] bg-cream p-6 text-[hsl(var(--cream-foreground))] shadow-[0_8px_0_0_hsl(var(--ink))] sm:max-w-md">
        <AlertDialogHeader className="text-left">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[hsl(var(--mode-adult))] text-cream">
            <LogOut size={22} />
          </div>
          <AlertDialogTitle className="mt-4 font-display text-3xl uppercase">Leave the game?</AlertDialogTitle>
          <AlertDialogDescription className="mt-2 text-sm leading-relaxed text-[hsl(var(--cream-foreground))]/70">
            You'll leave this game and return to the home screen. Your current progress in this game may be lost.
          </AlertDialogDescription>
          {isHost && (
            <p className="mt-3 flex gap-2 rounded-xl border-2 border-[hsl(var(--ink))] bg-white/70 p-3 text-xs leading-relaxed text-[hsl(var(--cream-foreground))]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[hsl(var(--mode-adult))]" />
              If another active player remains, they become Host. If nobody active remains, the room closes.
            </p>
          )}
          {error && <p role="alert" className="mt-3 text-sm font-semibold text-[hsl(var(--mode-adult))]">{error}</p>}
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-3 gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => close(false)}
            disabled={leaving}
            className="flex-1 rounded-full border-2 border-[hsl(var(--ink))] bg-white px-4 py-3 font-display text-lg uppercase disabled:opacity-50"
          >
            Stay in Game
          </button>
          <button
            type="button"
            onClick={confirmLeave}
            disabled={leaving}
            className="flex-1 rounded-full bg-[hsl(var(--mode-adult))] px-4 py-3 font-display text-lg uppercase text-cream shadow-[0_4px_0_0_hsl(var(--ink))] disabled:opacity-50"
          >
            {leaving ? "Leaving…" : "Leave Game"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
