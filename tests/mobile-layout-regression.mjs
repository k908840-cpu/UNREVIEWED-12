import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [styles, layout, results, leaderboard, rating, stars, prediction, writing, reveal, lobby, finalResults, settings, chat, quitDialog] = await Promise.all([
  read("../src/index.css"),
  read("../src/components/Layout.jsx"),
  read("../src/pages/RoundResults.jsx"),
  read("../src/pages/Leaderboard.jsx"),
  read("../src/pages/Rating.jsx"),
  read("../src/components/StarRating.jsx"),
  read("../src/pages/Prediction.jsx"),
  read("../src/pages/Writing.jsx"),
  read("../src/pages/SubjectReveal.jsx"),
  read("../src/pages/Lobby.jsx"),
  read("../src/pages/FinalResults.jsx"),
  read("../src/components/SettingsPanel.jsx"),
  read("../src/components/ChatPanel.jsx"),
  read("../src/components/QuitGameDialog.jsx"),
]);

// Target viewports cover compact Android, common Pixel/Samsung dimensions,
// and a narrow legacy handset. Source-level checks keep this regression
// runnable without a live room or production Base44 traffic.
const viewports = [
  [360, 800],
  [393, 852],
  [412, 915],
  [320, 568],
];
assert.equal(viewports.length, 4);
assert.ok(viewports.every(([width, height]) => width >= 320 && height >= 568));

assert.match(styles, /min-height:\s*100dvh/, "the app must use the dynamic viewport height");
assert.match(styles, /safe-area-inset-top/, "the header must respect the Android status-bar inset");
assert.match(styles, /safe-area-inset-bottom/, "bottom actions must respect the navigation-bar inset");
assert.match(styles, /\.app-page\s*\{[\s\S]*?100dvh/, "game pages need shared dynamic-viewport framing");
assert.match(styles, /\.app-drawer\s*\{[\s\S]*?100dvh/, "drawers must fit a dynamic viewport");

assert.match(layout, /app-shell relative flex flex-col/);
assert.doesNotMatch(layout, /min-h-screen overflow-hidden/, "the shell must not clip vertically scrolling pages");
assert.match(layout, /min-\[360px\]:inline/, "the brand wordmark must collapse on compact headers");
assert.match(layout, /min-\[390px\]:inline-flex/, "secondary header metadata must collapse before it crowds controls");

for (const [name, source] of Object.entries({ results, leaderboard, rating, prediction, writing, reveal, lobby, finalResults })) {
  assert.match(source, /app-page/, `${name} must use the shared mobile page frame`);
}

assert.match(results, /mx-auto w-full max-w-2xl rounded-3xl/, "the Round Results prediction card must size to its content");
assert.doesNotMatch(results, /flex flex-1 flex-col justify-center rounded-3xl/, "the Round Results prediction card must not consume the remaining viewport height");
assert.match(leaderboard, /mt-6 space-y-2\.5 sm:mt-10/, "leaderboard spacing should compact on phones");
assert.match(reveal, /safe-action-bottom/, "Subject Reveal action must remain above Android navigation controls");
assert.match(rating, /className="rating-stars"/, "rating stars must use the dedicated narrow-screen layout");
assert.match(styles, /\.rating-stars > button/, "rating stars must fit narrow screens without global scaling");
assert.match(stars, /style=\{\{ width: size, height: size \}\}/, "desktop rating target sizing must remain unchanged");
assert.match(settings, /app-drawer/, "settings drawer needs safe-area framing");
assert.match(chat, /app-drawer--with-footer/, "chat input must retain its own safe bottom padding");
assert.match(quitDialog, /max-h-\[calc\(100dvh-2rem\)\]/, "Quit Game dialog must scroll instead of clipping");

console.log(`Mobile layout regression passed for ${viewports.map(([width, height]) => `${width}x${height}`).join(", ")}.`);
