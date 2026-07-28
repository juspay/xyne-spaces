---
name: corpus-question-router
description: Name the KIND of question before touching any tool, then bind the method that fits — find, count, cross-check, or sweep. READ THIS whenever a question contains "how many", "most", "trend", "all", "every", "did we actually", "was it done", "which is worst", or any ask that a ranked page of search hits cannot answer. Search answers "find me X"; it structurally cannot answer counts, completeness, or said-vs-done — those need different machinery, and this skill says which.
---

# Corpus Question Router — match the question to the method

Search returns the top-k best-scoring snippets. That is the right method for exactly one
shape of question — "find me X" — and silently the wrong one for counting, completeness,
and verification. Ten hits look identical whether 100 or 10,000 documents match; a decision
statement ranks above the outcome evidence; the loudest examples look like the complete
list. **Before any tool call, name the question's kind in ONE visible line, then use the
machinery that kind binds.**

## Derive the kind from two axes (don't memorize the table)

1. **How much of the corpus must be touched to answer correctly?**
   one/few docs · a filtered subset · **all of it** (tell-words: *most, all, every,
   how many, trend, repeat, ever*)
2. **What operation produces the answer?**
   **read** it · **count** it · **order** it in time · **pair** two evidence sets
   (said vs done) · **enumerate** exhaustively

The eight kinds below are just the cells that occur in practice. The axes matter more than
the table — they classify question shapes you have never seen.

## The eight kinds, and the machinery each binds

| # | Kind | Cue | Method family | Tool plan |
|---|------|-----|---------------|-----------|
| 1 | Lookup | "what is / what happened with X" | FIND | `spaces-vespa-search` hits |
| 2 | Aggregate / trend | "how many, most, growing, repeat" | COUNT | single entity → `spaces-vespa-search` with `groupBy` + `hits:0`; trend/ratio over time → `spaces-corpus-scan`. **NEVER count a page of hits by hand.** |
| 3 | Timeline | "how did X evolve" | FIND | date-filtered search, results ordered oldest→newest. See the trap below. |
| 4 | Audit (said-vs-done) | "did we actually, was it implemented" | CROSS-CHECK | **TWO retrievals**: the statement AND separate, later outcome evidence. Tag every claim `[stated]` / `[done]` / `[slipped]`. |
| 5 | Exhaustive list | "all, every, the complete list" | SWEEP | `spaces-corpus-scan` (or `groupBy` count) for the TRUE size first, then page to exhaustion, then report found + what remains uncovered and why. |
| 6 | Ranking | "which X is worst/most" | COUNT | grouped counts per entity + an **explicit, stated denominator** (a busy channel has more of everything). |
| 7 | Existence | "did we ever, is there any" | FIND | multi-angle search; **"not found in corpus" is a valid answer and does NOT mean it didn't happen.** |
| 8 | Synthesis | "explain / write up X" | FIND | search per sub-topic; every claim cites its source. |

## Rules that outrank the table

- **Composites decompose.** Real questions stack kinds. "Did we ever decide X, and did it
  actually happen?" = existence (7) **plus** audit (4). Split into sub-questions until each
  is a single kind; answer each with its own machinery; stitch at the end.
- **Unsure → treat as Lookup, and say so.** Never silently run a full scan for a lookup;
  never silently answer an aggregate from a page of hits.
- **A search result page is a RANKED SAMPLE, never a population.** You may cite items from
  it; you may not state or imply a count from it. Counts come from `groupBy`/`corpus-scan`.
- **A statement found in a document is a claim, not an outcome.** Outcome requires separate
  evidence, or the explicit `[stated]` tag.
- **"Not visible in the data" is always an acceptable answer.** Thin evidence is reported
  as thin; padding is a defect.

## The re-guess rule — soft kind, one-way valve

The kind is a first guess, not a cage: state it, try the matching method, and if what comes
back shows you misread the question, re-classify. But the valve is one-way:

- **Upgrading rigor is always free.** "I treated this as a lookup — it's actually asking
  for a count" → switch to COUNT, no justification needed.
- **Downgrading rigor requires a stated reason.** Moving from COUNT/SWEEP back to reading
  a few hits is exactly how undercounts sneak back in. Legitimate: *"I ran the count; only
  4 documents match, so I'll read them directly."* Illegitimate: downgrading silently
  because the scan feels like work.

What each kind **obliges** you to do once you are in it never bends — only the kind itself
is revisable.

## The timeline trap (the most common misroute)

"Did we do it?" questions love to disguise themselves as timelines, because any topic *can*
be told as a story. A timeline is a **presentation, not machinery**: routed as timeline,
you gather everything about X, order it by date, and write a fluent story — without ever
being forced to pair statement with outcome. You end up reporting the decision as fact
*because it was said*.

Worked example: *"Did we ever decide to deprecate UPI collect, and did it actually
happen?"* — the tempting read is timeline; the correct read is existence (find the
decision; "no decision found" is a fine answer) **plus** audit (find separate, later
rollout evidence). In our corpus both happened to exist, so the timeline route would have
produced the same answer — **by luck, not by construction**. Route it as the composite.

## COUNT method — how to actually count

- **Single-entity aggregates** ("who filed the most tickets", "which channel has the most
  refund chatter", "breakdown by type"): `spaces-vespa-search` with `groupBy` set to the
  entity and `hits: 0`. The per-group counts are real Vespa totals over ALL matching
  documents, ACL-respected — not a sample.
- **Trends and ratios over time** ("how many per year", "is it growing"):
  `spaces-corpus-scan` with `bucket: "year"` (or `"month"`). It returns per-term counts
  **and** `corpusTotals` per bucket in the same response.
- **Always compare shares, not raw counts.** The corpus grows over time, so raw counts turn
  normal growth into fake trends. The right number is *count ÷ that same bucket's total*
  — which is why `corpus-scan` ships the denominator with the counts. State the denominator
  in the answer.
- **Fan out across surfaces, or say why you didn't.** The thing you're counting usually
  lives in MORE than one area — complaints
  arrive in desk **mail** and get filed as **tickets** and get discussed in **messages**.
  `corpus-scan` is one area per call, so either run it per relevant area (separate calls,
  report each surface's numbers separately — don't sum across areas, the same complaint can
  appear in several), or name the surface you counted AND the ones you deliberately
  excluded. A count whose surface is unstated is an undercount waiting to be discovered.
- **Multi-word terms count as exact phrases.** "refund complaint" = documents containing
  that phrase. To count any-of-words, pass the words as separate terms.

## SWEEP method — how to be complete

1. Get the TRUE population size first (`corpus-scan` or a `groupBy` count).
2. Page the actual items to exhaustion (a full page means there's more; keep going until a
   short page).
3. Report three things: what made the list, what was **excluded and why**, and what remains
   uncovered. One pass always *looks* complete — only the count-first discipline can tell
   you whether it is.

## Stating the plan before a count — keep it light

The point of "design before results" is one thing only: **the definition is visible before
the numbers arrive, so nobody (including you) can quietly bend it afterward.** You almost
always get that from a single sentence, not a ceremony. Match the weight to the stakes:

**Default — just say the plan in one line, then run.** For any counting/trend/ranking
answer, state what you're about to count before you count it:
> *"Counting 'refund complaint' (exact phrase) in tickets and support mail, per year,
> share of that year's total; calling it a real rise only above ~1.3× the earlier peak."*
Then run `spaces-corpus-scan` and answer. The human can correct the definition if it's
wrong; that's all the checkpoint a normal question needs. **No canvas, no approval gate.**

**For a bigger, multi-topic analysis, write the spec down — and self-verify it, don't ask
for approval.** When the output spans many topics/verdicts or is a report someone will
re-run, write the plan to a canvas (`spaces-create-canvas`) covering surfaces (counted
separately, never summed), topics as exact phrases, scope, counting unit, snippet caps, and
numeric verdict bands (all three named). Then **self-verify it, lock it, and proceed — no
human sign-off.** The canvas is the audit trail, not a gate. A wrong rule after locking means a
new spec version and a re-run, never an in-place edit. Only pause for the user if they
explicitly asked to review the plan first.

## Show the method — name each step as you do it

For counting, audit, and list answers (anything beyond a plain lookup), make the pipeline
**visible** — the reader should be able to see which step is happening, not just get a final
number. Two ways, by size:

**Simple count / trend / ranking — label the phases inline.** Prefix each phase of your
answer with a short bold marker so the method is legible:
> **Classified** — trend question, so counting (not searching).
> **Plan** — "refund complaint" (exact phrase) in tickets + support mail, per year, as a
> share of that year; a real rise only above ~1.3× the earlier peak.
> **Counted** — *(the corpus-scan result)*
> **Answer** — …

**Multi-step analysis — use the task list (`todo-write`) so steps tick off live.** Seed it
with the pipeline phases up front, then mark each in-progress → done as you go, so the user
watches Classify → Probe → Design → Count → Verify happen:
> ☐ Classify the question · ☐ Probe the corpus shape · ☐ Design the plan (topics, scope,
> verdicts) · ☐ Count per surface · ☐ Verify + state coverage

Rules for the visible trace:
- **Every count/analysis answer shows its Classify and its Plan** — those two are the whole
  reason the number is trustworthy, so they are never silent.
- **A plain lookup stays clean** — don't label "Classified: lookup" on a simple "what
  happened with X"; the labels are for questions where the method matters.
- Keep each label to a phrase, not a paragraph. The trace is scaffolding around the answer,
  not the answer.

## Non-negotiables — every answer, every kind

- Every factual claim carries its citation.
- "I couldn't find it" ≠ "it didn't happen" — say which one you mean.
- Name the denominator on any comparison.
- Never state a number that came from tallying a ranked page.
- Name gaps and conflicts instead of papering over them.
- Report thin evidence as thin — do not pad.
