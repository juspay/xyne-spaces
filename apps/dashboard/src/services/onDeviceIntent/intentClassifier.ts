/**
 * Main-thread owner of the on-device intent classifier.
 *
 * Responsibilities: worker lifecycle, the public-channel eligibility gate, the
 * drop-oldest scheduler, telemetry emission, and the self-disabling perf budget.
 *
 * This module is the ONLY thing allowed to talk to intent.worker.ts — the
 * eligibility gate is a single chokepoint by design. Adding a second entry point
 * is how "public channels only" silently erodes.
 *
 * Nothing here touches React state. See docs/ON_DEVICE_INTENT.md §3
 */

import { ChannelVisibility } from '@xyne/shared';
import { wasInterrupted } from '@xyne/shared/hooks';

import { apiInstance } from '../clients/apiClient';

import {
  intentClassificationTotal,
  intentDroppedTotal,
  intentEmbedDuration,
  intentScore,
  intentWorkerInitDuration,
  safeRecordMetric,
} from '../otel';
import { Event, logger } from '../../utils/logger';
import {
  BUDGET_SAMPLE_SIZE,
  CANDIDATE_THRESHOLD,
  EMBED_BUDGET_MS,
  INTENT_TRIGGER_ENABLED,
  MODEL_VERSION,
} from './config';
import { PROTOTYPES_VERSION, getIntent } from './intents';
import { MIN_INTENT_SCORE, UNCLASSIFIED } from './scoring';
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
        logger.warn(Event.INTENT_WORKER_FAILED, { error: String(error.message ?? error) });
        this.teardown();
      };
    } catch (error) {
      logger.warn(Event.INTENT_WORKER_FAILED, { error: String(error) });
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
    worker?.postMessage({ type: 'WARMUP' } satisfies WorkerIncomingMessage);
  }

  private enqueue(job: PendingJob): void {
    const worker = this.ensureWorker();
    if (!worker) {
      job.reject?.(new Error('on-device classifier unavailable'));
      return;
    }

    if (this.inFlight) {
      // Drop-oldest: a queued job that never ran is stale by the time a slot frees.
      if (this.queued) {
        trace('main', `scheduler — DROPPED ${this.queued.requestId} (newest wins)`);
        this.queued.reject?.(new Error('superseded'));
        safeRecordMetric(() => {
          intentDroppedTotal.add(1, { platform: logger.platformName });
        });
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
    if (message.type === 'READY') {
      safeRecordMetric(() => {
        intentWorkerInitDuration.record(message.payload.loadMs, {
          platform: logger.platformName,
          outcome: 'success',
        });
      });
      logger.info(Event.INTENT_WORKER_READY, {
        loadMs: message.payload.loadMs,
        modelVersion: message.payload.modelVersion,
        prototypesVersion: message.payload.prototypesVersion,
      });
      return;
    }

    if (message.type === 'ERROR') {
      const job = this.inFlight;
      logger.warn(Event.INTENT_WORKER_FAILED, { error: message.payload.error });
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
    const base = { platform: logger.platformName };

    if (result.prefiltered) {
      safeRecordMetric(() => {
        intentClassificationTotal.add(1, { ...base, prefiltered: 'true' });
      });
      trace(
        'main',
        '6. telemetry — intent_classification_total{prefiltered=true}; no score recorded',
      );
      return;
    }

    const intent = getIntent(result.topIntent);
    const clearsThreshold = intent !== undefined && result.topScore >= intent.threshold;
    // Absorber intents (platform-help) compete for the top slot but never call out.
    const actionable = intent?.actionable === true;
    const triggered = INTENT_TRIGGER_ENABLED && actionable && clearsThreshold && messageId !== null;

    if (triggered) {
      // Fire-and-forget. The server re-checks every gate and may decline; nothing
      // here waits on it and nothing surfaces to the user if it fails.
      void this.requestSuggestion(messageId, result.topIntent, result.topScore);
    }

    safeRecordMetric(() => {
      intentScore.record(result.topScore, { ...base, intent: result.topIntent });
      intentClassificationTotal.add(1, {
        ...base,
        intent: result.topIntent,
        prefiltered: 'false',
        triggered: String(triggered),
        shadow: 'false',
      });
    });

    // A backgrounded tab or a Zero reconnect makes the timing meaningless; recording
    // it anyway poisons p95. Mirrors hooks/useLoadingAnimationLog.ts.
    const skewed = wasInterrupted(performance.now() - result.embedMs);
    if (!skewed) {
      safeRecordMetric(() => {
        intentEmbedDuration.record(result.embedMs, base);
      });
      this.checkBudget(result.embedMs);
    }

    trace('main', '6. telemetry recorded', {
      intent_score: Number(result.topScore.toFixed(4)),
      intent_embed_duration: skewed ? 'skipped (skewed)' : Number(result.embedMs.toFixed(1)),
      intent_classification_total: { intent: result.topIntent, triggered: String(triggered) },
    });

    // Always say what happened AND why — a strong score followed by silence reads
    // like a misclassification when it is usually a threshold or a disabled flag.
    trace(
      'main',
      triggered
        ? `7. TRIGGERED — ${result.topScore.toFixed(4)} ≥ ${intent?.threshold}; asking the server`
        : !INTENT_TRIGGER_ENABLED
          ? `7. trigger disabled — score ${result.topScore.toFixed(4)}` +
            `${result.topScore >= CANDIDATE_THRESHOLD ? ' WOULD have fired' : ''}; no server call`
          : result.topIntent === UNCLASSIFIED
            ? `7. unclassified — best was ${result.topScore.toFixed(4)}, under the ` +
              `${MIN_INTENT_SCORE} floor, so no intent claims this. No server call.`
            : !actionable
              ? `7. '${result.topIntent}' is an absorber (actionable: false) — it claimed this ` +
                `at ${result.topScore.toFixed(4)} so no other intent fires. Working as intended.`
              : `7. below threshold — ${result.topScore.toFixed(4)} < ${intent?.threshold ?? '?'}; no server call`,
    );

    // Per-event record for the eval flywheel. Joins to the (future) server verdict on
    // messageId. No message text — see docs/ON_DEVICE_INTENT.md §6.2.
    logger.info(Event.INTENT_CLASSIFIED, {
      messageId,
      topIntent: result.topIntent,
      topScore: result.topScore,
      runnerUpIntent: result.runnerUpIntent,
      runnerUpScore: result.runnerUpScore,
      embedMs: result.embedMs,
      skewed,
      triggered,
      shadow: false,
      modelVersion: MODEL_VERSION,
      prototypesVersion: PROTOTYPES_VERSION,
    });
  }

  /**
   * Ask the server for a rich suggestion. Sends ids and the score only — never
   * the message text, which the server already has and re-reads from its own DB.
   */
  private async requestSuggestion(
    messageId: string,
    intentId: string,
    score: number,
  ): Promise<void> {
    try {
      const res = await apiInstance.post('/intent/suggest', { messageId, intentId, score });
      trace('main', '8. server suggestion requested', res.data);
    } catch (error) {
      // Ambient and additive — a failure here means no card appears, which is
      // exactly what happens today. Never surface it.
      trace('main', '8. server suggestion failed (ignored)', String(error));
    }
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
      logger.warn(Event.INTENT_SELF_DISABLED, { p95, budgetMs: EMBED_BUDGET_MS });
      this.teardown();
    }
  }
}

export const intentClassifier = new IntentClassifier();
