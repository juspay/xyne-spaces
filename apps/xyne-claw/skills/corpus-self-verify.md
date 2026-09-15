---
name: corpus-self-verify
description: Self-check before delivering — autonomously, no human approval. Part A (EVERY answer, no exceptions) is citation integrity — every claim cites a doc id returned by a query run this session; absence stays absence. Part B (any count / trend / ranking / audit / complete list — Rule 7's trigger) is the full measurement checklist. Invoke this skill whenever you are about to state a number, a share, a trend verdict, a said-vs-done judgement, or a "complete list", and before locking an analysis spec. Fix failures by re-running (never by hand-editing a number), and only then deliver.
---

# Corpus Self-Verify — check your own work before delivering

The trust in an answer comes from a contract, not from confidence. This check is autonomous:
do not ask the user to approve or confirm. If any check fails, fix the cause (re-run the
query or the definition) and re-verify. Only deliver once every applicable check passes.

The check has two parts with different triggers:

- **Part A — citation integrity. Applies to EVERY answer**, including plain READ lookups.
  These checks are cheap and unconditional; the system prompt restates them so they bind
  even on turns where this skill isn't read.
- **Part B — measurement integrity. Applies whenever the draft contains any MEASURE /
  EXHAUST / RELATE result** — a count, trend, ranking, audit verdict, or complete list.
  For these answers, read this skill and run both parts against the draft before delivering.

## Part A — citation integrity (every answer)

1. **Every factual claim carries a citation that exists.** Each claim traces to a doc id
   that appeared in a query result *this session*. A claim with no backing query is removed
   or re-fetched — never delivered from memory.
2. **Citations are copied, never composed.** A doc id is pasted from a result, not
   reconstructed from a pattern. If you cannot point to the exact result it came from, it is
   not a citation.
3. **The id itself ships in the final answer, as a plain-text token.** A citation IS the
   doc id, verbatim, in square brackets with no code formatting: `[clf-ab12#7]` after the
   claim, punctuation outside the brackets. Wrapping the token in backticks breaks the
   citation renderer — the chip won't display — and a prose source name ("the Retry canvas")
   may accompany the token, never replace it. Grounding that ships without its plain token is
   unverifiable, which fails this check regardless of how careful the reasoning was. Both
   observed failure modes happened at the final drafting step: correct ids collected, then
   swapped for friendly labels (session 8) or wrapped in code formatting (session 9). The
   draft you verify is the draft you deliver — do not reformat tokens after checking them.
4. **Categorical claims match their evidence.** "X does not work when Y", "X requires Z" —
   the cited snippet actually says that, not something adjacent to it. An absolute claim on
   an approximate citation is an overreach.
5. **Absence is reported as absence.** "Not found in the corpus" is said exactly so — never
   silently converted to "it didn't happen", never padded when evidence is thin.

## Part B — measurement integrity (any count / trend / ranking / audit / list)

1. **Numbers came from a tool, not from hits.** Every number traces to a `spaces-corpus-scan`
   or `groupBy` result. If any figure came from counting a page of search results by hand, it
   is not a real count — re-run it as a count.
2. **Totals are the tool's or the sandbox's, not yours.** Never sum bucket rows by hand to
   produce a period total — a live run hand-summed seven month buckets and delivered 1,713
   where the true sum was 2,152, inside an otherwise fully compliant answer. Use the tool's
   returned totals (`termTotals` / `windowTotal` when present); for any derived number the
   tool doesn't return (sub-window sums, differences, ratios, top-N, dedup, verdict bands),
   compute it in the **sandbox** from the tool's verbatim JSON and copy the printed output.
   The JSON goes into a data file the script parses — numbers retyped into the script body
   are transposition risk, not an audit trail. A derived number with no script behind it
   fails this check.
3. **Denominators match the numerators.** Every share is `count ÷ that bucket's own total`,
   and the term query and the total query used the identical scope and filters. A share built
   from mismatched filters is wrong even if it looks plausible.
4. **Multi-word terms were counted as exact phrases.** Sanity test: a phrase can never
   out-count its own word (`"refund complaint"` ≤ `"refund"`). If it does, the phrase was
   matched loosely — re-run with the exact phrase.
5. **Every relevant surface is counted, or the missing ones are named.** The thing counted
   usually lives in more than one place (mail, tickets, chat). Either count each surface
   separately (never summed) or state which surface you counted and which you left out. An
   unstated surface is a silent undercount.
6. **No claim overreaches the data.**
   - A decision is not called *done* without separate, later proof — a statement is `[stated]`
     until outcome evidence exists.
   - A trend is not claimed from raw counts — only from shares.
   - A complete list is not given without counting the true size first and naming what is
     uncovered.
7. **The numbers are internally sane.** Spot-check: a phrase ≤ its word; no bucket with a zero
   total but a non-zero term; shares in a plausible range; the trend story matches the share
   column, not the raw column.

## On failure — fix the machine, not the number

If a check fails, correct the cause — the query, the phrase, the scope, the surface list — and
re-run. Never hand-edit a number, invent or adjust a citation, or quietly drop a caveat to
make a check pass. A number or citation that had to be hand-patched is a defect even if it
happens to be right.

## For a written analysis (packs + stats)

When the deliverable was produced through the written-analysis pipeline (spec → evidence
packs → stats → write), three checks are added on top of Parts A and B:

1. **Citations are closed-set.** Every cited row exists in one of this analysis's pack
   files — not merely "somewhere in the corpus". Run the membership check as a sandbox
   script over the draft + pack files; a citation outside the packs means the writer
   searched, which is the confirmation-bias hole the packs exist to close.
2. **Numbers are closed-set.** Every figure in the draft appears in `stats.json`. A number
   with no stats entry is a defect even if it happens to be right.
3. **Coverage is carried forward.** The delivered analysis includes each pack's coverage
   note (buckets fetched/skipped, caps) and the spec version it was produced under.

## For a locked analysis spec (replacing human approval)

When an analysis is big enough to warrant a written spec, still write it down (topics as exact
phrases, surfaces counted separately, scope, unit, numeric verdict bands) — for the record and
for reproducibility. But instead of waiting for a person to approve it, self-verify the spec
against this checklist, then lock it yourself and proceed. The spec canvas becomes an audit
trail, not a gate. Once locked and started, a wrong rule means a *new* spec version and a
re-run — not a quiet edit.
