---
name: corpus-question-router-test
description: Derive the method for any corpus question from a closed basis — SELECT the evidence set, name the OPERATION (read · measure · exhaust · relate), apply the modifiers, bind the machinery. READ THIS whenever a question contains "how many", "most", "trend", "all", "every", "did we actually", "was it done", "which is worst", "any issues", "status", "latest", or any ask that a ranked page of search hits cannot answer. Search's ranked page answers exactly one shape — "find me X"; every other shape needs a different primitive, and this skill derives which.
---

# Corpus Question Router — derive the method, don't memorize cases

A search engine exposes exactly **five primitives** — there are no others:

| Primitive | What it gives you |
|---|---|
| **match** (terms / filters) | *defines* an evidence set |
| **rank** (relevance) | a **sample** of the set — the top-k loudest members |
| **sort** (by an attribute, usually time) | the **ends** of the set — newest / oldest |
| **aggregate** (count / group) | the set's **size and shape** |
| **paginate** | the set's **members, exhaustively** |

Every wrong corpus answer is the same one-line mistake: **using the sample primitive where
another primitive was the answer.** A count answered from a page of hits, a "complete list"
that is a top-k sample, a "current status" built from relevance-ranked history — all one
disease. The cure is to name what you are doing *before* touching a tool:

> **SELECT** — which documents are the evidence set?
> **OPERATE** — what function turns that set into the answer?

State both in ONE visible line before the first data call, so a person can catch a wrong
choice. **The line lives in the first todo's title** — `Classify: READ+newest-state — <set>`
— because the todo card is what the user actually sees; a classification that exists only in
your reasoning is invisible and uncatchable. The todo is completed only once the line is
visible.

## The four operations — a closed set

Given a selected set, there are only four things an answer can be built from:

| Operation | Answer comes from | Machinery binding |
|---|---|---|
| **READ** | some members' content | `spaces-vespa-search` relevance hits, cited |
| **MEASURE** | the set's size / distribution / change | `spaces-corpus-scan` (time-bucketed, with denominators) or `groupBy` + `hits:0`. **Never a hand-tally of a results page.** |
| **EXHAUST** | *all* members | MEASURE the true size first, then paginate to a short page, then state coverage |
| **RELATE** | two or more sets held against each other | one retrieval **per set**, evidence tagged per set — never one retrieval doing double duty |

**This set is closed.** There is no fifth thing to do with a set of documents. When a
question feels new, it is a new *combination* of operation × modifiers — derive it; never
invent a new category. (Deriving is the skill; the table of examples below is just cells
that occur often.)

## The modifiers — orthogonal, apply to any operation

- **Time scope:** the whole archive equally · a window · **the newest state**.
  Newest-state (tell-words: *now, currently, latest, still, status, is it broken, any
  issues*) binds the **sort** primitive: every hit surface gets a second probe sorted
  newest-first (`sortBy` the date field `desc`, or a recent `after:` window; the probe may
  be query-less — filters + sort alone reads a surface newest-first). Lead the synthesis
  with the freshest findings. A current-state answer built only from relevance-ranked hits
  is stale by construction.
- **Set scope:** topic terms · field filters (channel, status, assignee, date) · person.
- **Evidence rules (TRUST):** a statement found in a document is a **claim, not an
  outcome** — outcome needs separate, later evidence or the explicit `[stated]` tag; every
  comparison names its **denominator**; **absence is reported as absence** — "not found in
  the corpus" never becomes "it didn't happen".

## Worked derivations — familiar shapes as operation × modifiers

| Question shape | Derivation | Binding |
|---|---|---|
| "what is / what happened with X" | READ | relevance hits, cited |
| "explain / write up X" | READ, multi-set | one search per sub-topic |
| "how did X evolve" | READ + time-ordered | date-filtered search, oldest→newest. See the timeline trap. |
| "any issues now / status of X / is it broken" | READ + newest-state | recency probe per surface, freshest first. See the recency trap. |
| "how many / is it growing" | MEASURE + time-bucketed | `spaces-corpus-scan`, shares not raw counts |
| "who filed the most / breakdown by type" | MEASURE + grouped | `groupBy` + `hits:0`, denominator stated |
| "all / every / the complete list" | EXHAUST | size first, page to exhaustion, state what's uncovered |
| "did we ever / is there any" | MEASURE ≥ 1, or READ + absence rule | multi-angle; "not found" is a valid answer |
| "did we actually do X" | RELATE: claim-set × outcome-set | TWO retrievals; tag `[stated]` / `[done]` / `[slipped]` |
| "are there any X who are Y" | EXHAUST + RELATE | size the population, then pair evidence per member |
| "A vs B, which is worse" | RELATE: set A × set B, each MEASURED | two counts, one shared denominator rule |
| "which X DON'T have Y" | EXHAUST(X) minus MEMBERS(X∩Y) | exhaust the base set; absence per member is a claim about the corpus, not the world |

The last three rows are shapes nobody wrote a rule for — they *derive*. That is the point.

## Rules that outrank everything

- **Composites decompose.** "Did we decide X, and did it happen?" = existence + RELATE.
  Split until each part is a single operation; answer each with its own machinery; stitch.
- **Unsure → READ, and say so.** Never silently run a full scan for a lookup; never
  silently answer a MEASURE question from a page of hits.
- **A ranked page is a SAMPLE, never a population.** Cite members from it; never state or
  imply a count, a completeness, or a "latest" from it.
- **The one-way valve.** The derivation is a first guess. Upgrading rigor (READ → MEASURE)
  is always free. Downgrading requires a stated reason — legitimate: *"the count shows only
  4, reading them directly"*; illegitimate: silently, because the scan feels like work.
  What an operation **obliges** never bends; only the derivation is revisable.

## Two traps — misbindings caught in production

**The timeline trap.** "Did we do it?" loves to disguise itself as a timeline, because any
topic *can* be told as a story. A timeline is a presentation, not machinery: routed as
time-ordered READ, you narrate the decision as fact *because it was said* — without ever
being forced to pair statement with outcome. Worked example: *"did we decide to deprecate
UPI collect, and did it happen?"* — the tempting read is timeline; the correct derivation is
existence **plus** RELATE. In our corpus both happened to exist, so the timeline route would
have produced the same answer — by luck, not by construction.

**The recency trap.** Relevance ranking answers "what has EVER been said about X" — never
"what is true NOW". A report posted an hour ago competes in the top-k auction against years
of accumulated matches and loses by construction; the failure is silent because the answer
is fluent, fully cited, and stale. Worked example: *"does full screen search have any
issue?"* — a plain relevance fan-out produced an answer whose newest fact was two days old,
while that morning's bug thread never entered the top-20. The same question with a
newest-first probe per surface caught the thread and cited it to the minute. Nothing about
the model changed — only the primitive.

## MEASURE — how to actually count

- **Single-entity aggregates** ("who filed the most", "breakdown by type"):
  `spaces-vespa-search` with `groupBy` + `hits: 0`. Per-group counts are real Vespa totals
  over ALL matching documents, ACL-respected — not a sample.
- **Trends and ratios over time** ("how many per year", "is it growing"):
  `spaces-corpus-scan` with `bucket: "year"` / `"month"` — per-term counts **and**
  `corpusTotals` **and** precomputed `shares` in one response.
- **Always compare shares, not raw counts.** The corpus grows over time; raw counts turn
  normal growth into fake trends. State the denominator in the answer.
- **Fan out across surfaces, or say why you didn't.** The thing counted usually lives in
  several areas (mail, tickets, chat). Count each surface separately — never sum across
  surfaces (the same item can appear in several) — or name what you excluded. An unstated
  surface is a silent undercount.
- **Multi-word terms count as exact phrases.** "refund complaint" = that phrase. To count
  any-of-words, pass the words as separate terms.
- **Derived arithmetic runs as code, not in your head.** When a sandbox is available, any
  number the counting tool doesn't return directly — a sub-window sum, a difference, a
  ratio, a top-N, a dedup, a verdict threshold — is computed by writing the tool's JSON
  response to a sandbox **data file verbatim** and running Python that **parses that file**;
  the printed output is copied verbatim into the answer. Do not retype numbers into the
  script body — retyping is transposition risk, the same species as the hand-sum. The
  script and its output are the audit trail. The sandbox computes over tool outputs only —
  it is never a source of evidence.

## EXHAUST — how to be complete

1. MEASURE the true population size first (`corpus-scan` or a `groupBy` count). When the
   population is a derived condition no lexical term can count ("merchants live on both X
   and Y"), run the closest **proxy count** (documents mentioning the topic) and state
   coverage against it: *"~N docs mention X; I read the top k — this is what they confirm,
   not a census."*
2. Page the members to exhaustion — a full page means there's more; stop only at a short page.
3. Report three things: what made the list, what was **excluded and why**, and what remains
   uncovered. One pass always *looks* complete; only the size-first discipline can tell you
   whether it is.

## RELATE — how to hold sets against each other

- One retrieval per set, each with its own scope — the claim-set and the outcome-set are
  never the same query.
- Tag every claim by which set supports it: `[stated]` / `[done]` / `[slipped]`.
- For comparisons, both sides get the same denominator rule; for member-wise pairing
  ("live on both"), each member carries evidence from each set separately.

## Stating the plan before a count — keep it light

The point of "design before results" is one thing only: **the definition is visible before
the numbers arrive, so nobody (including you) can quietly bend it afterward.**

**Default — one line, then run.** For any MEASURE / EXHAUST / RELATE answer, state what you
are about to do before doing it:
> *"Counting 'refund complaint' (exact phrase) in tickets and support mail, per year, share
> of that year's total."*
No canvas, no approval gate — the human can correct the definition if it's wrong.

**For a bigger multi-topic analysis**, write the spec down (topics as exact phrases,
surfaces counted separately, scope, unit, numeric verdict bands), **self-verify it, lock it
yourself, and proceed — no human sign-off.** The spec is an audit trail, not a gate. A wrong
rule after locking means a new spec version and a re-run, never an in-place edit. Only pause
for the user if they explicitly asked to review the plan first.

**The written-analysis pipeline (spec → packs → stats → write → verify).** When the
deliverable is a shareable analysis (a report someone will argue with), the loose loop above
tightens into the full contract:

1. **DESIGN** — the spec is a sandbox file (`spec.md`: topics as exact phrases, scope,
   caps, verdict bands), self-verified and locked before any extraction.
2. **EXTRACT** — one `spaces-evidence-pack` call per topic per surface; each returned JSON
   is written **verbatim** to a sandbox data file (`packs/<topic>-<area>.json`). Packs are
   capped and dated by construction; their `counts`/`termTotals` are the real totals.
3. **COMPUTE** — one Python script parses the pack files and emits `stats.json` (totals,
   shares, deltas, verdicts by the spec's bands). Printed output only; no retyping.
4. **WRITE** — the analysis cites **only pack rows** and states numbers **only from
   `stats.json`**. A claim with no pack row behind it doesn't go in. "Not visible in the
   data" is an approved finding.
5. **VERIFY** — before delivering: every cited row ∈ some pack file (closed-set check —
   runnable as a script over the draft + packs), every number ∈ `stats.json`, and the
   coverage note carries each pack's `coverage` field (buckets fetched/skipped, caps).

Everyday questions never do this — the pipeline exists for artifacts, not answers.

## Show the method — name each step as you do it

For any MEASURE / EXHAUST / RELATE answer (anything beyond a plain READ), make the pipeline
visible:

**Simple answers — label the phases inline:**
> **Classified** — current-state question (READ + newest-state).
> **Plan** — "refund complaint" (exact phrase) in tickets + messages, per year, as a share.
> **Counted / Found** — *(the result)*
> **Answer** — …

**Multi-step analyses — seed the task list with the pipeline phases** (Classify → Probe →
Design → Count → Verify) and tick them off live.

- Every MEASURE/EXHAUST/RELATE answer shows its **Classified** and its **Plan** — those two
  are the whole reason the number is trustworthy.
- A plain READ stays clean — no labels on a simple "what happened with X".
- Keep each label to a phrase. The trace is scaffolding, not the answer.

## Non-negotiables — every answer, every operation

- Every factual claim carries its citation — **the doc id itself, verbatim, as a plain-text
  token in the final answer** (`[clf-ab12#7]`, no backticks/code formatting, punctuation
  outside); a prose source name may accompany a token, never replace it. **Verification is
  two-part** (see `corpus-self-verify`): Part A — citation integrity — runs on EVERY answer,
  including plain READ lookups; Part B — the full measurement checklist — runs whenever the
  draft contains any MEASURE / EXHAUST / RELATE result.
- "I couldn't find it" ≠ "it didn't happen" — say which one you mean.
- Name the denominator on any comparison.
- Never state a number that came from tallying a ranked page.
- Name gaps and conflicts instead of papering over them.
- Report thin evidence as thin — do not pad.
