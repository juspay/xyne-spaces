/**
 * Main-thread owner of the on-device intent classifier.
 *
 * Responsibilities: worker lifecycle, the user-preference and public-channel
 * gates, the drop-oldest scheduler, and the self-disabling perf budget.
 *
 * NOTHING LEAVES THE DEVICE. There is no telemetry here — no OTel metrics, no log
 * records, no server call. The only observability is `trace()`, which writes to
 * the local console behind the `xyne:intent-debug` localStorage key. Metrics were
 * built (five instruments, tight attribute sets) and removed in the same PR: the
 * local collector was never actually reachable, so they measured nothing, and an
 * exporter that fails silently is worse than no exporter. See docs §6.
 *
 * This module is the ONLY thing allowed to talk to intent.worker.ts — the
 * eligibility gate is a single chokepoint by design. Adding a second entry point
 * is how "public channels only" silently erodes.
 *
 * Nothing here touches React state. See docs/ON_DEVICE_INTENT.md §3
 */

import { ChannelVisibility } from '@xyne/shared';
import { wasInterrupted } from '@xyne/shared/hooks';

import { isIntentSuggestionsEnabled } from '../../hooks/useIntentSuggestionsEnabled';

import {
  BUDGET_SAMPLE_SIZE,
  CANDIDATE_THRESHOLD,
  EMBED_BUDGET_MS,
  INTENT_TRIGGER_ENABLED,
} from './config';
import { getIntent } from './intents';
import { MIN_INTENT_SCORE, UNCLASSIFIED, UNRESOLVED_TOPIC } from './scoring';
import { isDebugEnabled, resolveDebugEnabled, setDebugEnabled, trace } from './debug';
import type {
  ClassificationResult,
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
} from './intent.worker';

/** Minimal shape we need — avoids coupling to the full Zero channel row. */
export interface ClassifiableChannel {
  visibility?: string | undefined;
}

/** What a subscriber is told when an intent fires. Carries no message text. */
export interface IntentDetection {
  intentId: string;
  messageId: string;
  score: number;
  /**
   * Which specific thing the message was about, for intents that route by topic
   * (see IntentSpec.topics). Absent for single-action intents.
   *
   * Never UNRESOLVED_TOPIC — an unresolved topic does not emit at all, so a
   * subscriber never has to decide what an unroutable how-to should look like.
   */
  topicId?: string;
}

type DetectionListener = (detection: IntentDetection) => void;

/**
 * Lifecycle of the ~23MB model download, for the Settings UI.
 *
 * `idle` means nothing has been requested yet — the model is fetched lazily, so a
 * user who never enables the feature never pays for it.
 */
export type ModelStatus =
  | { state: 'idle' }
  | { state: 'downloading'; percent: number | null }
  | { state: 'ready' }
  | { state: 'failed'; error: string };

type ModelStatusListener = (status: ModelStatus) => void;

interface PendingJob {
  requestId: string;
  text: string;
  messageId: string | null;
  /** Playground requests resolve a promise and skip telemetry entirely. */
  resolve: ((result: ClassificationResult) => void) | null;
  reject: ((error: Error) => void) | null;
}

/**
 * Public channels only, fail closed. `undefined` covers the channel still loading
 * and any unknown visibility value — both must not classify.
 */
export function isEligible(channel: ClassifiableChannel | undefined | null): boolean {
  return channel?.visibility === ChannelVisibility.PUBLIC;
}

class IntentClassifier {
  private worker: Worker | null = null;
  private inFlight: PendingJob | null = null;
  /** Depth 1 — ambient work is worthless once stale, so newest wins. */
  private queued: PendingJob | null = null;
  private requestCounter = 0;

  private disabled = false;
  private debugResolved = false;
  private embedSamples: number[] = [];
  private listeners = new Set<DetectionListener>();
  private modelStatus: ModelStatus = { state: 'idle' };
  private statusListeners = new Set<ModelStatusListener>();

  /**
   * Subscribe to detections that cleared their threshold.
   *
   * The classifier deliberately knows nothing about UI — it emits, and whoever
   * has the channel/conversation context decides what to render. Returns an
   * unsubscribe function for useEffect cleanup.
   */
  subscribe(listener: DetectionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current model-download state. Safe to call before anything has started. */
  getModelStatus(): ModelStatus {
    return this.modelStatus;
  }

  /**
   * Subscribe to model-download state. Returns an unsubscribe function.
   *
   * Separate from `subscribe()` because these have different lifetimes: detections
   * are consumed by the composer, status by Settings, and neither should have to
   * mount for the other to work.
   */
  subscribeModelStatus(listener: ModelStatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setModelStatus(status: ModelStatus): void {
    this.modelStatus = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        // A broken subscriber must not take down the classifier or its siblings.
      }
    }
  }

  /**
   * Discard a failed worker and download again.
   *
   * `disabled` is cleared too: a load failure disables the classifier, and without
   * clearing it `ensureWorker()` returns null and the retry silently does nothing.
   */
  retryModelLoad(): void {
    this.ensureDebug();
    trace('main', 'model retry requested');
    this.teardown();
    this.disabled = false;
    this.setModelStatus({ state: 'idle' });
    this.warmup();
  }

  private emit(detection: IntentDetection): void {
    for (const listener of this.listeners) {
      try {
        listener(detection);
      } catch {
        // A broken subscriber must not take down the classifier or its siblings.
      }
    }
  }

  /**
   * Resolve the debug flag before ANY trace fires.
   *
   * This used to live in ensureWorker(), which runs inside enqueue() — i.e. after the
   * gate trace. So the very first message after a page load silently lost its
   * `0. gate` line, and the run read as if it had come from somewhere other than
   * submitForMessage. Idempotent; called at the top of every entry point.
   */
  private ensureDebug(): void {
    if (this.debugResolved) return;
    this.debugResolved = true;
    setDebugEnabled(resolveDebugEnabled());
  }

  private ensureWorker(): Worker | null {
    if (this.disabled) return null;
    if (this.worker) return this.worker;

    try {
      this.worker = new Worker(new URL('./intent.worker.ts', import.meta.url), {
        type: 'module',
      });

      // Push the flag into the worker, which has no localStorage of its own. The
      // main-thread half is already enabled by ensureDebug() — see submitForMessage.
      this.worker.postMessage({
        type: 'SET_DEBUG',
        payload: { enabled: isDebugEnabled() },
      } satisfies WorkerIncomingMessage);
      trace('main', 'worker spawned');

      this.worker.onmessage = (event: MessageEvent<WorkerOutgoingMessage>) => {
        this.handleMessage(event.data);
      };
      this.worker.onerror = error => {
        trace('main', `worker error — ${String(error.message ?? error)}`);
        this.teardown();
      };
    } catch (error) {
      trace('main', `worker failed to spawn — ${String(error)}`);
      this.disabled = true;
      return null;
    }

    return this.worker;
  }

  private teardown(): void {
    this.worker?.terminate();
    this.worker = null;
    this.inFlight?.reject?.(new Error('intent worker terminated'));
    this.queued?.reject?.(new Error('intent worker terminated'));
    this.inFlight = null;
    this.queued = null;
  }

  /**
   * Production path. Fire-and-forget — callers must never await this, and it must
   * never throw into the send path.
   */
  submitForMessage(params: {
    text: string;
    messageId: string;
    channel: ClassifiableChannel | undefined | null;
  }): void {
    this.ensureDebug();
    // Read every time, not once at construction: the switch must take effect
    // without a reload (the worker does not hot-reload).
    if (!isIntentSuggestionsEnabled()) {
      trace('main', '0. gate — SKIPPED, disabled in Settings → Developer');
      return;
    }
    if (!isEligible(params.channel)) {
      trace('main', '0. gate — SKIPPED, channel is not public', {
        visibility: params.channel?.visibility ?? '(unknown)',
      });
      return;
    }
    trace('main', '0. gate — public channel, classifying', { messageId: params.messageId });

    this.enqueue({
      requestId: `m${++this.requestCounter}`,
      text: params.text,
      messageId: params.messageId,
      resolve: null,
      reject: null,
    });
  }

  /**
   * Playground path — no eligibility gate, no telemetry (it would pollute the
   * production score distributions we are trying to measure), and it resolves with
   * the full ranking rather than the trimmed telemetry payload.
   */
  classifyForPlayground(text: string): Promise<ClassificationResult> {
    this.ensureDebug();
    return new Promise((resolve, reject) => {
      const worker = this.ensureWorker();
      if (!worker) {
        reject(new Error('on-device classifier unavailable'));
        return;
      }
      this.enqueue({
        requestId: `p${++this.requestCounter}`,
        text,
        messageId: null,
        resolve,
        reject,
      });
    });
  }

  /** Start the model download ahead of first use. Safe to call repeatedly. */
  warmup(): void {
    this.ensureDebug();
    const worker = this.ensureWorker();
    if (!worker) {
      this.setModelStatus({ state: 'failed', error: 'classifier unavailable' });
      return;
    }
    if (this.modelStatus.state === 'idle' || this.modelStatus.state === 'failed') {
      this.setModelStatus({ state: 'downloading', percent: null });
    }
    worker.postMessage({ type: 'WARMUP' } satisfies WorkerIncomingMessage);
  }

  private enqueue(job: PendingJob): void {
    const worker = this.ensureWorker();
    if (!worker) {
      job.reject?.(new Error('on-device classifier unavailable'));
      return;
    }

    // The first message a user sends is what triggers the download in practice —
    // Settings is not the only entry point, so status has to start here too.
    if (this.modelStatus.state === 'idle') {
      this.setModelStatus({ state: 'downloading', percent: null });
    }

    if (this.inFlight) {
      // Drop-oldest: a queued job that never ran is stale by the time a slot frees.
      if (this.queued) {
        trace('main', `scheduler — DROPPED ${this.queued.requestId} (newest wins)`);
        this.queued.reject?.(new Error('superseded'));
      }
      trace('main', `scheduler — busy, queued ${job.requestId}`);
      this.queued = job;
      return;
    }

    this.dispatch(job);
  }

  private dispatch(job: PendingJob): void {
    this.inFlight = job;
    this.worker?.postMessage({
      type: 'CLASSIFY',
      payload: { requestId: job.requestId, text: job.text },
    } satisfies WorkerIncomingMessage);
  }

  private pump(): void {
    this.inFlight = null;
    const next = this.queued;
    this.queued = null;
    if (next) this.dispatch(next);
  }

  private handleMessage(message: WorkerOutgoingMessage): void {
    if (message.type === 'PROGRESS') {
      this.setModelStatus({ state: 'downloading', percent: message.payload.percent });
      return;
    }

    if (message.type === 'LOAD_FAILED') {
      trace('main', `model load failed — ${message.payload.error}`);
      this.setModelStatus({ state: 'failed', error: message.payload.error });
      return;
    }

    if (message.type === 'READY') {
      trace(
        'main',
        `worker READY — model ${message.payload.modelVersion}, ` +
          `prototypes v${message.payload.prototypesVersion}, ` +
          `loaded in ${message.payload.loadMs.toFixed(0)}ms`,
      );
      this.setModelStatus({ state: 'ready' });
      return;
    }

    if (message.type === 'ERROR') {
      const job = this.inFlight;
      trace('main', `worker reported an error — ${message.payload.error}`);
      job?.reject?.(new Error(message.payload.error));
      this.pump();
      return;
    }

    const result = message.payload;
    const job = this.inFlight;
    this.pump();

    if (job?.resolve) {
      trace('main', '6. playground request — resolving, telemetry intentionally skipped');
      job.resolve(result);
      return;
    }

    this.record(result, job?.messageId ?? null);
  }

  private record(result: ClassificationResult, messageId: string | null): void {
    if (result.prefiltered) {
      trace('main', '6. prefiltered — nothing scored');
      return;
    }

    const intent = getIntent(result.topIntent);
    const clearsThreshold = intent !== undefined && result.topScore >= intent.threshold;
    // Absorber intents compete for the top slot but never call out.
    const actionable = intent?.actionable === true;
    // Stage 2 is a gate, not a decoration: an intent that routes by topic must
    // actually resolve one. `platform-help` claims every how-to, including the
    // ones with no destination in the product ("how do I set up a canvas"), and
    // those must stay as silent as they were when it was a pure absorber.
    const routesByTopic = result.topic !== null;
    const topicId = result.topic?.topicId;
    const topicResolved = topicId !== undefined && topicId !== UNRESOLVED_TOPIC;
    const triggered =
      INTENT_TRIGGER_ENABLED &&
      actionable &&
      clearsThreshold &&
      messageId !== null &&
      (!routesByTopic || topicResolved);

    if (triggered) {
      // Local-only: hand it to whoever is subscribed and let them render.
      this.emit({
        intentId: result.topIntent,
        messageId,
        score: result.topScore,
        ...(topicResolved ? { topicId } : {}),
      });
    }

    // A backgrounded tab or a Zero reconnect makes the timing meaningless; feeding
    // it to the perf budget would self-disable the feature on a bogus sample.
    const skewed = wasInterrupted(performance.now() - result.embedMs);
    if (!skewed) this.checkBudget(result.embedMs);

    trace('main', '6. scored', {
      score: Number(result.topScore.toFixed(4)),
      embedMs: skewed ? 'skipped (skewed)' : Number(result.embedMs.toFixed(1)),
      intent: result.topIntent,
      topic: topicId ?? 'none',
      triggered: String(triggered),
    });

    // Always say what happened AND why — a strong score followed by silence reads
    // like a misclassification when it is usually a threshold or a disabled flag.
    trace(
      'main',
      triggered
        ? `7. TRIGGERED — ${result.topScore.toFixed(4)} ≥ ${intent?.threshold}` +
            (topicResolved ? ` → topic '${topicId}'` : '') +
            `; local toast (${this.listeners.size} subscriber` +
            `${this.listeners.size === 1 ? '' : 's'})`
        : !INTENT_TRIGGER_ENABLED
          ? `7. trigger disabled — score ${result.topScore.toFixed(4)}` +
            `${result.topScore >= CANDIDATE_THRESHOLD ? ' WOULD have fired' : ''}; nothing shown`
          : result.topIntent === UNCLASSIFIED
            ? `7. unclassified — best was ${result.topScore.toFixed(4)}, under the ` +
              `${MIN_INTENT_SCORE} floor, so no intent claims this. Nothing shown.`
            : !actionable
              ? `7. '${result.topIntent}' is an absorber (actionable: false) — it claimed this ` +
                `at ${result.topScore.toFixed(4)} so no other intent fires. Working as intended.`
              : clearsThreshold && routesByTopic && !topicResolved
                ? `7. '${result.topIntent}' claimed at ${result.topScore.toFixed(4)} but no topic ` +
                  `resolved — best was ${result.topic?.all[0]?.topicId} @ ` +
                  `${(result.topic?.score ?? 0).toFixed(4)} (margin ` +
                  `${(result.topic?.margin ?? 0).toFixed(4)}). Absorbed and staying quiet, which ` +
                  `is correct for a how-to with no destination in the product.`
                : `7. below threshold — ${result.topScore.toFixed(4)} < ${intent?.threshold ?? '?'}; no action`,
    );
  }

  /** A slow device drops the feature rather than degrading the app. */
  private checkBudget(embedMs: number): void {
    this.embedSamples.push(embedMs);
    if (this.embedSamples.length < BUDGET_SAMPLE_SIZE) return;

    const sorted = [...this.embedSamples].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    this.embedSamples = [];

    trace('main', `perf budget — p95 ${p95.toFixed(1)}ms of ${EMBED_BUDGET_MS}ms allowed`);
    if (p95 > EMBED_BUDGET_MS) {
      this.disabled = true;
      trace('main', 'perf budget EXCEEDED — self-disabling, worker terminated');
      this.teardown();
    }
  }
}

export const intentClassifier = new IntentClassifier();
