// Verifies the prompt data files in prompt-library/ against the approved change
// list. Offline: reads local files only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, serializeCsv, placeholderCount } from '../prompt-library/promptCsv.mjs';
import { applyReplacements, changeReport, recordUpdates } from '../prompt-library/apply-adult-replacements.mjs';
import { compareExports } from '../prompt-library/verify-prompt-export.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prompt-library');
const read = (name) => readFile(path.join(DIR, name), 'utf8');

const ORIGINAL_SHA256 = '948360a637fbc83610d838219e0f2aee11ad418674b4f9afde4dbcd59f50ff74';
const APPROVED = [
  'a001', 'a002', 'a003', 'a005', 'a011', 'a013', 'a036', 'a039', 'a055',
  'a063', 'a068', 'a069', 'a071', 'a074', 'a075', 'a079', 'a081', 'a087',
];

const originalText = await read('Prompt_export.original.csv');
const updatedText = await read('Prompt_export.updated.csv');
const replacements = JSON.parse(await read('adult-prompt-replacements.json'));
const original = parseCsv(originalText);
const updated = parseCsv(updatedText);

// --- the backup is exactly the supplied export and the serializer is lossless
assert.equal(createHash('sha256').update(originalText).digest('hex'), ORIGINAL_SHA256, 'backup must be the untouched export');
assert.equal(serializeCsv(original), originalText, 'serializer reproduces the export byte for byte');
assert.equal(serializeCsv(updated), updatedText);

// --- counts, ids, placeholders
for (const [label, table] of [['original', original], ['updated', updated]]) {
  assert.equal(table.rows.length, 150, `${label}: 150 prompts`);
  assert.equal(table.rows.filter((r) => r.mode === 'adult').length, 90, `${label}: 90 Adult`);
  assert.equal(table.rows.filter((r) => r.mode === 'family').length, 60, `${label}: 60 Family`);
  assert.ok(table.rows.every((r) => r.active === 'true'), `${label}: all 150 active`);
  const keys = table.rows.map((r) => r.prompt_key);
  assert.equal(new Set(keys).size, 150, `${label}: no duplicate prompt_key`);
  assert.equal(new Set(table.rows.map((r) => r.id)).size, 150, `${label}: no duplicate record id`);
  const expectedKeys = [
    ...Array.from({ length: 90 }, (_, i) => `a${String(i + 1).padStart(3, '0')}`),
    ...Array.from({ length: 60 }, (_, i) => `f${String(i + 1).padStart(3, '0')}`),
  ];
  assert.deepEqual([...keys].sort(), expectedKeys.sort(), `${label}: a001-a090 and f001-f060, none missing`);
  assert.ok(table.rows.every((r) => placeholderCount(r.text) === 1), `${label}: exactly one [NAME] in every prompt`);
  assert.ok(table.rows.every((r) => (r.mode === 'adult') === r.prompt_key.startsWith('a')), `${label}: mode matches key prefix`);
}

// --- exactly the 18 approved replacements, nothing else
assert.deepEqual(replacements.map((r) => r.prompt_key), APPROVED, 'approved list is the 18 agreed ids');
const byKeyOld = new Map(original.rows.map((r) => [r.prompt_key, r]));
const byKeyNew = new Map(updated.rows.map((r) => [r.prompt_key, r]));
assert.deepEqual(updated.header, original.header, 'same columns in the same order');
assert.deepEqual(updated.rows.map((r) => r.prompt_key), original.rows.map((r) => r.prompt_key), 'same row order');

let textReplacements = 0;
for (const [key, before] of byKeyOld) {
  const after = byKeyNew.get(key);
  if (APPROVED.includes(key)) {
    const approved = replacements.find((r) => r.prompt_key === key).text;
    assert.equal(after.text, approved, `${key} carries the approved wording exactly`);
    assert.notEqual(after.text, before.text, `${key} text changed`);
    assert.equal(after.mode, 'adult', `${key} stays Adult`);
    for (const column of original.header) {
      if (column !== 'text') assert.equal(after[column], before[column], `${key}.${column} preserved (id, category, format, dates, ...)`);
    }
    textReplacements++;
  } else {
    assert.deepEqual(after, before, `${key} is unchanged`);
  }
}
assert.equal(textReplacements, 18, 'exactly 18 text replacements');
assert.equal(original.rows.filter((r) => !APPROVED.includes(r.prompt_key)).length, 132, '132 other prompts');
assert.ok(updated.rows.filter((r) => r.mode === 'family').every((r) => r.text === byKeyOld.get(r.prompt_key).text), 'all 60 Family prompts unchanged');

// --- no prompt text is shared between modes or repeated after the update
const norm = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();
const adultTexts = new Set(updated.rows.filter((r) => r.mode === 'adult').map((r) => norm(r.text)));
assert.ok(updated.rows.filter((r) => r.mode === 'family').every((r) => !adultTexts.has(norm(r.text))), 'no Adult prompt text equals a Family prompt');
assert.equal(new Set(updated.rows.map((r) => norm(r.text))).size, 150, 'no duplicate prompt text');

// --- the generator is reproducible and the committed outputs are current
const regenerated = applyReplacements(originalText, replacements);
assert.equal(regenerated.csv, updatedText, 'Prompt_export.updated.csv is what the generator produces');
assert.equal(regenerated.changes.length, 18);
assert.equal(await read('adult-prompt-changes.md'), changeReport(regenerated.changes, { originalSha256: ORIGINAL_SHA256 }), 'change report is current');
assert.equal(await read('base44-record-updates.json'), recordUpdates(regenerated.changes), 'record update list is current');
const recordList = JSON.parse(await read('base44-record-updates.json'));
assert.equal(recordList.length, 18);
for (const entry of recordList) {
  const before = byKeyOld.get(entry.prompt_key);
  assert.equal(entry.id, before.id, `${entry.prompt_key}: Base44 record id comes from the export`);
  assert.equal(entry.old_text, before.text);
  assert.equal(entry.new_text, byKeyNew.get(entry.prompt_key).text);
}
assert.throws(() => applyReplacements(originalText, [{ prompt_key: 'f001', text: 'Family [NAME]?' }]), /not an Adult/);
assert.throws(() => applyReplacements(originalText, [{ prompt_key: 'a999', text: 'x [NAME]' }]), /Unknown prompt_key/);
assert.throws(() => applyReplacements(originalText, [{ prompt_key: 'a001', text: 'No placeholder' }]), /exactly one/);

// --- the post-update verifier accepts the approved CSV and catches drift
assert.equal(compareExports(updatedText, updatedText).ok, true);
const drifted = serializeCsv({ ...updated, rows: updated.rows.map((r) => (r.prompt_key === 'a003' ? { ...r, text: 'drift [NAME]' } : r)) });
assert.match(compareExports(updatedText, drifted).problems.join('\n'), /MISMATCH a003\.text/);
assert.match(compareExports(updatedText, originalText).problems.join('\n'), /MISMATCH a001\.text/, 'un-updated export is flagged');
const duplicated = serializeCsv({ ...updated, rows: [...updated.rows, { ...updated.rows[0] }] });
assert.match(compareExports(updatedText, duplicated).problems.join('\n'), /duplicate prompt_key/);

console.log('Prompt library data regressions passed.');
