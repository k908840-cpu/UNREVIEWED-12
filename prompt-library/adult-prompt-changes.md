# Adult prompt changes (18 approved replacements)

Source: `Prompt_export.original.csv` (sha256 `948360a637fbc83610d838219e0f2aee11ad418674b4f9afde4dbcd59f50ff74`).
Only the `text` column of these 18 records differs in `Prompt_export.updated.csv`. Record `id`, `prompt_key`, `mode`, `category`, `format`, `active` and every other column are unchanged.

| prompt_key | Base44 record id | Old text | New text |
| --- | --- | --- | --- |
| a001 | 6aae3c4a6e142998a117db3f | What's something [NAME] is way too confident they're good at? | What would [NAME] say during sex that would make someone immediately call an Uber? |
| a002 | 6aae3c4a6e142998a117db40 | What completely normal hobby would become creepy if [NAME] did it? | [NAME] gets exposed in a celebrity sex scandal. What's the most embarrassing detail? |
| a003 | 6aae3c4a6e142998a117db41 | What's something you'd trust a stranger with before trusting [NAME]? | What's the one thing you'd never trust [NAME] to do at a bachelor or bachelorette party? |
| a005 | 6aae3c4a6e142998a117db43 | What would [NAME] somehow make worse by helping? | [NAME] accidentally becomes the face of a fetish website. What's their slogan? |
| a011 | 6aae3c4a6e142998a117db49 | Write the title of [NAME]'s autobiography. | Write the title of [NAME]'s extremely disappointing sex tape. |
| a013 | 6aae3c4a6e142998a117db4b | What's the one thing nobody should ever ask [NAME] for advice about? | What's the worst advice [NAME] could give someone about losing their virginity? |
| a036 | 6aae3c4a6e142998a117db62 | What's the most suspicious thing police could find in [NAME]'s car? | Police raid [NAME]'s house. What's the one thing even the officers refuse to touch? |
| a039 | 6aae3c4a6e142998a117db65 | What's the dumbest crime [NAME] could successfully pull off? | [NAME] commits the world's dumbest crime. What was the motive? |
| a055 | 6aae3c4a6e142998a117db75 | What's the least heroic way [NAME] could save someone's life? | [NAME] saves someone's life, but somehow makes it deeply inappropriate. How? |
| a063 | 6aae3c4a6e142998a117db7d | Which website would you be least surprised to discover [NAME] moderates? | [NAME] gets caught moderating an extremely disturbing online community. What's it called? |
| a068 | 6aae3c4a6e142998a117db82 | What's the worst company [NAME] could become CEO of? | [NAME] launches a company that's immediately investigated. What does it sell? |
| a069 | 6aae3c4a6e142998a117db83 | [NAME] becomes a billionaire. What's their first terrible purchase? | [NAME] wins $10 million. What's their most sexually questionable purchase? |
| a071 | 6aae3c4a6e142998a117db85 | Write the worst possible line on [NAME]'s résumé. | What's the most disturbing thing [NAME] could list under 'special skills' on their résumé? |
| a074 | 6aae3c4a6e142998a117db88 | Write a one-star review of [NAME] as a roommate. | Write a one-star review of [NAME] as a one-night stand. |
| a075 | 6aae3c4a6e142998a117db89 | [NAME] becomes your doctor. What's your first concern? | [NAME] becomes a doctor. What sentence gets their medical licence revoked? |
| a079 | 6aae3c4a6e142998a117db8d | [NAME] becomes president. What's banned first? | [NAME] becomes president. What's their first wildly inappropriate executive order? |
| a081 | 6aae3c4a6e142998a117db8f | Scientists clone [NAME]. What's the first problem? | Scientists clone [NAME]. What disgusting habit makes them destroy the clone? |
| a087 | 6aae3c4a6e142998a117db95 | What animal would immediately reject [NAME] as one of its own? | [NAME] gets banned from an adult store. What did they do? |

## Category / format review (proposals only, not applied)

Category and format were preserved as instructed. The selector uses `category` only to vary consecutive prompts; `format` is not read by the game. These would be the adjustments if you want them aligned with the new wording:

| prompt_key | Current category / format | Proposal |
| --- | --- | --- |
| a001 | Confidence / question | category Confidence -> Romance (the old text was about confidence; the new one is a sexual-context line) |
| a002 | Hobby / question | category Hobby -> Romance (old text was a hobby prompt) |
| a003 | Trust / question | Consistent with the new text; no change proposed. |
| a005 | Absurd / question | format question -> slogan (asks for a slogan; the export already uses "slogan" once) |
| a011 | Book / title | category Book -> Romance (old text was an autobiography title; new one is a sex-tape title). Format "title" fits. |
| a013 | Advice / question | Consistent with the new text; no change proposed. |
| a036 | Crime / question | Consistent with the new text; no change proposed. |
| a039 | Crime / question | Consistent with the new text; no change proposed. |
| a055 | Death / question | Consistent with the new text; no change proposed. |
| a063 | Tech / question | Consistent with the new text; no change proposed. |
| a068 | Work / question | Consistent with the new text; no change proposed. |
| a069 | Money / question | Consistent with the new text; no change proposed. |
| a071 | Work / fill | format fill -> question (new text is a question, not a fill-in line) |
| a074 | Social / review | category Social -> Romance (one-night-stand review). Format "review" fits. |
| a075 | Work / question | Consistent with the new text; no change proposed. |
| a079 | Absurd / question | Consistent with the new text; no change proposed. |
| a081 | Absurd / question | Consistent with the new text; no change proposed. |
| a087 | Absurd / question | category Absurd -> Romance (optional; adult-store ban) |
