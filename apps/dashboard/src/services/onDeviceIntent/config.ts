/**
 * Shared constants for the on-device intent classifier.
 *
 * Imported by the worker, the main-thread service, and the Node-side scripts
 * (build-centroids, eval-intents), so the model used to build the centroids can
 * never drift from the one used at runtime.
 *
 * See docs/ON_DEVICE_INTENT.md
 */

/** Keep in sync with scripts/fetch-model.mjs. */
export const MODEL_ID = 'all-MiniLM-L6-v2';

/** Quantized ONNX weights (~23MB). */
export const MODEL_DTYPE = 'q8';

/**
 * Stamped on every metric/log record. Bump on ANY change to the model or its
 * quantization — every score shifts, and without this an eval regression is
 * indistinguishable from a rebase.
 */
export const MODEL_VERSION = `${MODEL_ID}-${MODEL_DTYPE}`;

/**
 * Master switch for acting on a detection at all. When true, a score clearing its
 * intent's `threshold` emits to the toast hook.
 *
 * This gates a REAL call site — it is not a telemetry label. Turning it off
 * returns the feature to measure-only: classification still runs and still emits
 * metrics, but nothing is contacted and nothing renders.
 *
 * See docs/ON_DEVICE_INTENT.md §8.
 */
export const INTENT_TRIGGER_ENABLED = true;

/*
 * THE SERVER PATH IS GONE — ON PURPOSE, AND IT IS RECOVERABLE.
 *
 * A detection now does exactly one thing: emit to whoever subscribed, which the
 * toast hook renders. No server call, no agent run, no cost, no latency.
 *
 * There used to be an `INTENT_ACTION_MODE: 'toast' | 'server'` switch here, with
 * a full backend behind it — `/api/intent/suggest` dispatched a claw agent that
 * picked attendees and posted a `call_start` FlowJSON card into the thread. It
 * worked. It was removed for the first cut for two reasons: the agent round-trip
 * measured ~77s, which is poor for something meant to feel ambient, and a config
 * flag whose other branch points at a deleted route is a trap rather than a seam.
 *
 * To restore it, everything is in commit 4b9c26eb7:
 *
 *   git checkout 4b9c26eb7 -- \
 *     apps/backend/src/services/intentSuggestionService.ts \
 *     apps/backend/src/services/intentCallActionService.ts \
 *     apps/backend/src/controllers/intentSuggestion.handler.ts
 *
 * then re-add the two integration points (2 routes in `apps/backend/src/app.ts`,
 * the `isIntentCallAction` block in `apps/backend/src/apps/controllers/
 * flowController.ts`) and `requestSuggestion()` in `intentClassifier.ts`.
 *
 * The CLIENT half of the card is gone too, from the same commit: CallStartNode.tsx,
 * its NodeRegistry entry, the playground preview, and `call_start` in BOTH
 * packages/shared/src/validation/flowSchema.ts and .../types/flowUI.ts. Those two
 * are separate hand-maintained sources of truth — restore both or `pnpm validate`
 * fails while `pnpm typecheck` passes.
 *
 * Read docs/ON_DEVICE_INTENT.md §3 before restoring — the server path predates
 * topic routing and only ever handled `start-call`.
 */

/**
 * If p95 embed latency exceeds this after a warmup sample, the classifier
 * disables itself rather than degrading the app.
 */
export const EMBED_BUDGET_MS = 150;
export const BUDGET_SAMPLE_SIZE = 50;

/**
 * Debug/preview reference point, mirroring the live per-intent threshold so traces
 * and the playground can say "this score would fire" without importing the registry.
 * Keep in sync with `IntentSpec.threshold`; the registry is the authority.
 *
 * 0.6 is the precision-first operating point from the fixture eval (P=1.00, R=0.50).
 * Re-read it from the production score histogram once real traffic accumulates —
 * see docs/ON_DEVICE_INTENT.md §7.
 */
export const CANDIDATE_THRESHOLD = 0.6;
