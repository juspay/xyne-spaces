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
 * Master switch for the server round-trip. When true, a score clearing its
 * intent's `threshold` POSTs to /api/intent/suggest, which may dispatch an agent
 * run and post a `call_start` card into the thread.
 *
 * This gates a REAL call site — it is not a telemetry label. Turning it off
 * returns the feature to measure-only: classification still runs and still emits
 * metrics, but no server is contacted and nothing renders.
 *
 * See docs/ON_DEVICE_INTENT.md §8.
 */
export const INTENT_TRIGGER_ENABLED = true;

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
