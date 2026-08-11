# On-Device Intent Classification

**Status:** Loop closed end-to-end and live. `INTENT_TRIGGER_ENABLED = true`: a message
clearing its intent's threshold calls the server, an agent decides, and a `call_start` card
is posted into the thread. Verified in a real browser and against a real agent run.
**Surfaces:** dashboard (web) and Electron — Electron renders the same bundle, so one
implementation covers both.
**Playground:** `/{workspaceId}/intent-playground`
**Debug traces:** `localStorage.setItem('xyne:intent-debug', '1')`, then filter the console
on `[intent` (§5.6).

`start-call` is the first intent, **not the point**. The pipeline is general — the same
machinery serves create-ticket, schedule-meeting, summarize-thread, escalate. Nothing in it
should assume calls are the only case.

Quick reference:

| Command | Does |
|---|---|
| `pnpm fetch-model` | Vendor the model into `public/models/` (also runs on `prebuild`) |
| `pnpm build:prototypes` | Re-embed `intents.ts` → `prototypes.json`. Run after ANY phrase edit |
| `pnpm eval:intents` | Threshold sweep + precision-first operating points |
| `pnpm eval:intents --ci` | Same, but fails below the F1 floor |

Current intents (`intents.ts`, prototypes v4):

| id | threshold | actionable | role |
|---|---|---|---|
| `start-call` | 0.60 | yes | Proposes a call with suggested people |
| `platform-help` | 0.60 | **no** | Absorber — claims "how do I…" phrasings so they stop firing `start-call` |
| `unclassified` | — | — | Not an intent. Reported when nothing clears the 0.35 floor (§5.5.1) |

---

## 1. Why this exists

We want parts of the app to react to what users write without paying for a server LLM call
on every message. First target: **ambient intent detection in public channels**. Someone
posts "how do I start a call?" and we surface a rich widget — suggested participants, one
click to start — instead of making them wait for a human to reply.

A tool-augmented server call per message across every public channel is not affordable. So
the design is a **cascade**:

```
every public-channel message
        │
        ▼
  on-device embedding classifier      ~35-50ms, free, runs locally
        │  (top score ≥ threshold — target ~1.5% of messages)
        ▼
  POST /api/intent/suggest            gates, dedupe, dispatch
        ▼
  claw agent                          expensive: search, tools, participants
        │  (may decline → nothing renders)
        ▼
  call_start FlowJSON card posted into the thread
```

The local model is **not an authority**. It is a cheap sentinel deciding when a server call
is worth paying for. The server is the precision filter and can always decline.

### 1.1 Two properties that make this safe

**Fails open.** If the classifier errors, never loads, or is disabled, nothing happens —
which is exactly today's behavior. There is no remote fallback to build, no commit gate, no
mid-stream recovery. This is why these two use cases were chosen first.

> Keep this as a rule: **only take on on-device tasks where local failure equals current
> behavior.** The moment a task's failure mode is user-visible, the design gets much harder.

**No new data exposure.** Public-channel messages are already persisted server-side. Local
inference here buys **cost and latency, not privacy**. Don't market it as a privacy feature;
the honest framing is that the server can't afford to look at every message, so the client
decides when it's worth asking.

---

## 2. Why embeddings, not a generative LLM

For closed-set intent detection, embedding similarity against precomputed prototypes beats a
small generative model on every axis that matters here.

| | Embedding model | Generative 1.7B |
|---|---|---|
| Download | ~25–50MB quantized | ~1–1.5GB Q4 |
| Latency/message | ~5–20ms (WASM, no GPU) | ~200–800ms TTFT |
| Hardware gate | Runs everywhere | Needs WebGPU / decent RAM |
| Add an intent | Ship a JSON file | Re-prompt, re-eval, hope |
| Output | Deterministic score | Format drift, needs schema validation |

A generative model earns its place later for **argument extraction** ("call **Sarah** at
**3pm**") and for the low-confidence band — see §8, Phase 5. That is also the point at which
WebGPU / `node-llama-cpp` / Electron-native inference become relevant. None of it is needed
to ship the first version.

---

## 3. Architecture

```
ChatInput.handleSendMessage                              ChatInput.tsx
        │  fire-and-forget — never awaited, never blocks send
        ▼
intentClassifier.submitForMessage(text, messageId, channel)
        │  eligibility gate: ChannelVisibility.PUBLIC only, fail closed
        │  drop-oldest scheduler (depth 1)
        ▼
  ┌─────────────────────────────────────────────────────┐
  │  intent.worker.ts                                    │
  │   prefilter → split into segments → BATCH embed      │
  │   → max cosine vs prototypes / anti-prototypes       │
  │   → floor: under 0.35 ⇒ `unclassified`               │
  └─────────────────────────────────────────────────────┘
        │  postMessage({ RESULT, ... })
        ▼
main-thread listener
        ├──▶ safeRecordMetric(...)   → OTel histograms → Grafana
        ├──▶ logger.info(...)        → logger.worker → bridge → Grafana logs
        └──▶ actionable && score ≥ threshold
                 ▼
          POST /api/intent/suggest { messageId, intentId, score }   ← ids only, no text
                 ▼
          dispatchIntentSuggestion                    intentSuggestionService.ts
                 ├─ re-reads message + channel from OUR db
                 ├─ gates: public · author-owns-message · workspace match
                 ├─ Redis SETNX dedupe (10 min, fails CLOSED, released on failed dispatch)
                 └─ runClawAgent(ask-ai, resultForwardUrl)
                          ▼
                   agent decides + picks people via Spaces tools
                          ▼
          POST /api/internal/intent/callback/:messageId/:intentId   (S2S)
                 ├─ zod-validate → malformed = decline
                 └─ build call_start FlowJSON → post as thread reply
                          ▼
                   card renders
                     ├─ Start call → LiveKit room + participants + ring → phase 'started'
                     └─ Dismiss    → phase 'dismissed'
```

### 3.1 Rules

- **Nothing on this path touches React state.** Metrics live in a plain module singleton —
  no context, no zustand, no XState. If a metric can cause a render, it will.
- **Author-only classification** (Phase 1–2). The sender's client classifies; nobody else
  does. This gives 1:1 message-to-classification with no dedup, and directly serves the goal
  of helping the asker without waiting for others. Moving to every-viewer classification
  (Phase 3) causes a thundering herd — N viewers, N server calls for one message — and needs
  server-side dedup first.
- **Drop, don't queue.** Ambient work is worthless once stale. A depth-1 scheduler where the
  newest job wins; opening a channel must never grind through backfill.
- **Never classify history.** Only messages the user just sent, and (Phase 3) live messages
  arriving in a focused channel.

### 3.2 Eligibility gate

Public channels only, one chokepoint, fail closed:

```ts
function isEligible(ch: Channel | undefined): boolean {
  return ch?.visibility === ChannelVisibility.PUBLIC;   // undefined/loading/unknown → false
}
```

`ChannelVisibility` comes from `@xyne/shared`. Nothing outside `services/onDeviceIntent/` may
call the worker. Re-check at submit time, not just at enqueue — a channel converted
public→private between send and classification must not slip through. Assert in tests that a
DM and a private channel produce zero classifications; this is the constraint most likely to
erode when someone adds a second entry point later.

---

## 4. Layout

### Create

| Path | Purpose |
|---|---|
| `src/services/onDeviceIntent/intent.worker.ts` | Embedding + scoring. Colocated with its service, matching `utils/logger.worker.ts` and `services/XyneAI/xyneAIStream.worker.ts`. |
| `src/services/onDeviceIntent/intentClassifier.ts` | Worker lifecycle, eligibility gate, scheduler, metric/log emission. |
| `src/services/onDeviceIntent/intents.ts` | Declarative intent specs (examples + anti-prototypes). |
| `src/services/onDeviceIntent/scoring.ts` | Pure, **import-free** scoring shared with the Node scripts. |
| `src/services/onDeviceIntent/config.ts` | Model id, dtype, trigger flag, perf budget, debug-only candidate threshold. |
| `src/services/onDeviceIntent/debug.ts` | Step-by-step console tracing (§5.6). |
| `src/services/onDeviceIntent/prototypes.json` | Generated — one vector per example phrase. |
| `src/services/otel/intentMetrics.ts` | OTel instruments. |
| `src/routes/IntentPlaygroundScreen/` | Dev route to try the classifier by hand. |
| `src/components/flowUI/nodes/CallStartNode.tsx` | The action card (`call_start`). |
| **backend** `services/intentSuggestionService.ts` | Gates, dedupe, dispatch, agent-result validation, card building. |
| **backend** `services/intentCallActionService.ts` | Native `call-start` / `call-dismiss`, LiveKit room + ringing. |
| **backend** `controllers/intentSuggestion.handler.ts` | Both routes. |
| `scripts/fetch-model.mjs` | Vendors the model into `public/models/`. |
| `scripts/build-prototypes.mjs` | Build-time embedding of examples in Node. |
| `scripts/eval-intents.mjs` | Offline eval with threshold sweep. |
| `fixtures/intents.jsonl` | Labeled eval corpus (held out — never copy into `intents.ts`). |

### Modify

| Path | Change |
|---|---|
| `src/services/otel/index.ts` | Re-export new instruments. |
| `packages/shared/src/logger/events.ts` | `INTENT_CLASSIFIED`, `INTENT_WORKER_READY`, `INTENT_WORKER_FAILED`, `INTENT_SELF_DISABLED`. Requires `pnpm --filter @xyne/shared build`. |
| `src/components/Chat/ChatInput/ChatInput.tsx` | `classifyIntent()` helper called from both send branches in `handleSendMessage`. |
| `src/routes/AppRoot.tsx` | `intent-playground` route under `:workspaceId`. |
| `packages/shared/src/validation/flowSchema.ts` | `call_start` component + union entry. |
| `flowUI/nodes/NodeRegistry.ts` | Registers `call_start`. |
| **backend** `apps/controllers/flowController.ts` | Intercepts native card actions before the app-webhook proxy. |
| **backend** `app.ts` | `/api/intent/suggest` + the S2S callback route. |
| `vite.config.ts` | `viteStaticCopy` target for ONNX WASM, mirroring pdfjs. |
| `eslint.config.js` | Ignore `scripts/**` — outside `tsconfig.app.json`, so typed rules cannot resolve it. |
| `package.json` | Transformers.js dep; `fetch-model`, `prebuild`, `build:prototypes`, `eval:intents`. |

---

## 5. Implementation notes

### 5.1 Self-hosted model assets

Weights and the ONNX runtime WASM ship as **static assets from our own origin**, never the
Hugging Face CDN — a runtime third-party dependency breaks under mTLS and kills the offline
story. The repo already does exactly this for pdfjs (`vite.config.ts:29-43`); copy that
shape:

```ts
viteStaticCopy({
  targets: [
    /* existing pdfjs entries */
    { src: 'node_modules/@huggingface/transformers/dist/*.wasm', dest: 'onnx' },
    { src: 'public/models/all-MiniLM-L6-v2/**', dest: 'models/all-MiniLM-L6-v2' },
  ],
})
```

Pin the runtime to local assets before the first pipeline call:

```ts
env.allowLocalModels = true;            // ← REQUIRED in a worker, see below
env.allowRemoteModels = false;          // the enforcement point — worth a test
env.localModelPath = '/models/';
env.backends.onnx.wasm.wasmPaths = '/onnx/';
```

> **The gotcha that will bite you.** `allowLocalModels` defaults to
> `!(IS_BROWSER_ENV || IS_WEBWORKER_ENV || IS_DENO_WEB_RUNTIME)` (transformers `src/env.js`)
> — **`false` inside a worker**, `true` in Node. Setting only `allowRemoteModels = false`
> leaves *both* sources disabled and the library throws:
>
> ```
> Invalid configuration detected: both local and remote models are disabled.
> ```
>
> A browser has no filesystem, so "local" here means *served from our own origin at
> `localModelPath`*, not from disk. Because Node defaults it on, `build-prototypes` and
> `eval-intents` work without it — so this failure mode is **invisible to CI and only
> appears in the browser**. That is exactly why the browser smoke test is not optional.

Model in use: `Xenova/all-MiniLM-L6-v2` q8 (~23MB, 384-dim). `pnpm fetch-model` vendors it
into `public/models/` (gitignored) and `prebuild` runs it, so a fresh clone or CI build
fetches once and serves locally. Fetching from HF at *build* time is fine — it runs on our
infra and the output is self-hosted; only a *runtime* CDN dependency is forbidden.

WASM is fast enough for embeddings; WebGPU is an optional later tune, not a requirement.

Under pnpm, `onnxruntime-web` is a transitive dep of `@huggingface/transformers` and is **not**
symlinked into `apps/dashboard/node_modules`, so a literal `node_modules/onnxruntime-web` copy
path silently copies nothing. `vite.config.ts` resolves it from the transformers entry instead.
Neither package exports `./package.json`, so resolution goes through the entry module.

Lazy-load on first `submit`, not at worker construction — users who never post in a public
channel should never pay the download.

### 5.2 Intent registry

```ts
export const INTENTS = [
  {
    id: 'start-call',
    examples: [ 'how do I make a call', 'can we hop on a quick call', /* … */ ],
    negatives: [ 'who is handling the on call shift', 'the API call returned an error', /* … */ ],
    threshold: 0.99,          // Phase 1: unreachable on purpose. Set from data in Phase 2.
  },
] as const satisfies readonly IntentSpec[];

export const PROTOTYPES_VERSION = '3';   // bump on ANY change to the phrases
```

`scripts/build-prototypes.mjs` runs the **same model and quantization** in Node and writes
`prototypes.json`. Wire it as a `prebuild` step so vectors can never drift from the registry.

This is the property that makes the whole approach worth it: **adding an intent is a PR that
touches a JSON file.** No retraining, no prompt engineering, no model change.

> Never copy strings from `fixtures/intents.jsonl` into `examples`. That set is held out;
> overfitting it makes the eval report numbers that production will not reproduce.

### 5.3 Scoring — max over prototypes, suppressed by anti-prototypes

Two design choices here were forced by measurement, not preference.

**One vector per example, not one mean centroid.** Mean-pooling diverse phrasings washes the
signal out badly enough that scores invert:

|                     | mean centroid | max over prototypes |
|---------------------|---------------|---------------------|
| weakest positive    | 0.451         | **0.695**           |
| strongest negative  | 0.611         | **0.557**           |
| separation          | **−0.160**    | **+0.138**          |

With the mean there is *no* threshold that separates positives from negatives at all. Taking
the max over each example vector keeps every phrasing sharp and costs one dot product per
example — microseconds at 384 dims.

**Anti-prototypes.** Some collisions cannot be fixed from the positive side. "who is on call
this week" sits closer to the call-intent examples than several genuine positives do. Each
intent therefore carries `negatives`, and the intent is suppressed when a negative outscores
every positive. This kills 10 of 15 fixture negatives outright, before any threshold applies.

A suppressed intent scores `0` so it can neither out-rank a live intent nor clear a
threshold, while `negativeScore` / `matchedNegative` are retained for debugging (the
playground renders both).

The trigger decision is `max(score)`; the intent id is an advisory hint for server routing,
not a commitment. `runnerUpScore` costs two lines and is the best available signal for "these
two intents are confusable and need better examples."

### 5.3.1 Per-segment scoring

A single mean-pooled vector over a whole message **buries a short ask in surrounding
text**. Measured on a real 248-char message ending "Lets connect to discuss about this
once?":

| | score |
|---|---|
| whole message, one vector | **0.000** (an anti-prototype won a noise contest) |
| per sentence, take the max | **0.686** — from the ask itself |

Long messages are the common case in channels, so whole-message scoring silently loses
most of the traffic this feature exists for. `splitForScoring()` splits on sentence
terminators and hard newlines, drops fragments under `MIN_TEXT_LENGTH`, and caps at
`MAX_SEGMENTS` (8). A message with no punctuation stays one segment — previous behavior.

The worker **batch-embeds** all segments in one `extractor(segments)` call; per-call
overhead dominates at this model size, so a five-sentence message costs about what a
one-sentence message does. `MAX_TEXT_LENGTH` was raised 400 → 1000 once dilution stopped
being a reason to drop long messages.

**`eval-intents.mjs` mirrors this exactly.** If the two drift, CI stops predicting runtime.

### 5.3.2 Absorber intents (`actionable: false`)

Some intents exist only to **compete**, not to act. `platform-help` claims "how do I make a
call" so `start-call` stops claiming it — before the split that phrasing scored **0.988 as
start-call**, the highest of anything measured, so a user asking for help got a card
proposing a call with colleagues.

`actionable` is a real field, not "set the threshold to 0.99". That trick does not work: a
near-exact match to an example scores **1.0000** and sails over any threshold below it,
producing a round-trip the server rejects as `unsupported-intent`. Absorbers therefore keep
a real, meaningful threshold — so their scores stay interpretable in metrics and giving them
an action later is a one-word change.

### 5.4 Prefilter

`prefilterDetail()` returns `{ pass, reason }` so a trace can say *why* something was
dropped; `prefilter()` is the boolean wrapper used by the hot path and the scripts.

Deliberately conservative — every rule here is silent recall loss, and keyword matching is
what the embeddings are for:

```ts
function prefilter(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 400) return false;
  if (URL_ONLY.test(t) || CODE_FENCE.test(t)) return false;
  return true;                          // shape only — no words, no language assumptions
}
```

Word-based rules would make this English-only. Keep it to length and shape.

### 5.5 Self-disabling perf budget

A slow device should drop the feature, not degrade the app:

```ts
if (samples > 50 && p95(embedMs) > BUDGET_MS) {
  disabled = true;
  logger.info(Event.INTENT_SELF_DISABLED, { p95: p95(embedMs) });
}
```

Combined with a remote-config kill switch, that's both a client-side and a server-side off
ramp — worth having before this touches every message.

---

### 5.5.1 The two floors, and `unclassified`

`topIntent` is an **argmax**, so with a handful of intents one always "wins" no matter how
irrelevant the text. Ordinary chatter — thank-yous, deploy notes — lands on whichever intent
is least unlike it, around 0.15–0.25. Two floors keep that from becoming a lie:

| Constant | Value | Stops |
|---|---|---|
| `MIN_INTENT_SCORE` | 0.35 | Below it `topIntent` becomes **`unclassified`**. Without it every message records `intent="start-call"` at ~0.2, so `intent_classification_total` reads as "start-call classified N times" when it means "start-call was argmax N times" — and the production score histogram, which §7 says to read the live threshold off, drowns in noise. |
| `NEGATIVE_FLOOR` | 0.35 | An anti-prototype must clear this on its own, not merely beat a ~0 positive. Otherwise suppression compares noise to noise and the trace reports a deliberate rejection where nothing was ever close to firing. |

0.35 sits in measured empty space: chatter tops out ~0.22, the weakest true positive is
0.408, the hardest real negative ("who is on call this week") is 0.591 — so genuine
near-misses stay visible as near-misses.

The floor is applied inside `scoreVector`, the one place every caller goes through, so
telemetry, traces and the playground cannot each forget it.

### 5.6 Debug tracing

`debug.ts` emits a numbered trace for every pipeline stage, across both threads. On by
default in dev; in any build:

```js
localStorage.setItem('xyne:intent-debug', '1'); location.reload();   // on
localStorage.setItem('xyne:intent-debug', '0');                      // force off in dev
```

Filter the console on `[intent` to see the whole flow in order:

```
[intent:main]   0. gate — public channel, classifying {messageId}
[intent:main]   worker spawned
[intent:worker] 1. prefilter — 18 chars
[intent:worker] 2. loading model all-MiniLM-L6-v2 (q8) from /models/
[intent:worker] 2. model ready in 422ms
[intent:worker] 3. embedded → 384d vector in 27.3ms
[intent:worker] 4. scored (max cosine vs each example / anti-example)   ← console.table
[intent:worker] 5. verdict — start-call @ 0.7063
[intent:main]   6. telemetry recorded {intent_score, intent_embed_duration, …}
[intent:main]   7. trigger disabled (Phase 1 measure-only) — score 0.7063 WOULD fire at
                   the candidate threshold 0.6; nothing rendered, no server call
```

Step 4 is a `console.table` of `positive` / `negative` / `verdict` / closest matching phrase
per intent — the fastest way to see *why* something scored as it did. Branch traces cover
prefilter rejection (with the reason), suppression, a non-public channel, scheduler
queue/drop, and the perf budget.

**Step 7 deliberately reports the counterfactual.** A strong score followed by a bare
"disabled" reads like a misclassification. `CANDIDATE_THRESHOLD` in `config.ts` exists only
for this line — it drives no decisions, and the real threshold still comes from the
production histogram (§6.3).

Workers have no `localStorage`, so the main thread resolves the flag and pushes it in via a
`SET_DEBUG` message in `ensureWorker()`. Anything talking to the worker directly must send
that itself.

## 6. Telemetry

Two channels, both already existing and both already off the main thread.

### 6.1 Distributions → OTel → Grafana

New file `services/otel/intentMetrics.ts` using the **lazy-Proxy idiom** from
`services/otel/loadingMetrics.ts`. The Proxy exists so instruments are created on first
*access*, after the global provider is set in `otel/telemetry.ts:29` — not at module eval.
Record through `safeRecordMetric` (`otel/index.ts:55`).

| Metric | Type | Attributes |
|---|---|---|
| `intent_classification_total` | Counter | `intent`, `triggered`, `shadow`, `prefiltered`, `platform` |
| `intent_score` | Histogram (0–1) | `intent`, `platform` |
| `intent_embed_duration` | Histogram (ms) | `platform` |
| `intent_worker_init_duration` | Histogram (ms) | `platform`, `outcome` |

Score buckets must be dense through the decision region — this is what lets us **read the
threshold off a Grafana heatmap** instead of guessing it:

```ts
advice: { explicitBucketBoundaries:
  [0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95] }
```

Recording into a histogram is an in-memory bucket increment; the network cost is one export
per 60s (`OTEL_EXPORT_INTERVAL_MS`) regardless of volume. That's why we can afford to record
on every single classification.

> **Cardinality guardrail.** `service.instance.id` is a per-browser UUID set as a *resource*
> attribute (`otel/telemetry.ts:44`), so it lands on every series and multiplies against
> every attribute we add. This metric fires far more often than `data_load_duration`. Stick
> to the table above. **Never** put `messageId`, `channelId`, `userId`, or a raw score in an
> attribute. Emit `tier` / `centroidsVersion` once per session on a separate low-frequency
> counter.

Reuse `wasInterrupted` from `@xyne/shared/hooks` before recording `embedMs` — see
`hooks/useLoadingAnimationLog.ts:25`. A backgrounded tab makes the number garbage and will
poison p95.

### 6.2 Per-event records → logger → Grafana logs

Histograms can't join a classification to its server verdict. `logger` can, and it's already
batched in `logger.worker.ts` (`logger.ts:86`) so it costs nothing on the main thread:

```ts
logger.info(Event.INTENT_CLASSIFIED, {
  messageId, topIntent, topScore, runnerUpScore, embedMs,
  modelId, centroidsVersion, thresholdVersion, triggered, shadow,
});                                     // no text, ever
```

The join is documented in our own code — `otel/telemetry.ts:89-97` explains that
`service_instance_id` pairs the Prometheus series to the bridge's `clientSessionId` /
`emailId` / `platformName`.

**The version fields are not optional.** Change the quantization or add three examples and
every score shifts; without `modelId` / `centroidsVersion` / `thresholdVersion` stamped on
each record you can't tell a regression from a rebase, and historical data becomes
uninterpretable.

### 6.3 Grafana panels

```promql
# score distribution — Heatmap panel, format "Heatmap", legend {{le}}
sum(rate(intent_score_bucket[5m])) by (le)

# embed p95 by platform
histogram_quantile(0.95, sum(rate(intent_embed_duration_bucket[5m])) by (le, platform_name))

# volume and prefilter reject rate
sum(rate(intent_classification_total[5m])) by (prefiltered)

# Phase 2 — trigger rate (the cost dial)
sum(rate(intent_classification_total{triggered="true"}[5m]))
  / sum(rate(intent_classification_total[5m]))

# Phase 2 — decline rate = local false-positive rate
sum(rate(intent_trigger_resolved_total{verdict="declined",shadow="false"}[5m]))
  / sum(rate(intent_trigger_resolved_total{shadow="false"}[5m]))

# Phase 2 — shadow yield = recall we're leaving behind
sum(rate(intent_trigger_resolved_total{shadow="true",verdict="widget"}[5m]))
  / sum(rate(intent_trigger_resolved_total{shadow="true"}[5m]))
```

Match the exact series naming your existing loader panels use — depending on collector
config, OTel→Prometheus may append unit suffixes alongside `_bucket`/`_sum`/`_count`.

---

## 7. Evaluation

Runtime telemetry tunes thresholds; the fixture eval gates the build. They are different
things — don't conflate them.

`fixtures/intents.jsonl` — positives plus, critically, the near-miss negatives:

```jsonl
{"text": "can we hop on a call", "expect": "start-call"}
{"text": "I called the API and it 500'd", "expect": null}
{"text": "who's on call this week", "expect": null}
{"text": "there's a clear call to action here", "expect": null}
```

`scripts/eval-intents.mjs` runs in Node against the same model, quantization, prototypes and
scoring module as the worker, and **sweeps the threshold** rather than asserting against a
fixed one. Picking the threshold *is* the decision. Current output:

```
model all-MiniLM-L6-v2-q8 · prototypes v3 · 25 fixtures
anti-prototypes suppressed 10 negative(s)

intent          thr=0.50     thr=0.55     thr=0.60     thr=0.65     thr=0.70
start-call      P0.82 R0.90  P0.88 R0.70  P1.00 R0.50  P1.00 R0.50  P1.00 R0.40
                best F1 0.857 at threshold 0.50

precision-first operating points
  start-call @ P>=1.00: recall 0.50 at threshold 0.60
```

**Read the precision-first line, not best-F1.** This cascade is precision-biased: a false
positive costs a server call and possibly a wrong widget, while a false negative is invisible
(nothing renders — today's behavior). `P=1.00 at recall 0.50` is a perfectly good operating
point; catching every call-intent message is not the goal.

The separation line reports the weakest positive against the strongest negative. It is
currently **inverted (−0.183)** — `"who is on call this week"` at 0.591 still outscores
`"this would be way faster to explain live"` at 0.408. That means high recall is unreachable
for this intent and it can only be run precision-only. It is a known, accepted gap: the
fixtures record it, and production distributions will say whether it matters.

`--ci` fails the build when the best achievable F1 drops below the floor. The table always
prints so a reviewer can see what a new example did to the tradeoff.

### 7.1 CI scores are close to, but not identical to, runtime

The eval runs under `onnxruntime-node`; the worker runs under `onnxruntime-web`'s WASM
backend. On the q8-quantized model the two disagree by roughly **±0.02**:

| phrase | Node (eval) | browser (worker) |
|---|---|---|
| "can we hop on a call to discuss this" | 0.695 | 0.669 |
| "who is on call this week" | 0.591 | 0.579 |

So treat CI numbers as a **regression signal, not a calibration source**. Never lift a
threshold straight out of the eval table — the production score histogram (§6.3) is measured
in the browser and is the only correct place to read one from. Keep the CI floor slack enough
to absorb the drift.

### 7.2 The flywheel

From Phase 2 onward, every trigger produces a server verdict. Log the pair and you get a
precision curve on real traffic with **zero human labeling** — decline rate *is* the local
false-positive rate.

Export high-score-but-declined messages weekly into the fixture set. Within a couple of
months the eval corpus is made of real failures from our own channels rather than phrases
someone imagined at a whiteboard, and traps like "on-call rotation" get caught in CI instead
of production.

The catch: verdicts only exist for messages that triggered, so this measures precision and
never recall. That's what the 1% sub-threshold shadow sample in Phase 2 is for.

---

## 8. Phases

**Phase 1 — classifier (done).** Worker, registry, metrics, logger events, eval harness,
playground.

**Phase 2 — the loop (done, live).** `/api/intent/suggest`, claw dispatch, S2S callback,
`call_start` card, native card actions. `INTENT_TRIGGER_ENABLED = true`, `start-call`
threshold **0.60**.

Measured on the first closed loop: local classify ~35–50ms, **agent run 77 seconds**, card
posted 30ms after the agent answered. See §8.1 for what that latency means.

Verified end-to-end in headless Chromium and by hand in the running app: model load
**~420–490ms**, embed **~27–50ms** per message, suppression firing, no console errors, and no
requests to any Hugging Face host.

First live signal from the real send path — `"Hello can we call"` in a seeded public channel
scored **0.7063**. That phrasing is short, blunt, and matches none of the 16 registry
examples closely, yet it still sits well clear of the 0.591 that `"who is on call this week"`
reaches. Encouraging in a way the fixture set cannot demonstrate, since the fixtures were
written by the same person who wrote the examples.

Measured latency is well inside `EMBED_BUDGET_MS` (150) but is several times the ~10ms
often quoted for MiniLM-class models — that figure assumes native inference, not
single-threaded WASM. Without COOP/COEP the ONNX runtime cannot use `SharedArrayBuffer` and
falls back to one thread; adding cross-origin isolation is a possible later win, but it
affects the whole app and is not worth it for this alone.

Every threshold in this design is an empirical question. Shipping measure-only first costs
one release, is zero-risk, and replaces every guess with real score distributions across real
user hardware.

*Exit criteria:* one week of production distributions, p95 `embedMs` under budget across
platforms, and enough high-score-but-wrong examples harvested from logs to seed the
hard-negative fixtures.

**Local test data.** The org seeder (`apps/backend/scripts/org-seed.ts`,
`org-seed-content.ts`) populates ~100 people and ~100 channels, and its content includes both
call-intent phrasings and the near-miss negatives blended into normal conversation. Caveat
worth knowing: the seeder only writes messages into the single `#xyne-spaces` hero channel —
the other channels get membership rows only — so it exercises the send path but does not give
a realistic multi-channel score distribution. Do not read a threshold off seeded data.

### 8.1 Known gaps, in priority order

1. **77s agent latency.** Far too slow for something meant to feel ambient — the card lands
   long after the user moved on. Cause: reusing `ask-ai`, a heavyweight general agent on
   `kimi-latest` with the full tool catalog. Fix is a dedicated `intent-*` agent with a tight
   tool scope and fast mode, which needs the provisioning story in gap 2.
2. **No per-org agent provisioning.** `Agent` rows are per-org (`@@unique([orgId, slug])`);
   `prisma/seed.ts` seeds only the `Juspay` org and nothing provisions new ones. That is why
   we reuse `ask-ai` rather than shipping a purpose-built agent.
3. **Attendee selection is weak.** The first successful run proposed only the message author
   — the "propose rather than decline" escape hatch firing, with the agent's own rationale
   *"Message author is only identifiable participant"*. It is not reaching channel members.
4. **`platform-help` has no positives of its own** in the fixtures, so its eval sweep says
   nothing. It needs labelled positives before its numbers mean anything.
5. **Eval under-reports suppression.** The counter reads `all[0].suppressed`, but a suppressed
   intent scores 0 and no longer sorts first, so it prints 0 where the mechanism is in fact
   firing (verified directly: on-call rotation, API-call and "good call" phrasings all
   suppress at neg 0.51–0.65). Reporting bug only — behavior is correct.
6. **Threshold is a constant, not remote config.** It should move without a client release,
   especially once it becomes a cost dial.
7. **No shadow sampling.** Without a sub-threshold sample there is no way to measure recall —
   we only ever see verdicts for messages that triggered.

### 8.2 Server-side traps already paid for

| Symptom | Cause / fix |
|---|---|
| `runS2SClawAgent` → **HTTP 404** | Dead code with no callers; POSTs to a bare `/claw/api/v1/webhook`, but claw-auth only routes `/webhook/app/:spacesAppId` and `/webhook/:agentSlug`. Use **`runClawAgent`** (what `emailService` uses) — it resolves the installed app, signs with the app secret, and derives org identity itself. |
| `listS2SClawAgents` → **HTTP 401** | Backend `XYNE_CLAW_S2S_KEY` was empty. **The variable names are inverted between services**: backend→claw authenticates with `XYNE_CLAW_S2S_KEY`, claw→backend with `INTERNAL_S2S_KEY` — same secret, different name on each side. |
| Agent declines every time | The prompt asked for "participants active in this thread". This fires the instant a message posts, so the thread is **always** empty. Point it at the channel and say explicitly that zero replies is normal. |
| Agent reasons about markup | Messages are stored as HTML. Strip with `stripHtml` from `@/agents/xyne-ai/tools/helpers` before prompting. |
| Failed dispatch suppresses retries | The dedupe key is claimed *before* dispatch; release it in a `finally` when dispatch does not happen, or one transient failure silently blocks the message for 10 minutes and the retry misreports `already-dispatched`. |

Because the server can decline, a local false positive costs money rather than UX — so the
local threshold is tuned against a **cost target** ("~15 agent runs per 1000 public-channel
messages"), not a quality target.

**Phase 3 — more intents.** The machinery is intent-agnostic; adding one is a registry entry,
fixtures, an agent prompt branch, a result schema, and a card. Nothing about the pipeline is
call-specific — see §10.

**Phase 4 — every-viewer classification.** Requires server-side dedup by `messageId` with a
short TTL cache and broadcast fan-out first, or N viewers fire N calls for one message. Also
the point at which a worker-side ring buffer for telemetry becomes necessary.

**Phase 5 — generative escalation.** Argument extraction and the low-confidence band. Where
WebGPU / `node-llama-cpp` / Electron-native inference finally earn their complexity.

---

## 9. Standing guardrails

- Only take on tasks where **local failure equals current behavior**.
- **Public channels only**, one chokepoint, fail closed, re-checked at submit time.
- **No message text in telemetry, ever** — not in a metric attribute, not in a log field.
- **User-visible setting from day one.** Enterprise review will ask what analyzes every
  message; "on-device, here's the toggle" is a much better answer than a retrofit.
- Never silently downgrade an agentic, tool-using response to a local model. Local and
  server are not peers — the local model cannot search, cite, or call tools, and pretending
  otherwise produces confident hallucinations the user can't diagnose.

---

## 10. Adding a new intent

The pipeline is intent-agnostic. Adding one touches config and data, not plumbing.

1. **Check whether the card already exists.** Grep `flowSchema.ts` for component types and
   list `flowUI/nodes/`. `call_schedule` was nearly rebuilt from scratch because nobody
   looked — it was already there, fully styled, matching the Figma.
2. Add the intent to `intents.ts`: `examples`, `negatives`, `threshold`, `actionable`.
   Bump `PROTOTYPES_VERSION`.
3. `pnpm build:prototypes`.
4. Add fixtures — positives **and** near-miss negatives. **Never copy fixture strings into
   `intents.ts`**; that set is held out and overfitting it makes the eval lie.
5. `pnpm eval:intents`. Read the **precision-first operating point**, not best F1: a false
   positive costs an agent run and a wrong card, a false negative is invisible.
6. Allow-list it in `SUPPORTED_INTENTS` (`intentSuggestionService.ts`).
7. Add the agent prompt branch and its zod result schema.
8. Build or extend the FlowJSON component; register it in `NodeRegistry.ts`.
9. Handle its card actions — natively in `flowController` if it is a Spaces operation, or
   via an app webhook if it belongs to an app.

If a new intent only needs to *stop* another one misfiring, make it an absorber
(`actionable: false`) and skip steps 6–9 entirely — see §5.3.2.

---

## 11. Model choice — not yet benchmarked

`all-MiniLM-L6-v2` q8 was chosen as a **safe default, not a measured winner**. §5.1 says to
validate the choice against the fixture corpus before committing; that has not been done.

For an ambient classifier the binding constraints are not benchmark quality:

| constraint | why it dominates |
|---|---|
| Download size | Every browser pulls it once. 22MB is tolerable; 100MB+ is a conversation with users |
| Single-threaded WASM | No COOP/COEP ⇒ no `SharedArrayBuffer` ⇒ one thread. Layer count sets latency directly |
| ONNX-published | Transformers.js cannot run a PyTorch checkpoint; it must exist as an exported ONNX artifact |
| Short-text similarity | Channel messages, not documents |

MiniLM-L6 wins the first three by construction: 6 layers, 384 dims, int8, and it is the most
widely ONNX-published sentence-transformer available.

### Candidates

| model | dims | rough size (q8) | tradeoff |
|---|---|---|---|
| `all-MiniLM-L6-v2` **(current)** | 384 | ~22MB | Fastest transformer option, weakest quality |
| `all-MiniLM-L12-v2` | 384 | ~33MB | 2× layers ⇒ roughly 2× latency, modest quality gain |
| `gte-small` | 384 | ~33MB | Generally beats MiniLM on retrieval benchmarks; same dims, drop-in |
| `bge-small-en-v1.5` | 384 | ~33MB | Strong, but expects a **query prefix** convention — get it wrong and scores degrade silently |
| `e5-small-v2` | 384 | ~33MB | Same prefix caveat |
| EmbeddingGemma-300M | 768 | ~200MB+ | Much stronger, far too heavy per-message in a browser |

All the 384-dim options are genuine drop-ins — same `prototypes.json` shape, same dot product.

**Static embeddings (Model2Vec / `potion`)** are the outlier worth an experiment: a distilled
lookup table with no attention and no forward pass. Inference drops ~40ms → ~1ms and size to
single-digit MB, which would make per-segment scoring free. The catch is that a token's vector
never changes with its neighbours, so context-dependent collisions — precisely our "on call" vs
"hop on a call" problem — would likely get *worse*. Check Transformers.js/ONNX availability
before planning around it.

### How to evaluate a swap

```bash
# edit MODEL_ID / MODEL_DTYPE in src/services/onDeviceIntent/config.ts,
# add the repo to scripts/fetch-model.mjs, then:
pnpm fetch-model
pnpm build:prototypes     # re-embeds every phrase with the new model
pnpm eval:intents         # same held-out fixtures, like-for-like
```

**Judge on the separation number, not the benchmark.** It is currently −0.183, which is what
forces precision-only operation. A model that pushes separation positive earns its download
weight; one that merely scores better on MTEB does not.
