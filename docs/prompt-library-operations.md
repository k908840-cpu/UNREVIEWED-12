# Prompt library operations

The current production prompt count is **not verifiable from this local
repository**. The fallback lists are source-controlled resilience content; they
are not an export of the live Base44 `Prompt` entity and must not be used to
infer how many live prompts exist.

> **Current approved library and update procedure:** see `prompt-library/README.md`
> (150 prompts, 18 approved Adult replacements, record-specific update steps, and the
> `[prompt-pool]` server log events). The selector now requests an explicit sort and
> limit, validates each record's `mode`, and logs database failures separately from an
> empty collection.

The server selects prompts from Base44 with this filter:

```ts
base44.asServiceRole.entities.Prompt.filter({ mode, active: true }, 'prompt_key', 1000)
```

It then avoids already-used prompt keys where possible, avoids the immediately
previous category where possible, and prefers a category the current Subject
has not seen. If the database query fails or has no results, the server uses a
mode-specific fallback. Adults and Family fallbacks use separate IDs and are
never mixed.

## Read-only audit of the live library

Use an approved Base44 admin/dashboard session to export the `Prompt` entity as
read-only data. Do not put an admin token in a script or in this repository.

Before changing production, record:

1. Total row count and counts grouped by `mode` and `active`.
2. Duplicate or blank `prompt_key` values.
3. Empty prompt text and unsupported mode values.
4. Categories represented in each mode.
5. A dated checksum of the exported file.

This is the only safe way to confirm whether the planned 150 prompts are live.

## Safe, repeatable import procedure

1. Export the current production records to a protected backup first.
2. Prepare a reviewed CSV/JSON containing the entity fields `prompt_key`,
   `text`, `mode`, `category`, `format`, and `active`. Do not generate missing
   keys, rows, or counts during import.
3. Run the import against a disposable/local Base44 dataset and test both modes
   with a four-player room. Verify no Family prompt can be selected in Adults
   mode and vice versa.
4. Compare the staged counts, key set, and checksums to the approved artifact.
5. In production, use the approved admin import/upsert workflow keyed by
   `prompt_key`. Do not truncate the entity or bulk-delete existing prompts.
6. Re-export after import and compare the count/checksum. Keep the original
   backup until live gameplay has been verified.

No production prompt data was read or changed for this local beta branch.
