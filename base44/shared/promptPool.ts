// Prompt pool validation and server-side diagnostics for selectPrompt.
// Pure functions only (no Base44 calls) so they can be unit tested.
//
// Diagnostics go to the server log as one JSON line per event under the
// "[prompt-pool]" prefix. They never include prompt text and are never returned
// to clients, so players cannot see backend error details.

export type PoolPrompt = { id: string; text: string; category: string };

export type PoolDiagnostics = {
  mode: string;
  fetched: number;
  usable: number;
  excluded: { wrong_mode: number; inactive: number; blank_text: number };
  missing_key: number;
  duplicate_key: number;
  duplicate_text: number;
  missing_placeholder: number;
  truncated: boolean;
  small_pool: boolean;
};

// Documented default for the array form of Prompt.filter() is 5000 records; the
// limit is passed explicitly so the behaviour does not depend on the default.
export const PROMPT_QUERY_LIMIT = 1000;
export const PROMPT_QUERY_SORT = 'prompt_key';
// A standard 8-player Party game is 40 rounds. Below this the same prompts will
// come round again in a long game, which is worth a warning (never a rewrite).
export const MIN_HEALTHY_PROMPT_POOL = 30;

export function normalizeMode(mode: unknown): 'adult' | 'family' {
  return mode === 'adult' ? 'adult' : 'family';
}

const normText = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

export function buildPromptPool(mode: 'adult' | 'family', rows: any[]): { pool: PoolPrompt[]; diagnostics: PoolDiagnostics } {
  const diagnostics: PoolDiagnostics = {
    mode, fetched: rows.length, usable: 0,
    excluded: { wrong_mode: 0, inactive: 0, blank_text: 0 },
    missing_key: 0, duplicate_key: 0, duplicate_text: 0, missing_placeholder: 0,
    truncated: rows.length >= PROMPT_QUERY_LIMIT, small_pool: false,
  };

  // 1. Validate each record. The query already filters by mode and active, but a
  //    record is only used if its own fields say so.
  const valid: any[] = [];
  for (const r of rows) {
    if (r?.mode !== mode) { diagnostics.excluded.wrong_mode++; continue; }
    if (r.active === false) { diagnostics.excluded.inactive++; continue; }
    if (typeof r.text !== 'string' || !r.text.trim()) { diagnostics.excluded.blank_text++; continue; }
    valid.push(r);
  }

  // 2. Give every prompt a unique, stable id so used-prompt tracking is reliable.
  //    A blank prompt_key falls back to the record id (existing behaviour); of
  //    several records sharing a key, the lowest record id keeps the plain key and
  //    the others get "<key>#<record id>".
  const keyOf = (r: any) => (typeof r.prompt_key === 'string' ? r.prompt_key.trim() : '');
  const groups = new Map<string, any[]>();
  valid.forEach((r, index) => {
    const key = keyOf(r);
    if (!key) diagnostics.missing_key++;
    const base = key || String(r.id ?? `unkeyed-${index}`);
    const list = groups.get(base) || [];
    list.push(r);
    groups.set(base, list);
  });

  const pool: PoolPrompt[] = [];
  const seenText = new Set<string>();
  for (const [base, list] of groups) {
    const ordered = list.length > 1
      ? [...list].sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')))
      : list;
    ordered.forEach((r, i) => {
      if (i > 0) diagnostics.duplicate_key++;
      const id = i === 0 ? base : `${base}#${r.id ?? i}`;
      const text = r.text;
      const norm = normText(text);
      if (seenText.has(norm)) diagnostics.duplicate_text++;
      seenText.add(norm);
      if ((text.match(/\[NAME\]/g) || []).length !== 1) diagnostics.missing_placeholder++;
      pool.push({ id, text, category: r.category || 'General' });
    });
  }

  diagnostics.usable = pool.length;
  diagnostics.small_pool = pool.length > 0 && pool.length < MIN_HEALTHY_PROMPT_POOL;
  return { pool, diagnostics };
}

export function logPromptPool(level: 'warn' | 'error', event: string, details: Record<string, unknown>) {
  try { console[level](`[prompt-pool] ${JSON.stringify({ event, ...details })}`); } catch { /* logging must never break a game */ }
}

// Safe classification of a thrown error for the server log (not shown to
// players). Backend/SDK messages can contain credentials, URLs, or record data,
// so they must never be copied into a log event.
export function describeError(e: unknown): string {
  const status = Number((e as any)?.response?.status);
  if (Number.isInteger(status) && status >= 100 && status <= 599) return `http_${status}`;
  if (e instanceof Error && e.name) return e.name.slice(0, 80);
  return 'unknown';
}
