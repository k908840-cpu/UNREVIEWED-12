# Prompt library: files and safe Base44 update procedure

Nothing in this folder talks to Base44. Every script reads and writes local files only. **No change has been applied to the live database.**

| File | Purpose |
| --- | --- |
| `Prompt_export.original.csv` | Backup: the untouched export of the 150 live prompts (sha256 `948360a6…f50ff74`). |
| `Prompt_export.updated.csv` | The approved library: identical to the original except the `text` of 18 Adult prompts. |
| `adult-prompt-changes.md` | Old and new wording for all 18 ids, plus category/format proposals (not applied). |
| `adult-prompt-replacements.json` | The approved replacement wording (source of truth for the 18 changes). |
| `base44-record-updates.json` | Per-record update list: Base44 record `id`, `prompt_key`, `old_text`, `new_text`. |
| `apply-adult-replacements.mjs` | Regenerates the updated CSV, report and record list from the original + approved list. |
| `verify-prompt-export.mjs` | Compares a fresh export to the approved CSV (read-only). |

## Why not "import the CSV"

The Base44 SDK documents `importEntities(file)` as returning an array of **created** entity objects, and nothing in the documentation says it matches existing records by `id` or `prompt_key`. Importing `Prompt_export.updated.csv` could therefore create 150 new records next to the 150 existing ones (300 prompts, duplicate `prompt_key` values, Adult and Family prompts repeating). The dashboard's own import screen may behave differently, but that could not be verified, so **do not use any CSV import for this change.** Use the record-specific update below, which can only modify the 18 named records.

## Procedure

1. **Back up the live data.** Export the `Prompt` entity from the Base44 dashboard (Data → Prompt) and keep the file, e.g. `Prompt_export.live-YYYYMMDD.csv`.
2. **Confirm the live data is the baseline.**
   `node prompt-library/verify-prompt-export.mjs Prompt_export.live-YYYYMMDD.csv prompt-library/Prompt_export.original.csv`
   It must print `PASS`. If it does not, stop: the live data has drifted and the 18 old texts may not match.
3. **Update the 18 records, one record each.** Use `base44-record-updates.json` (record `id`, current text, new text).
   - **Option A (manual, no code):** in the dashboard's Prompt data view, open each of the 18 records by `prompt_key`, check the text equals `old_text`, and replace it with `new_text`. Change nothing else.
   - **Option B (admin-only function, compare-and-set):** a one-off backend function (not part of this repository, so it is never deployed by accident) that, for each entry, reads the record by `id` and writes `{ text: new_text }` only when `prompt_key` matches and the live text still equals `old_text`. Default to a dry run. Sketch:

     ```ts
     import { createClientFromRequest } from 'npm:@base44/sdk@0.8.44';
     const UPDATES = [/* paste base44-record-updates.json here */];
     export default async function (req) {
       const base44 = createClientFromRequest(req);
       if ((await base44.auth.me())?.role !== 'admin') return Response.json({ error: 'forbidden' }, { status: 403 });
       const { apply = false } = await req.json().catch(() => ({}));
       const Prompt = base44.asServiceRole.entities.Prompt;
       const results = [];
       for (const u of UPDATES) {
         const rec = await Prompt.get(u.id);
         let status;
         if (rec.prompt_key !== u.prompt_key) status = 'skipped: key mismatch';
         else if (rec.text === u.new_text) status = 'already updated';
         else if (rec.text !== u.old_text) status = 'skipped: live text differs from expected';
         else if (!apply) status = 'would update';
         else { await Prompt.update(u.id, { text: u.new_text }); status = 'updated'; }
         results.push({ prompt_key: u.prompt_key, status });
       }
       return Response.json({ apply, results });
     }
     ```
     Run once without `apply`, read the 18 statuses, then once with `{ "apply": true }`. Delete the function afterwards.
4. **Re-export and verify.**
   `node prompt-library/verify-prompt-export.mjs Prompt_export.after-YYYYMMDD.csv`
   It must print `PASS`: 150 rows (90 Adult, 60 Family), all active, and every column except the usage counters and `updated_date` identical to the approved CSV.
5. **Smoke test.** Start an Adults-mode room with four players, play a few rounds, and confirm the new prompts read correctly with the nickname filled in. Check the backend log for `[prompt-pool]` lines (see below); a healthy library logs none.

**Rollback:** repeat step 3 with `new_text` and `old_text` swapped, then verify the re-export against `Prompt_export.original.csv`.

## Server log events (`[prompt-pool]`)

One JSON line per event, never containing prompt wording and never sent to players.

| Event | Level | Meaning |
| --- | --- | --- |
| `db_error` | error | The Prompt query threw; the built-in fallback list was used. |
| `db_empty` | error | The query worked but returned no prompts; fallback used. |
| `no_usable_rows` | error | Records came back but none were valid for the mode; fallback used. |
| `small_pool` | warn | Fewer than 30 usable prompts; used as-is (long games will repeat). |
| `query_limit_reached` | warn | The result hit the 1000-record limit and may be truncated. |
| `integrity` | warn | Records excluded or flagged: wrong `mode`, inactive, blank text, missing or duplicate `prompt_key`, duplicate text, or a missing `[NAME]`. |
| `pool_exhausted` | warn | Every prompt was already used in this game, so earlier ones repeat. |
