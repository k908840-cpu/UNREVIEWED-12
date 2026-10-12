// Read-only comparison of a fresh Base44 `Prompt` export against the approved
// updated CSV. Use it after the 18 records are changed in Base44 (re-export the
// entity, then run this). It reads two local files and never talks to Base44.
//
//   node prompt-library/verify-prompt-export.mjs <fresh-export.csv> [expected.csv]
//
// Columns that legitimately change during play or on update (usage counters and
// timestamps) are ignored; everything else must match record by record.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, placeholderCount } from './promptCsv.mjs';

export const VOLATILE_COLUMNS = new Set(['updated_date', 'times_played', 'avg_answer_rating', 'rating_count']);

export function compareExports(expectedCsv, actualCsv) {
  const expected = parseCsv(expectedCsv);
  const actual = parseCsv(actualCsv);
  const problems = [];
  const keyed = (rows, label) => {
    const map = new Map();
    for (const r of rows) {
      if (!r.prompt_key) { problems.push(`${label}: record ${r.id || '?'} has no prompt_key`); continue; }
      if (map.has(r.prompt_key)) problems.push(`${label}: duplicate prompt_key ${r.prompt_key}`);
      map.set(r.prompt_key, r);
    }
    return map;
  };
  const want = keyed(expected.rows, 'expected');
  const got = keyed(actual.rows, 'export');
  for (const key of want.keys()) if (!got.has(key)) problems.push(`MISSING in export: ${key}`);
  for (const key of got.keys()) if (!want.has(key)) problems.push(`EXTRA in export: ${key}`);
  for (const [key, w] of want) {
    const g = got.get(key);
    if (!g) continue;
    for (const column of expected.header) {
      if (VOLATILE_COLUMNS.has(column)) continue;
      if (w[column] !== g[column]) problems.push(`MISMATCH ${key}.${column}: expected ${JSON.stringify(w[column])} but export has ${JSON.stringify(g[column])}`);
    }
    if (placeholderCount(g.text || '') !== 1) problems.push(`PLACEHOLDER ${key}: expected exactly one [NAME]`);
    if (g.active !== 'true') problems.push(`INACTIVE ${key}`);
  }
  const counts = { adult: 0, family: 0, other: 0 };
  for (const r of actual.rows) counts[r.mode === 'adult' ? 'adult' : r.mode === 'family' ? 'family' : 'other']++;
  if (actual.rows.length !== expected.rows.length) problems.push(`ROW COUNT: expected ${expected.rows.length}, export has ${actual.rows.length}`);
  return { ok: problems.length === 0, problems, counts, rows: actual.rows.length };
}

if (process.argv[1]?.endsWith('verify-prompt-export.mjs')) {
  const [actualPath, expectedPath] = process.argv.slice(2);
  if (!actualPath) { console.error('Usage: node prompt-library/verify-prompt-export.mjs <fresh-export.csv> [expected.csv]'); process.exit(2); }
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const result = compareExports(
    await readFile(expectedPath || path.join(dir, 'Prompt_export.updated.csv'), 'utf8'),
    await readFile(actualPath, 'utf8'),
  );
  console.log(`rows: ${result.rows} (adult ${result.counts.adult}, family ${result.counts.family}, other ${result.counts.other})`);
  if (result.ok) console.log('PASS: export matches the approved prompt library.');
  else { result.problems.forEach((p) => console.log(p)); console.log(`FAIL: ${result.problems.length} problem(s).`); process.exit(1); }
}
