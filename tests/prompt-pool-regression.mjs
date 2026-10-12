// Prompt selection: mode separation, key handling, repetition, diagnostics.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADULT_FALLBACK, FAMILY_FALLBACK, selectPrompt, selectPromptDetailed } from '../base44/shared/game.ts';
import { MIN_HEALTHY_PROMPT_POOL, PROMPT_QUERY_LIMIT, PROMPT_QUERY_SORT, buildPromptPool, normalizeMode } from '../base44/shared/promptPool.ts';
import { parseCsv } from '../prompt-library/promptCsv.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csv = parseCsv(await readFile(path.join(ROOT, 'prompt-library/Prompt_export.updated.csv'), 'utf8'));
const productionRows = csv.rows.map((r) => ({ ...r, active: r.active === 'true' }));

// Capture the server log lines the diagnostics produce.
const logs = [];
const realWarn = console.warn; const realError = console.error;
console.warn = (line) => logs.push({ level: 'warn', line: String(line) });
console.error = (line) => logs.push({ level: 'error', line: String(line) });
const takeLogs = () => logs.splice(0);
const events = (entries) => entries.map((e) => JSON.parse(e.line.replace('[prompt-pool] ', '')).event);

const dbWith = (rows, calls = []) => ({
  asServiceRole: { entities: { Prompt: { filter: async (...args) => { calls.push(args); return typeof rows === 'function' ? rows(...args) : rows; } } } },
});
const play = async (db, mode, rounds) => {
  const used = []; let last = null; const picked = [];
  for (let i = 0; i < rounds; i++) {
    const p = await selectPrompt(db, mode, used, last, []);
    picked.push(p); used.push(p.id); last = p.category;
  }
  return picked;
};

async function mixedDatabaseNeverCrossesModes() {
  // A database that ignores the mode filter and returns all 150 prompts.
  const db = dbWith(productionRows);
  const adult = await play(db, 'adult', 90);
  assert.ok(adult.every((p) => p.id.startsWith('a')), 'Adult mode only ever gets Adult prompts');
  const family = await play(db, 'family', 60);
  assert.ok(family.every((p) => p.id.startsWith('f')), 'Family mode only ever gets Family prompts');
  const seen = events(takeLogs());
  assert.ok(seen.includes('integrity'), 'wrong-mode records are reported in the server log');

  const { diagnostics } = await selectPromptDetailed(db, 'adult', [], null, []);
  assert.equal(diagnostics.excluded.wrong_mode, 60);
  assert.equal(diagnostics.usable, 90);
  takeLogs();

  // A record whose own mode is missing cannot be verified, so it is not used.
  const unverified = buildPromptPool('family', [{ prompt_key: 'x', text: 'No mode [NAME]?', category: 'A' }]);
  assert.equal(unverified.pool.length, 0);
  assert.equal(unverified.diagnostics.excluded.wrong_mode, 1);
  // Inactive and blank records are excluded as well.
  const mixed = buildPromptPool('adult', [
    { prompt_key: 'ok', mode: 'adult', active: true, text: 'Fine [NAME]?', category: 'A' },
    { prompt_key: 'off', mode: 'adult', active: false, text: 'Off [NAME]?', category: 'A' },
    { prompt_key: 'blank', mode: 'adult', active: true, text: '   ', category: 'A' },
  ]);
  assert.deepEqual(mixed.pool.map((p) => p.id), ['ok']);
  assert.deepEqual(mixed.diagnostics.excluded, { wrong_mode: 0, inactive: 1, blank_text: 1 });
}

async function fullLibraryIsUsedWithoutRepeats() {
  const calls = [];
  const db = dbWith(productionRows.filter((r) => r.mode === 'adult'), calls);
  const adult = await play(db, 'adult', 90);
  assert.equal(new Set(adult.map((p) => p.id)).size, 90, 'all 90 Adult prompts are used once before any repeat');
  assert.equal(takeLogs().length, 0, 'a healthy library logs nothing');
  const familyDb = dbWith(productionRows.filter((r) => r.mode === 'family'));
  const family = await play(familyDb, 'family', 60);
  assert.equal(new Set(family.map((p) => p.id)).size, 60, 'all 60 Family prompts are used once before any repeat');
  // Pool exhausted: reuse is allowed but reported.
  const wrapped = await play(familyDb, 'family', 61);
  assert.equal(wrapped.length, 61);
  assert.ok(events(takeLogs()).includes('pool_exhausted'));
  // The query is explicit about mode, active, sort and limit.
  assert.deepEqual(calls[0][0], { mode: 'adult', active: true });
  assert.equal(calls[0][1], PROMPT_QUERY_SORT);
  assert.equal(calls[0][2], PROMPT_QUERY_LIMIT);
  assert.ok(PROMPT_QUERY_LIMIT >= 150, 'limit comfortably covers the whole library');
}

async function repetitionAvoidsUsedAndRecentCategory() {
  const rows = ['A', 'A', 'B', 'C'].map((category, i) => ({ id: `r${i}`, prompt_key: `k${i}`, mode: 'adult', active: true, text: `Prompt ${i} [NAME]?`, category }));
  for (let i = 0; i < 40; i++) {
    const p = await selectPrompt(dbWith(rows), 'adult', ['k0', 'k2'], 'A', []);
    assert.ok(['k3'].includes(p.id), 'unused prompt from a different category is chosen when one exists');
  }
  takeLogs();
}

async function missingAndDuplicateKeysKeepTrackingReliable() {
  const rows = [
    { id: 'rec-b', prompt_key: 'dup', mode: 'adult', active: true, text: 'Second [NAME]?', category: 'A' },
    { id: 'rec-a', prompt_key: 'dup', mode: 'adult', active: true, text: 'First [NAME]?', category: 'B' },
    { id: 'rec-c', prompt_key: '', mode: 'adult', active: true, text: 'No key [NAME]?', category: 'C' },
    { id: 'rec-d', mode: 'adult', active: true, text: 'Undefined key [NAME]?', category: 'D' },
  ];
  const { pool, diagnostics } = buildPromptPool('adult', rows);
  const ids = pool.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'every prompt has a unique id');
  assert.ok(ids.includes('dup') && ids.includes('dup#rec-b'), 'lowest record id keeps the key; the other is suffixed');
  assert.equal(pool.find((p) => p.id === 'dup').text, 'First [NAME]?', 'assignment does not depend on row order');
  assert.ok(ids.includes('rec-c') && ids.includes('rec-d'), 'missing keys fall back to the record id');
  assert.equal(diagnostics.duplicate_key, 1);
  assert.equal(diagnostics.missing_key, 2);
  // Using both duplicates one after another never repeats the first.
  const used = [];
  for (let i = 0; i < 4; i++) used.push((await selectPrompt(dbWith(rows), 'adult', used, null, [])).id);
  assert.equal(new Set(used).size, 4, 'used-prompt tracking stays correct with duplicate keys');
  // Duplicate text and a missing placeholder are reported, not rewritten.
  const odd = buildPromptPool('adult', [
    { id: '1', prompt_key: 'p1', mode: 'adult', text: 'Same [NAME]?', category: 'A' },
    { id: '2', prompt_key: 'p2', mode: 'adult', text: 'same   [name]?'.replace('[name]', '[NAME]'), category: 'A' },
    { id: '3', prompt_key: 'p3', mode: 'adult', text: 'No name here', category: 'A' },
  ]);
  assert.equal(odd.diagnostics.duplicate_text, 1);
  assert.equal(odd.diagnostics.missing_placeholder, 1);
  assert.equal(odd.pool.find((p) => p.id === 'p3').text, 'No name here', 'production text is never altered');
  takeLogs();
}

async function failuresAreDistinguishableAndPrivate() {
  const secret = 'SECRET-TOKEN-abc123 connection to db.internal refused';
  const down = await selectPromptDetailed(dbWith(() => { throw new Error(secret); }), 'adult', [], null, []);
  assert.equal(down.source, 'fallback');
  assert.equal(down.fallbackReason, 'db_error');
  assert.ok(ADULT_FALLBACK.some((p) => p.id === down.prompt.id));
  let entries = takeLogs();
  assert.deepEqual(events(entries), ['db_error']);
  assert.equal(entries[0].level, 'error');
  assert.ok(!JSON.stringify(down).includes('SECRET'), 'the error text never reaches the returned prompt');
  assert.ok(!entries[0].line.includes('SECRET'), 'backend exception messages never enter prompt-pool logs');
  assert.deepEqual(Object.keys(down.prompt).sort(), ['category', 'id', 'text']);

  const empty = await selectPromptDetailed(dbWith([]), 'family', [], null, []);
  assert.equal(empty.fallbackReason, 'db_empty');
  assert.ok(FAMILY_FALLBACK.some((p) => p.id === empty.prompt.id));
  assert.deepEqual(events(takeLogs()), ['db_empty']);

  const unusable = await selectPromptDetailed(dbWith([{ prompt_key: 'x', mode: 'family', text: '', category: 'A' }]), 'adult', [], null, []);
  assert.equal(unusable.fallbackReason, 'no_usable_rows');
  assert.deepEqual(events(takeLogs()), ['no_usable_rows']);

  const good = await selectPromptDetailed(dbWith(productionRows.filter((r) => r.mode === 'adult')), 'adult', [], null, []);
  assert.equal(good.source, 'database');
  assert.equal(good.fallbackReason, undefined);
  // Log lines never contain prompt wording.
  assert.ok(!entries.concat(takeLogs()).some((e) => /\[NAME\]/.test(e.line)));
}

async function smallLibrariesAreUsedAsIsAndReported() {
  const rows = productionRows.filter((r) => r.mode === 'adult').slice(0, 5);
  assert.ok(rows.length < MIN_HEALTHY_PROMPT_POOL);
  const picked = await play(dbWith(rows), 'adult', 12);
  assert.ok(picked.every((p) => rows.some((r) => r.prompt_key === p.id)), 'valid production data is used, never replaced by fallback or invented prompts');
  assert.ok(events(takeLogs()).includes('small_pool'));

  // A result that hits the query limit is flagged as possibly truncated.
  const many = Array.from({ length: PROMPT_QUERY_LIMIT }, (_, i) => ({ id: `r${i}`, prompt_key: `k${i}`, mode: 'adult', active: true, text: `P${i} [NAME]?`, category: 'A' }));
  await selectPromptDetailed(dbWith(many), 'adult', [], null, []);
  assert.ok(events(takeLogs()).includes('query_limit_reached'));
}

function modeIsNormalised() {
  assert.equal(normalizeMode('adult'), 'adult');
  assert.equal(normalizeMode('family'), 'family');
  assert.equal(normalizeMode(undefined), 'family');
  assert.equal(normalizeMode('ADULT '), 'family', 'anything unrecognised is the safe Family mode');
}

async function roomFunctionStillSelectsByRoomMode() {
  const entry = await readFile(path.join(ROOT, 'base44/functions/room/entry.ts'), 'utf8');
  assert.match(entry, /selectPrompt\(base44, room\.mode, \[\], null, \[\]\)/, 'start uses the room\'s saved mode');
  const game = await readFile(path.join(ROOT, 'base44/shared/game.ts'), 'utf8');
  assert.match(game, /selectPrompt\(base44, gs\.mode, /, 'later rounds use the mode stored in game state');
}

try {
  await mixedDatabaseNeverCrossesModes();
  await fullLibraryIsUsedWithoutRepeats();
  await repetitionAvoidsUsedAndRecentCategory();
  await missingAndDuplicateKeysKeepTrackingReliable();
  await failuresAreDistinguishableAndPrivate();
  await smallLibrariesAreUsedAsIsAndReported();
  modeIsNormalised();
  await roomFunctionStillSelectsByRoomMode();
} finally {
  console.warn = realWarn; console.error = realError;
}
console.log('Prompt pool regressions passed.');
