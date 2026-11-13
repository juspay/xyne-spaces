# Citations — architecture, and what should change

Written 2026-07-23, after auditing a real 480-citation production execution
(`or1otp5eqyaupyewpuhjthif`, a BOI CAM run). This is a design review, not a
tutorial: it records what the system gets right, what is misplaced, and what is
not yet covered — so the next person changing it starts from the reasoning rather
than rediscovering it.

## Purpose

Every data point an AI agent produces should be **traceable to its source**, so a
reviewer can verify each claim instead of trusting an opaque blob. Concretely: a
value renders with a marker; clicking it opens the evidence — a document at the
cited page/cell with the passage highlighted, an external link, or the recorded
output of the step the value came from.

## The model

Two sources, one composition:

| kind | which source | where inside |
|---|---|---|
| **Document** | the attachment | `locator` (page / cell / line) or `quote` |
| **Step output** | the producing step | **the ref path itself** |
| `url` | an external document | `quote` |
| `derived` | *not a source* — composes the above | — |

The unifying rule: **click a citation → the source opens, focused on the cited
thing.** A `locator` exists only because a document ref names a *file* and cannot
address inside it; a step-output ref needs nothing extra because the path *is* the
address.

## What is right, and worth preserving

**1. Resolve-don't-assert.** Structural facts (which document) come from the
*producer*; data facts (what text) come from the *agent*. This is the load-bearing
decision. It is predictive, not merely tidy: it explains in advance why OCR-backed
citations work (the step emits `source` + page numbers the agent can copy) and why
spreadsheet citations are weak (no step exposes addressable cells). Corollary,
proven twice in practice: **an agent can only cite as precisely as it is labelled.**

**2. Emitted vs resolved unions.** `CitationRef` models what a model can honestly
know; `ResolvedCitation` models what a reader gets. The agent is never asked to
classify document-vs-data — it cannot know whether a path holds an attachment, and
a wrong discriminator is worse than an omitted optional field. That split is made
where the answer exists (the resolver).

**3. Refs, not embedded attachments.** An `Attachment.data` is an opaque host
handle no model can know. The agent emits a path; resolution happens where the
workflow config and step outputs are in hand.

**4. Never-throw, degrade gracefully.** Malformed citation leaves are dropped with
a warning, never thrown on. A document opens even when its anchor misses. "No
document" always beats "wrong document".

**5. Relative structural navigation.** A citation mirror is the value's *sibling*
at whatever depth the value sits (`X.output.response.value` ↔
`X.output.response.citation`). Expressing that relatively — `splitCitedRef` —
rather than as an absolute path is what makes it survive arbitrary control flow.

## What is misplaced — ranked

### 1. Resolution lives in the UI. This is the real architectural error.

`resolveCitationRef`, walk-up, forward, and a hand-rolled `walkPath` all live in
`workflow-ui`, while the SDK already owns ref resolution — `engine/variable-resolver.ts`
and `engine/available-context.ts`, the latter of which explicitly models
`…output.branches.<key>.steps.<id>.output.<field>` for parallel.

We duplicated domain logic across a package boundary and it drifted. The
consequences were not hypothetical:

- **The parallel bug.** `forwardedCitations` pattern-matched an absolute path
  (`steps.<id>.output.response.value`). Inside a `PARALLEL` the boundary moves
  mid-path, the match failed, and provenance inheritance was silently dead — **107
  chained citations in one run.** The SDK knew this path shape; our copy did not.
- **Two context builders that disagreed.** `buildOriginCtx` and `ExecutionViewer`'s
  inline `originCtx` were separately maintained; `varsData` was added to one and
  not the other, leaving every variable-sourced citation inert on the main surface.
- **No non-UI consumer can resolve a citation** — PDF export, email, API responses,
  eval harnesses all get nothing.

**What to do:** move resolution into the SDK (or a shared package) as pure
functions, `(ExecutionDetail, CitationRef) → ResolvedCitation`, framework-agnostic
and tested against real executions. The UI becomes one consumer. This is mostly a
lift-and-shift of code that now has tests, and it deletes the duplication.

### 1b. `parseRef` returns one step id for a question with two answers

A ref through any control-flow container names **two** steps:

```
steps.extractors.output.branches.sec_vi_risk.steps.sec_vi_risk.output.response.value.x
      └────────┘                             └──────────────┘
      where resolution STARTS                what PRODUCED the value
```

`parseRef` returns only the first. That is right for *"where do I begin walking"*
and wrong for *"who produced this"* — two questions that coincide only in flat
workflows, which is why it went unnoticed. `resolveRef` derives **six** fields
from it and **five are wrong** inside a container:

| field | correct? |
|---|---|
| `label` | ❌ "Section extractors (parallel)" — the reported symptom |
| `stepDescription`, `group` | ❌ the container's |
| `stepId` → citation panel target, `onJump` | ❌ opens/navigates to the container |
| `upstreamRefs` ← `stepRawConfig(stepId)` | ❌ trace-back reads the container's config |
| `value` | ✅ walking from the container is correct |

**Fixed for citations only** (`innermostStep` in `citation-resolver.ts`), which
reads the *last* `steps.<id>` segment. `resolveRef` itself was left alone: it is
shared with the origin panel, where "start walking here" is the right semantics.

**Still outstanding:** `upstreamRefs` and `onJump` remain container-scoped, so the
origin panel's trace-back and "View step" are wrong inside any container.

**The durable fix** is to make the grammar answer both questions — have `parseRef`
return the step *chain* (`steps: ['extractors','sec_vi_risk']`) so outermost and
innermost become named choices at the call site and nobody string-splits a ref
again. Same move as `splitCitedRef`: define the fact once, in the SDK.

> **Careful with the obvious shortcut.** "Just use the innermost step id" is
> ambiguous under `MAP`/`LOOP`, where the same id runs once per iteration and step
> states are keyed by bare leaf id — a bare lookup silently returns the wrong
> iteration. Only the ref carries `items.0`. Hence `stepOutputRef` (the ref
> truncated at that step's `output`) for resolution, and the **full ref** for tab
> identity.

### 1c. The fixtures were all flat — that is why three bugs shipped

Every resolver bug so far is the same class: **meaning inferred from ref shape,
assuming steps are top-level.** All three passed their tests because every fixture
was flat. Five step types splice a nested container — `parallel`, `map`, `loop`,
`switch`, `conditional` — and `getBranches` is a `BaseStep` hook, so future ones
inherit the shape automatically.

`origin/topology.test.ts` now runs resolution as a **matrix** over flat / parallel
/ switch / conditional / nested-parallel, plus map-iteration identity. A new
control-flow shape is one fixture away from coverage. **Add to it before changing
the resolver.**

### 2. The citation mirror is cleverer than it needs to be

`citation` structurally mirroring `value` forces leaf-vs-branch to be inferred by
*"do this array's entries carry a `kind` field?"* (`isCitationRef`). That heuristic
is fooled by a user schema with a field named `kind`. It also made
`response → {value, citation}` a **breaking output-shape change**, dragging every
downstream ref and DB-resident layout to `output.response.value.*`.

A sidecar keyed by JSON Pointer avoids both:

```json
"citations": { "/indicators/0/values/31.03.2026": [ … ] }
```

Flat, unambiguous, non-breaking, trivially ignorable by consumers that don't care.
The mirror is nicer to author by hand; that probably did not outweigh a migration
plus a heuristic.

### 3. A verification feature shipped without measuring whether it verifies

`useDomAnchor` returned `hit` from the start and **every viewer discarded it**. The
result: 109 citations in one run pointed at text that does not occur in the source
(the agent had written descriptions like `"read directly from CMA sheet '20'"`
instead of quoting a cell), and nothing on screen said so — the document simply
opened at the top. Anchor-hit rate is *the* metric for this feature and it was
absent. Now surfaced via `AnchorMiss`; it should be aggregated as telemetry too.

### 4. The producer contract is a convention, not a type

*"Any step that derives data from a document emits the `Attachment` beside it"*
lives in prose. Nothing stops a new step from forgetting — which is exactly why the
CMA workbook produces no usable citations. Encode it: a `DocumentDerived<T>` output
helper, or a schema marker, so it cannot be silently skipped.

### 5. Prompt-as-contract is the weakest link

The emitted shape depends on an LLM following prose, with `sanitizeCitationMap` as
the only guard (the runtime does not send `outputSchema` to the model, so the
prompt is the only lever). Observed failures on nemotron: dropping `kind` and
`expression` from a nested `derived`; prose in `expression`
(`"Medium because #1 <= 25 Cr"`) where the contract is arithmetic-only; a
single-input `(#1)` "derivation"; and fabricated quotes. Mitigations worth having:
validate-and-repair rather than validate-and-drop, and compliance metrics per model.

## Coverage today

| case | state |
|---|---|
| PDF + page locator | ✅ works |
| DOM formats (text, md, json, csv, xlsx, docx) via quote | ✅ works |
| Step / API output | ✅ opens the Step Output panel at the cited path |
| Agent → agent chains, flat | ✅ |
| Agent → agent chains, through `PARALLEL` | ✅ (fixed 2026-07-23) |
| Variable-sourced documents (`vars.*`) | ✅ (fixed 2026-07-22) |
| URLs | ⚠️ schema fine, but `DeepResearchStep` returns a markdown blob with **no structured sources** — web-backed claims are effectively uncitable |
| Spreadsheet cell (`{at:'cell'}`) | ❌ no producer emits cell addresses |
| Images / scanned documents | ❌ deferred by decision (an LLM reading OCR text has no spatial information; a hallucinated bbox is worse than no anchor) |
| HTML | ❌ excluded by decision (sandboxed iframe, opaque origin — correct security for untrusted uploads) |
| Map / loop iterations | ❓ generic walking *should* handle it; unproven |
| Citations on a RUNNING execution | ❓ step outputs absent mid-run ⇒ transiently unresolvable; unhandled |

Two of these gaps are load-bearing for the credit-memo product specifically:
**spreadsheets and web research** are most of what a CAM is made of.

## Missing capabilities worth adding

- **Citation identity.** No stable id per citation, so a reviewer cannot flag "this
  one is wrong", and a specific claim cannot be audited across renders. For a
  compliance artefact this is likely required.
- **Quote verification at produce time.** Nothing checks that a quote occurs in the
  source. For text-bearing producers this is checkable *before* the reader sees it.
- **Redaction / ACL on the Step Output panel.** It renders whatever the step
  returned; in a banking context that output may contain data the reader should not
  see.

## Priority if picked up again

1. **Move resolution into the SDK** — removes the duplication that caused the
   parallel bug and the ctx drift, and unlocks non-UI consumers. Bundle the
   `parseRef` step-chain change (§1b) into the same move.
1b. **Finish container-vs-producer**: `upstreamRefs` and `onJump` in
   `origin-resolver.ts` are still container-scoped.
2. **A spreadsheet producer** — the agent's own `run_code` already computes
   `{sheet, row, col}` and discards it; emitting the citation *from the code* takes
   the model out of the loop entirely for code-extracted values.
3. **Structured sources from deep research** — otherwise web claims stay uncitable.
4. **Anchor-hit telemetry**, then quote verification.
5. Revisit the mirror vs a JSON-Pointer sidecar (only worth it alongside 1).
