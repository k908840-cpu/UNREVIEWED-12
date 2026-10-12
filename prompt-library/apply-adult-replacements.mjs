// Builds Prompt_export.updated.csv from the untouched original export and the
// approved replacement list. Offline and repeatable: it reads two local files and
// writes local files only. It never talks to Base44.
//
//   node prompt-library/apply-adult-replacements.mjs
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, serializeCsv, placeholderCount } from './promptCsv.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// Proposals only. They are NOT applied: category/format are preserved in the CSV.
export const METADATA_PROPOSALS = {
  a001: 'category Confidence -> Romance (the old text was about confidence; the new one is a sexual-context line)',
  a002: 'category Hobby -> Romance (old text was a hobby prompt)',
  a005: 'format question -> slogan (asks for a slogan; the export already uses "slogan" once)',
  a011: 'category Book -> Romance (old text was an autobiography title; new one is a sex-tape title). Format "title" fits.',
  a071: 'format fill -> question (new text is a question, not a fill-in line)',
  a074: 'category Social -> Romance (one-night-stand review). Format "review" fits.',
  a087: 'category Absurd -> Romance (optional; adult-store ban)',
};

export function applyReplacements(originalCsv, replacements) {
  const parsed = parseCsv(originalCsv);
  const byKey = new Map(parsed.rows.map((r) => [r.prompt_key, r]));
  const changes = [];
  for (const { prompt_key: key, text } of replacements) {
    const row = byKey.get(key);
    if (!row) throw new Error(`Unknown prompt_key ${key}`);
    if (row.mode !== 'adult') throw new Error(`${key} is not an Adult prompt`);
    if (placeholderCount(text) !== 1) throw new Error(`${key} must contain exactly one [NAME]`);
    changes.push({ prompt_key: key, id: row.id, category: row.category, format: row.format, old: row.text, new: text });
    row.text = text;
  }
  return { csv: serializeCsv(parsed), changes };
}

// Record-specific update list for Base44: one entry per record id with the text
// expected to be live now (old_text) and the approved text (new_text). A runner
// should only write when the live text still equals old_text.
export function recordUpdates(changes) {
  return `${JSON.stringify(changes.map((c) => ({ id: c.id, prompt_key: c.prompt_key, old_text: c.old, new_text: c.new })), null, 2)}\n`;
}

export function changeReport(changes, { originalSha256 }) {
  const esc = (s) => s.replaceAll('|', '\\|');
  const lines = [
    '# Adult prompt changes (18 approved replacements)',
    '',
    `Source: \`Prompt_export.original.csv\` (sha256 \`${originalSha256}\`).`,
    'Only the `text` column of these 18 records differs in `Prompt_export.updated.csv`. Record `id`, `prompt_key`, `mode`, `category`, `format`, `active` and every other column are unchanged.',
    '',
    '| prompt_key | Base44 record id | Old text | New text |',
    '| --- | --- | --- | --- |',
    ...changes.map((c) => `| ${c.prompt_key} | ${c.id} | ${esc(c.old)} | ${esc(c.new)} |`),
    '',
    '## Category / format review (proposals only, not applied)',
    '',
    'Category and format were preserved as instructed. The selector uses `category` only to vary consecutive prompts; `format` is not read by the game. These would be the adjustments if you want them aligned with the new wording:',
    '',
    '| prompt_key | Current category / format | Proposal |',
    '| --- | --- | --- |',
    ...changes.map((c) => `| ${c.prompt_key} | ${c.category} / ${c.format} | ${METADATA_PROPOSALS[c.prompt_key] || 'Consistent with the new text; no change proposed.'} |`),
    '',
  ];
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('apply-adult-replacements.mjs')) {
  const { createHash } = await import('node:crypto');
  const originalPath = path.join(DIR, 'Prompt_export.original.csv');
  const original = await readFile(originalPath, 'utf8');
  const replacements = JSON.parse(await readFile(path.join(DIR, 'adult-prompt-replacements.json'), 'utf8'));
  const { csv, changes } = applyReplacements(original, replacements);
  await writeFile(path.join(DIR, 'Prompt_export.updated.csv'), csv, 'utf8');
  const originalSha256 = createHash('sha256').update(await readFile(originalPath)).digest('hex');
  await writeFile(path.join(DIR, 'adult-prompt-changes.md'), changeReport(changes, { originalSha256 }), 'utf8');
  await writeFile(path.join(DIR, 'base44-record-updates.json'), recordUpdates(changes), 'utf8');
  console.log(`Wrote Prompt_export.updated.csv, adult-prompt-changes.md and base44-record-updates.json (${changes.length} replacements).`);
}
