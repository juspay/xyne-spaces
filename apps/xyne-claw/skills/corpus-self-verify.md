---
name: corpus-self-verify
description: Self-check a count / trend / ranking / audit / list answer BEFORE delivering it — autonomously, no human approval. Invoke this whenever you are about to state a number, a share, a trend verdict, a said-vs-done judgement, or a "complete list", and before locking an analysis spec. Verify your own work against the checklist below, fix anything that fails by re-running (never by hand-editing a number), and only then deliver.
---

# Corpus Self-Verify — check your own work before delivering

The trust in a counted answer comes from a contract, not from confidence. Before you deliver
any count / trend / ranking / audit / list answer — and before you treat an analysis spec as
locked — run this checklist against your own draft. This is autonomous: do not ask the user
to approve or confirm. If any check fails, fix it (re-run the query or the definition) and
re-verify. Only deliver once every check passes.

## The checklist

1. **Numbers came from a tool, not from hits.** Every number traces to a `spaces-corpus-scan`
   or `groupBy` result. If any figure came from counting a page of search results by hand, it
   is not a real count — re-run it as a count.
2. **Denominators match the numerators.** Every share is `count ÷ that bucket's own total`,
   and the term query and the total query used the identical scope and filters. A share built
   from mismatched filters is wrong even if it looks plausible.
3. **Multi-word terms were counted as exact phrases.** Sanity test: a phrase can never
   out-count its own word (`"refund complaint"` ≤ `"refund"`). If it does, the phrase was
   matched loosely — re-run with the exact phrase.
4. **Every relevant surface is counted, or the missing ones are named.** The thing counted
   usually lives in more than one place (mail, tickets, chat). Either count each surface
   separately (never summed) or state which surface you counted and which you left out. An
   unstated surface is a silent undercount.
5. **No claim overreaches the data.**
   - A decision is not called *done* without separate, later proof — a statement is `[stated]`
     until outcome evidence exists.
   - A trend is not claimed from raw counts — only from shares.
   - A complete list is not given without counting the true size first and naming what is
     uncovered.
6. **Every claim carries a real citation.** No number or quote without a source that exists.
7. **Absence is reported as absence.** "Not found in the corpus" is said as exactly that —
   never silently converted to "it didn't happen", never padded when evidence is thin.
8. **The numbers are internally sane.** Spot-check: a phrase ≤ its word; no bucket with a zero
   total but a non-zero term; shares in a plausible range; the trend story matches the share
   column, not the raw column.

## On failure — fix the machine, not the number

If a check fails, correct the cause — the query, the phrase, the scope, the surface list — and
re-run. Never hand-edit a number or quietly drop a caveat to make a check pass. A number that
had to be hand-patched is a defect even if it happens to be right.

## For a locked analysis spec (replacing human approval)

When an analysis is big enough to warrant a written spec, still write it down (topics as exact
phrases, surfaces counted separately, scope, unit, numeric verdict bands) — for the record and
for reproducibility. But instead of waiting for a person to approve it, self-verify the spec
against this checklist, then lock it yourself and proceed. The spec canvas becomes an audit
trail, not a gate. Once locked and started, a wrong rule means a *new* spec version and a
re-run — not a quiet edit.
