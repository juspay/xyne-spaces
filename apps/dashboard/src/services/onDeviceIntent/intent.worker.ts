/**
 * Web Worker for on-device intent classification.
 *
 * Embedding runs here so the send path never touches the main thread. The worker
 * owns the model; the main thread only ever receives a small flat result object.
 *
 * See docs/ON_DEVICE_INTENT.md §3
 */

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

import { MODEL_DTYPE, MODEL_ID, MODEL_VERSION } from './config';
import { INTENTS, PROTOTYPES_VERSION, getIntent } from './intents';
import {
  UNCLASSIFIED,
  prefilterDetail,
  resolveTopic,
  scoreVector,
  splitForScoring,
  type IntentScore,
  type PrototypeMap,
  type ScoreResult,
  type TopicResult,
} from './scoring';
import { setDebugEnabled, trace, traceTable } from './debug';
import prototypeData from './prototypes.json';

// Read only the weights we vendored ourselves. `allowRemoteModels = false` is the
// enforcement point for "no third-party runtime dependency" — without it Transformers.js
// silently falls back to the Hugging Face CDN, which breaks under mTLS and kills offline
// support.
//
// `allowLocalModels` MUST be set explicitly: it defaults to
// `!(IS_BROWSER_ENV || IS_WEBWORKER_ENV || IS_DENO_WEB_RUNTIME)` (env.js), i.e. `false`
// inside a worker. Setting only allowRemoteModels leaves BOTH sources disabled and the
// library throws "both local and remote models are disabled". Node defaults it to true,
// so the build/eval scripts do not need it — which is why this only fails in the browser.
//
// Both must be set before the first pipeline() call. See docs/ON_DEVICE_INTENT.md §5.1.
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = '/models/';
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = '/onnx/';
}

const prototypes = prototypeData.prototypes as PrototypeMap;

export interface WorkerClassifyMessage {
  type: 'CLASSIFY';
  payload: {
    requestId: string;
    text: string;
  };
}

export interface WorkerWarmupMessage {
  type: 'WARMUP';
}

/** Workers have no localStorage, so the debug flag is pushed in from the main thread. */
export interface WorkerSetDebugMessage {
  type: 'SET_DEBUG';
  payload: { enabled: boolean };
}

export type WorkerIncomingMessage =
  | WorkerClassifyMessage
  | WorkerWarmupMessage
  | WorkerSetDebugMessage;

export interface ClassificationResult {
  requestId: string;
  /** True when stage 0 rejected the text and no embedding was computed. */
  prefiltered: boolean;
  topIntent: string;
  topScore: number;
  runnerUpIntent: string | null;
  runnerUpScore: number;
  embedMs: number;
  /** Full ranking — playground only. Never forwarded to telemetry. */
  all: IntentScore[];
  /**
   * Stage-2 routing, present only when the winning intent has a topic table.
   * `topicId` is UNRESOLVED_TOPIC when the floor/margin were not met.
   */
  topic: TopicResult | null;
  /**
   * The segments the message was split into, and which one won.
   *
   * CONTAINS MESSAGE TEXT — playground and local traces only. `record()` must
   * never put these in a metric attribute or a log field.
   */
  segments: string[];
  matchedSegment: number;
}

export interface WorkerReadyMessage {
  type: 'READY';
  payload: { loadMs: number; modelVersion: string; prototypesVersion: string };
}

/**
 * Download progress for the ~23MB model.
 *
 * Surfaced because the first thing enabling this feature does is pull 23MB, and
 * a silent 23MB is indistinguishable from a broken feature — which is exactly how
 * a missing model went unnoticed twice during development.
 */
export interface WorkerProgressMessage {
  type: 'PROGRESS';
  payload: {
    /** 0-100 across all files, or null before any total is known. */
    percent: number | null;
    file: string;
  };
}

/** The model failed to load. Distinct from ERROR, which is per-classification. */
export interface WorkerLoadFailedMessage {
  type: 'LOAD_FAILED';
  payload: { error: string };
}

export interface WorkerResultMessage {
  type: 'RESULT';
  payload: ClassificationResult;
}

export interface WorkerErrorMessage {
  type: 'ERROR';
  payload: { requestId: string | null; error: string };
}

export type WorkerOutgoingMessage =
  | WorkerReadyMessage
  | WorkerProgressMessage
  | WorkerLoadFailedMessage
  | WorkerResultMessage
  | WorkerErrorMessage;

let extractor: FeatureExtractionPipeline | null = null;
let loading: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Lazy — a user who never posts in a public channel should never pay the ~23MB
 * download. Concurrent callers share one in-flight load.
 */
function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (extractor) return Promise.resolve(extractor);
  if (loading) return loading;

  const startedAt = performance.now();
  trace('worker', `2. loading model ${MODEL_ID} (${MODEL_DTYPE}) from ${env.localModelPath}`);

  // Transformers.js reports per-file byte progress. Only the ~23MB weights matter
  // for a progress bar — the tokenizer and configs are together under 1MB, and
  // letting them drive the number makes it jump to 100% and back.
  const onProgress = (report: {
    status?: string;
    file?: string;
    progress?: number;
    loaded?: number;
    total?: number;
  }): void => {
    if (report.status !== 'progress') return;
    // Weights only. The tokenizer and configs are under 1MB combined but each
    // reports its own 0-100, so including them makes the bar hit 100% and drop
    // back to 9% before the 23MB file has really started. Measured, not guessed.
    if (!report.file?.endsWith('.onnx')) return;
    const percent =
      typeof report.progress === 'number' && Number.isFinite(report.progress)
        ? Math.max(0, Math.min(100, Math.round(report.progress)))
        : null;
    post({ type: 'PROGRESS', payload: { percent, file: report.file ?? '' } });
  };

  loading = pipeline('feature-extraction', MODEL_ID, {
    dtype: MODEL_DTYPE,
    progress_callback: onProgress,
  })
    .then(loaded => {
      extractor = loaded;
      trace('worker', `2. model ready in ${(performance.now() - startedAt).toFixed(0)}ms`);
      post({
        type: 'READY',
        payload: {
          loadMs: performance.now() - startedAt,
          modelVersion: MODEL_VERSION,
          prototypesVersion: PROTOTYPES_VERSION,
        },
      });
      return extractor;
    })
    .catch(err => {
      // Reset so a retry can actually re-run; without this the rejected promise is
      // cached and every retry fails instantly with the original error.
      loading = null;
      trace('worker', `2. model load FAILED — ${String(err)}`);
      post({ type: 'LOAD_FAILED', payload: { error: String(err) } });
      throw err;
    });

  return loading;
}

function post(message: WorkerOutgoingMessage): void {
  self.postMessage(message);
}

async function classify(requestId: string, text: string): Promise<void> {
  trace('worker', `1. prefilter — ${text.trim().length} chars`);

  const gate = prefilterDetail(text);
  if (!gate.pass) {
    trace('worker', `1. REJECTED by prefilter: ${gate.reason} — no embedding computed`);
    post({
      type: 'RESULT',
      payload: {
        requestId,
        prefiltered: true,
        topIntent: UNCLASSIFIED,
        topScore: 0,
        runnerUpIntent: null,
        runnerUpScore: 0,
        embedMs: 0,
        all: [],
        topic: null,
        segments: [],
        matchedSegment: -1,
      },
    });
    return;
  }

  const model = await getExtractor();

  // Score each segment independently and keep the best. A single vector over a
  // whole message buries a short ask in surrounding text — see splitForScoring.
  const segments = splitForScoring(text);

  const startedAt = performance.now();
  // One batched call, not N sequential ones: the per-call overhead dominates at
  // this model size, so batching keeps a multi-sentence message near the cost of
  // a single-sentence one.
  const output = await model(segments, { pooling: 'mean', normalize: true });
  const embedMs = performance.now() - startedAt;

  const dims = Math.floor(output.data.length / segments.length);
  const raw = output.data as unknown as ArrayLike<number>;

  let scored: ScoreResult | null = null;
  let matchedSegment = 0;
  // The winning segment's vector is kept so stage 2 can reuse it. Re-embedding
  // the segment to route it would double the cost of every how-to for no gain.
  let bestVector: number[] | null = null;
  for (let i = 0; i < segments.length; i++) {
    const slice = Array.prototype.slice.call(raw, i * dims, (i + 1) * dims) as number[];
    const result = scoreVector(slice, prototypes);
    if (!scored || result.topScore > scored.topScore) {
      scored = result;
      matchedSegment = i;
      bestVector = slice;
    }
  }
  if (!scored || !bestVector) throw new Error('no segments to score');

  // Stage 2. Only intents that declare a topic table route; everything else has
  // a single action and needs no routing.
  const topicVectors = prototypes[scored.topIntent]?.topics;
  const topic = topicVectors ? resolveTopic(bestVector, topicVectors) : null;

  trace(
    'worker',
    `3. embedded ${segments.length} segment(s) → ${dims}d in ${embedMs.toFixed(1)}ms` +
      (segments.length > 1 ? ` — best: "${segments[matchedSegment]?.slice(0, 48)}"` : ''),
  );

  traceTable(
    'worker',
    '4. scored (max cosine vs each example / anti-example)',
    scored.all.map(s => {
      const intent = INTENTS.find(i => i.id === s.intentId);
      return {
        intent: s.intentId,
        positive: Number((s.suppressed ? s.score || 0 : s.score).toFixed(4)),
        negative: Number(s.negativeScore.toFixed(4)),
        verdict: s.suppressed ? 'SUPPRESSED' : 'live',
        closest: s.suppressed
          ? intent?.negatives[s.matchedNegative]
          : intent?.examples[s.matchedExample],
      };
    }),
  );

  if (topic) {
    // getIntent(), not INTENTS.find(): INTENTS is `as const`, so find() returns a
    // union of literal types and only the members that declare `topics` have it.
    const intent = getIntent(scored.topIntent);
    traceTable(
      'worker',
      `4b. topic routing for '${scored.topIntent}' (same vector, no re-embed)`,
      topic.all.map(t => {
        const spec = intent?.topics?.find(x => x.id === t.topicId);
        return {
          topic: t.topicId,
          score: Number(t.score.toFixed(4)),
          negative: Number(t.negativeScore.toFixed(4)),
          verdict: t.suppressed ? 'SUPPRESSED' : 'live',
          closest: t.suppressed
            ? spec?.negatives[t.matchedNegative]
            : spec?.examples[t.matchedExample],
        };
      }),
    );
  }

  const top = scored.all[0];
  trace(
    'worker',
    top?.suppressed
      ? `5. verdict — suppressed by an anti-example, score forced to 0`
      : `5. verdict — ${scored.topIntent} @ ${scored.topScore.toFixed(4)}`,
  );

  post({
    type: 'RESULT',
    payload: {
      requestId,
      prefiltered: false,
      topIntent: scored.topIntent,
      topScore: scored.topScore,
      runnerUpIntent: scored.runnerUpIntent,
      runnerUpScore: scored.runnerUpScore,
      embedMs,
      all: scored.all,
      topic,
      segments,
      matchedSegment,
    },
  });
}

self.onmessage = (event: MessageEvent<WorkerIncomingMessage>): void => {
  const message = event.data;

  if (message.type === 'SET_DEBUG') {
    setDebugEnabled(message.payload.enabled);
    trace('worker', `debug tracing on — model ${MODEL_VERSION}, prototypes v${PROTOTYPES_VERSION}`);
    return;
  }

  if (message.type === 'WARMUP') {
    void getExtractor().catch(err => {
      post({ type: 'ERROR', payload: { requestId: null, error: String(err) } });
    });
    return;
  }

  if (message.type === 'CLASSIFY') {
    const { requestId, text } = message.payload;
    void classify(requestId, text).catch(err => {
      post({ type: 'ERROR', payload: { requestId, error: String(err) } });
    });
  }
};
