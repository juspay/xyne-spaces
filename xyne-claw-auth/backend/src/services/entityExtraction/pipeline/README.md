# entity-bootstrap

Builds an entity registry by traversing channel data. Org-agnostic: implement
five ports, supply config, run the pipeline.

Design rationale lives in `docs/entity-extraction-pipeline.md`. This file is the
operating manual.

## Why bootstrap needs its own algorithm

Steady-state resolution *links* a mention against an existing registry. During
bootstrap the registry is empty, so linking degenerates into "create everything"
— which is exactly how you end up with `HDFC`, `HDFC Bank`, and `hdfc_upi` as
three entities.

So bootstrap inverts it:

| | Steady state | Bootstrap |
|---|---|---|
| Input | one mention | all mentions at once |
| Operation | link to existing entity | **cluster mentions into groups** |
| Decides identity | registry lookup | clustering + human review |

Each cluster becomes one candidate entity, and its members become that entity's
seed aliases. That is the real payoff: you finish bootstrap with a populated
alias table, so the runtime cascade's cheap exact-match stage works from the
first query rather than warming up over months.

## The four ports

```ts
interface ChannelSource { listChannels(); listMessages(channelId, opts) }
interface LlmClient     { completeJson<T>({ system, user, schema, schemaName }) }
interface RegistryStore { putEntities(); putAliases(); findEntityByNormalizedName() }
interface ArtifactStore { read(); write(); exists() }
```

**There is no embedding port, deliberately.** See "Why similarity is lexical".

Nothing below `ports.ts` knows about any particular chat product, model
provider, or database.

**`LlmClient` must enforce the schema at the structured-output layer**, so a
response with an out-of-taxonomy type is rejected and retried by the provider
rather than parsed leniently. That constraint is what makes type drift
impossible rather than merely unlikely.

### Provider quirks worth checking before a full run

`OpenAICompatibleLlmClient` validates responses locally and retries with the
specific violation, so provider misbehaviour surfaces as a retry loop rather
than corrupt data reaching the registry. Two things are worth testing on any new
endpoint, because both look like flakiness:

- **Guided decoding can corrupt output.** Some vLLM builds, given
  `response_format: json_schema` with `strict: true`, emit malformed JSON such as
  `{"{"mentions": [...]}` — intermittently. If you see sporadic "not valid JSON"
  retries, drop to `mode: 'prompt'` and let local validation do the enforcing.
- **Reasoning models pay a large, useless tax here.** Extraction is mechanical;
  a reasoning trace costs seconds per call and does not improve output. Where
  the provider allows disabling it, do:

  ```ts
  extraBody: { chat_template_kwargs: { enable_thinking: false } }
  ```

  Measured on GLM via vLLM: a batch of 8 went from ~45s to ~7.7s, with slightly
  *better* spans (`upi collect` kept whole rather than split).

**`RegistryStore` must enforce `UNIQUE (normalizedForm, entityType)` on aliases.**
This is not optional. Extraction is parallel, so without it two workers both
miss "Razorpay", both create it, and you have duplicates on day one from an
otherwise correct pipeline.

## Why similarity is lexical

Entity names are short proper nouns, which is exactly where sentence embeddings
are least reliable. `Razorpay` and `RZP` are not close in any semantic space;
neither are `hdfc` and `hdcf`. The real failure modes are typos, spacing, and
abbreviation — all character-level problems.

So `lib/lexical.ts` scores pairs as `max(trigram Jaccard, edit-distance ratio)`,
matching Postgres `pg_trgm` semantics so the runtime resolver can do the same
comparison in SQL:

```sql
CREATE INDEX ON aliases USING gin (normalized_form gin_trgm_ops);
SELECT entity_id, similarity(normalized_form, $1) AS sim
FROM aliases WHERE normalized_form % $1 ORDER BY sim DESC LIMIT 5;
```

Two consequences worth understanding:

- **No shared vector space to maintain.** Bootstrap and runtime don't have to
  use the same embedding model, because neither uses one. The registry can be
  rebuilt or re-tuned without re-embedding anything.
- **No infrastructure dependency.** Clustering is pure computation.

The one place embeddings would genuinely help is stage 3, clustering free-form
*type labels* — `payment gateway` and `payment processor` share no characters
but do share meaning. Lexical grouping will miss that pair. This is acceptable
because gate 1 exists: the label report is a convenience for the reviewer, and a
human does the real merging.

## Usage

```ts
import { runBootstrap, FileArtifactStore } from 'agentic-framework/entity-bootstrap'

const outcome = await runBootstrap(
  { source, llm, registry, artifacts: new FileArtifactStore('./bootstrap-out'), logger },
  { harvest: { channelDenylist: ['random'] }, sample: { size: 400 } },
)

if (outcome.status === 'gate_required') {
  console.log(outcome.message)   // tells you which artifact to edit
}
```

Run it three times. It halts at each gate and resumes from cached artifacts.

## The two gates

### Gate 1 — freeze the taxonomy

Stage 3 runs open-ended extraction over a sample and clusters the free-form type
labels it returns, writing `03-type-candidates.json`. The distribution is
reliably Zipfian: a head of 10–20 labels covers most mentions, then a long tail
of one-offs. **The head is your taxonomy. The tail is noise**, and accommodating
it is the main way taxonomies go bad.

Curate that into `03-taxonomy.json`:

```json
{
  "version": 1,
  "types": [
    { "name": "GATEWAY",  "prefix": "gw",  "rule": "processes a payment. If money moves through it, it's a gateway." },
    { "name": "MERCHANT", "prefix": "mer", "rule": "sells to end users. If it has customers of its own, it's a merchant." }
  ]
}
```

The admission test for each type: **would anyone ever filter by it?** If no
realistic query says "only X", the type is decoration — it costs labeling
consistency and buys nothing. Target 5–15 types. The `rule` string goes into the
extraction prompt verbatim, so it has to actually settle ambiguous cases.

### Gate 2 — approve the registry

Stage 6 writes `06-review.json` with every candidate triaged:

- `auto_approve` — frequent and widespread, or sourced from channel metadata
- `needs_review` — moderate frequency, or a suspiciously large alias set
- `rejected` — too rare to be real

Set `"approved": true` on the items you want, optionally with
`canonicalNameOverride` / `typeOverride`. **Absence of the flag is not consent** —
to seed everything triaged `auto_approve` without reading it, you must explicitly
set `seed.allowUnreviewedAutoApprove = true`.

## Threads are the unit of extraction

`harvest.groupByThread` (on by default) folds messages sharing a `threadId` into
one document, ordered by timestamp.

This exists for coreference. A thread's tenth message says *"yeah it's still
throwing 504s"*; only the first message names HDFC. Extracted per-message, that
tenth message yields either nothing or an invented entity. Folded, the extractor
has what it needs. It also does much of the work stage 2 (statement
decomposition) was there for.

Threads exceeding `harvest.maxThreadChars` split at message boundaries, never
mid-text, into `thread:<id>`, `thread:<id>#1`, … Messages with no `threadId`
stay standalone documents.

**This changes what `docCount` means.** A document is now a thread, so
`review.autoApproveDocs` counts threads — a far stricter bar than the same
number of messages. Defaults assume threads (`autoApproveDocs: 4`). If you set
`groupByThread: false`, raise them.

Because document sizes now vary by orders of magnitude, batching is by character
budget (`extract.maxBatchChars`) with `batchSize` as a ceiling, rather than a
fixed document count.

### Capping by conversation

`harvest.maxThreadsPerChannel` keeps the N most recent conversations. Two things
it does that a naive cap does not:

- **Standalone messages count as conversations.** Otherwise the cap would do
  nothing on a channel whose messages carry no thread id.
- **Boundary-truncated threads are discarded, not kept partial.** Fetching stops
  at `maxMessagesPerChannel`; any thread reaching that edge is missing its
  oldest messages — including the opening one that names the subject everything
  after refers to as "it". Half a thread is worse than none, so those are
  dropped and reported as `thread_truncated_at_fetch_boundary`.

Set `maxMessagesPerChannel` comfortably above
`maxThreadsPerChannel × average thread length`, or the boundary rule will
discard threads and leave you short of the cap. Check the drop-reason counts in
harvest stats to confirm.

## Channel metadata is a separate, better signal

A channel named `#hdfc-integration` was deliberately named by a human, so it
carries none of the extraction noise message bodies do. Stage 1 harvests channel
names, topics, and descriptions as their own document kind, weighted 5× by
default (`harvest.channelMetaWeight`), and `review.trustChannelMeta` auto-approves
anything that appears in one.

## Tuning

Everything lives in `config.ts`. The ones that matter:

| Setting | Effect |
|---|---|
| `cluster.mergeThreshold` | Lexical score at which two surface forms merge (default `0.72`). Kept high on purpose: a typo that fails to merge becomes a rare candidate the review gate rejects, whereas a false merge is silent and permanent. |
| `cluster.containmentThreshold` | Lower threshold (default `0.34`) applied only when one form's tokens are a subset of the other's — rescues `hdfc` / `hdfc bank`. **This is also the main over-merge risk.** |
| `review.autoApprove*` | Floors for skipping human review. |
| `harvest.botAuthorIds` | Bot messages are pure noise; list them. |

### Known tension: containment bridging

Token containment merges `swiggy` with `swiggy instamart`. Whether that is
correct is a judgement call about your domain — they may be one merchant or two.
The pipeline cannot know, which is exactly why gate 2 exists and why candidates
with large alias sets are flagged `needs_review` regardless of frequency.

If your domain has many parent/child entities that must stay distinct, raise
`containmentThreshold` toward `mergeThreshold` to disable bridging, and accept
that `HDFC` and `HDFC Bank` will then need a human to merge them.

## Re-running

Each stage caches to an artifact and is skipped when present:

```ts
runBootstrap(ports, config, { force: ['cluster', 'review'] })  // recompute these
runBootstrap(ports, config, { stopAfter: 'typegen' })          // partial run
```

Re-tuning clustering costs nothing but the embedding calls — extraction, the
expensive pass, stays cached. Seeding is idempotent: a second seed finds
existing entities via `findEntityByNormalizedName` and skips them.

## What this does not do

Bootstrap only. The steady-state pieces — per-document mention extraction, the
four-stage resolution cascade, index writes — are separate, and share
`lib/normalize.ts` with this package so that index-time and query-time
normalization cannot drift apart. That sharing is load-bearing; do not
reimplement `normalize()` on the runtime side.
