// Prompt engine. Reads the approved prompt library from the database with a
// fallback to the built-in sample set so the game still runs before the
// library is imported.
import { base44 } from "@/api/base44Client";
import { FAMILY_PROMPTS, ADULT_PROMPTS } from "./mockData";

const FALLBACK = { family: FAMILY_PROMPTS, adult: ADULT_PROMPTS };

export async function loadPromptPool(mode) {
  try {
    const rows = await base44.entities.Prompt.filter({ mode, active: true });
    if (rows && rows.length) {
      return rows.map((r) => ({
        id: r.prompt_key || r.id,
        recordId: r.id,
        mode: r.mode,
        category: r.category || "General",
        format: r.format || "open",
        text: r.text,
      }));
    }
  } catch {
    // fall through to the sample set
  }
  return (FALLBACK[mode] || []).map((p) => ({
    id: p.id,
    mode: p.mode,
    category: p.category,
    format: "open",
    text: p.text,
  }));
}

// No duplicates, avoid repeating the previous category, prefer categories the
// current Subject hasn't seen yet.
export function selectPrompt({ pool, usedKeys, lastCategory, subjectSeenCategories }) {
  if (!pool || !pool.length) return null;
  const used = usedKeys || new Set();
  let candidates = pool.filter((p) => !used.has(p.id));
  if (!candidates.length) candidates = pool.slice();

  const varied = candidates.filter((p) => p.category !== lastCategory);
  if (varied.length) candidates = varied;

  if (subjectSeenCategories && subjectSeenCategories.length) {
    const fresh = candidates.filter((p) => !subjectSeenCategories.includes(p.category));
    if (fresh.length) candidates = fresh;
  }

  if (!candidates.length) candidates = pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}