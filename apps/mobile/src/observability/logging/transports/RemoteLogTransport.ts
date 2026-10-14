import type { HttpClient, HttpPostRequest, HttpPostResponse } from '../remote/http/HttpClient';
import { HttpRequestTimeoutError } from '../remote/http/HttpRequestTimeoutError';
import {
  SystemTimeoutScheduler,
  type ScheduledTimeout,
  type TimeoutScheduler,
} from '../remote/http/TimeoutScheduler';
import { BoundedLogQueue } from '../remote/BoundedLogQueue';
import { RemoteLogDeliveryError } from '../remote/RemoteLogDeliveryError';
import { toRemoteLogBatch } from '../remote/toRemoteLogRecord';
import type { LogEntry } from '../types';
import type { StartableLogTransport } from './LogTransport';
import {
  calculateRetryDelayMs,
  DEFAULT_REMOTE_LOG_RETRY_POLICY,
  isRetryableRemoteLogError,
  validateRemoteLogRetryPolicy,
  type RemoteLogRetryPolicy,
} from '../remote/retry/RemoteLogRetryPolicy';
import { SystemSleeper, type Sleeper } from '../remote/retry/Sleeper';
import {
  SystemIntervalScheduler,
  type IntervalScheduler,
  type ScheduledInterval,
} from '../remote/flush/IntervalScheduler';

export const DEFAULT_REMOTE_LOG_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_REMOTE_LOG_FLUSH_INTERVAL_MS = 10_000;

export type RemoteLogTransportOptions = Readonly<{
  endpoint: string;
  httpClient: HttpClient;
  queueCapacity: number;
  maximumBatchSize: number;
  retryPolicy?: RemoteLogRetryPolicy;
  sleeper?: Sleeper;
  random?: () => number;
  requestTimeoutMs?: number;
  timeoutScheduler?: TimeoutScheduler;
  flushIntervalMs?: number;
  intervalScheduler?: IntervalScheduler;
  onBackgroundFlushError?: (error: unknown) => void;
}>;

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export class RemoteLogTransport implements StartableLogTransport {
  readonly name = 'remote';

  private readonly endpoint: string;
  private readonly httpClient: HttpClient;
  private readonly queue: BoundedLogQueue;
  private readonly maximumBatchSize: number;

  private readonly retryPolicy: RemoteLogRetryPolicy;
  private readonly sleeper: Sleeper;
  private readonly random: () => number;

  private readonly requestTimeoutMs: number;
  private readonly timeoutScheduler: TimeoutScheduler;

  private readonly flushIntervalMs: number;
  private readonly intervalScheduler: IntervalScheduler;
  private readonly onBackgroundFlushError: (error: unknown) => void;

  private scheduledFlush: ScheduledInterval | null = null;

  private activeFlushPromise: Promise<void> | null = null;

  constructor(options: RemoteLogTransportOptions) {
    const endpoint = options.endpoint.trim();

    if (endpoint.length === 0) {
      throw new TypeError('Remote log endpoint must not be empty');
    }

    if (!isPositiveInteger(options.queueCapacity)) {
      throw new RangeError('Remote log queue capacity must be a positive integer.');
    }

    if (!isPositiveInteger(options.maximumBatchSize)) {
      throw new RangeError('Remote log batch size must be a positive integer.');
    }

    if (options.maximumBatchSize > options.queueCapacity) {
      throw new RangeError('Remote log batch size must not exceed queue capacity.');
    }

    this.endpoint = endpoint;
    this.httpClient = options.httpClient;
    this.queue = new BoundedLogQueue(options.queueCapacity);
    this.maximumBatchSize = options.maximumBatchSize;

    const retryPolicy = options.retryPolicy ?? DEFAULT_REMOTE_LOG_RETRY_POLICY;

    validateRemoteLogRetryPolicy(retryPolicy);

    this.retryPolicy = retryPolicy;
    this.sleeper = options.sleeper ?? new SystemSleeper();
    this.random = options.random ?? Math.random;

    const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REMOTE_LOG_REQUEST_TIMEOUT_MS;

    if (!isPositiveInteger(requestTimeoutMs)) {
      throw new RangeError('Remote log request timeout must be a positive integer.');
    }

    this.requestTimeoutMs = requestTimeoutMs;
    this.timeoutScheduler = options.timeoutScheduler ?? new SystemTimeoutScheduler();

    const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_REMOTE_LOG_FLUSH_INTERVAL_MS;

    if (!isPositiveInteger(flushIntervalMs)) {
      throw new RangeError('Remote log flush interval must be a positive integer.');
    }

    this.flushIntervalMs = flushIntervalMs;
    this.intervalScheduler = options.intervalScheduler ?? new SystemIntervalScheduler();

    this.onBackgroundFlushError = options.onBackgroundFlushError ?? (() => undefined);
  }

  get pendingEntryCount(): number {
    return this.queue.size;
  }

  get droppedEntryCount(): number {
    return this.queue.droppedEntryCount;
  }

  get isStarted(): boolean {
    return this.scheduledFlush !== null;
  }

  start(): void {
    if (this.scheduledFlush !== null) {
      return;
    }

    this.scheduledFlush = this.intervalScheduler.scheduleRepeating(() => {
      this.requestBackgroundFlush();
    }, this.flushIntervalMs);

    if (this.queue.size >= this.maximumBatchSize) {
      this.requestBackgroundFlush();
    }
  }

  stop(): void {
    this.scheduledFlush?.cancel();
    this.scheduledFlush = null;
  }

  write(entry: LogEntry): void {
    this.queue.enqueue(entry);

    const reachedBatchSize = this.queue.size >= this.maximumBatchSize;

    if (this.isStarted && reachedBatchSize) {
      this.requestBackgroundFlush();
    }
  }

  private requestBackgroundFlush(): void {
    if (this.activeFlushPromise !== null || this.queue.size === 0) {
      return;
    }

    void this.flush().catch((error: unknown) => {
      try {
        this.onBackgroundFlushError(error);
      } catch {
        // Interval diagnostics must not create an unhandled rejection.
      }
    });
  }

  flush(): Promise<void> {
    if (this.activeFlushPromise !== null) {
      return this.activeFlushPromise;
    }

    const flushPromise = this.flushQueuedEntries().finally(() => {
      this.activeFlushPromise = null;
    });

    this.activeFlushPromise = flushPromise;

    return flushPromise;
  }

  private async flushQueuedEntries(): Promise<void> {
    let remainingEntryCount = this.queue.size;

    while (remainingEntryCount > 0) {
      const requestedBatchSize = Math.min(this.maximumBatchSize, remainingEntryCount);
      const entries = this.queue.takeBatch(requestedBatchSize);

      if (entries.length === 0) {
        return;
      }

      try {
        await this.sendBatchWithRetry(entries);
      } catch (error: unknown) {
        this.queue.restoreBatch(entries);
        throw error;
      }

      remainingEntryCount -= entries.length;
    }
  }

  private async sendBatchWithRetry(entries: readonly LogEntry[]): Promise<void> {
    let attemptNumber = 1;

    while (true) {
      try {
        await this.sendBatch(entries);
        return;
      } catch (error: unknown) {
        const reachedMaximumAttempts = attemptNumber >= this.retryPolicy.maximumAttempts;

        if (reachedMaximumAttempts || !isRetryableRemoteLogError(error)) {
          throw error;
        }

        const delayMs = calculateRetryDelayMs(attemptNumber, this.retryPolicy, this.random());

        await this.sleeper.sleep(delayMs);

        attemptNumber += 1;
      }
    }
  }

  private async postWithTimeout(request: HttpPostRequest): Promise<HttpPostResponse> {
    const abortController = new AbortController();

    let scheduledTimeout: ScheduledTimeout | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      scheduledTimeout = this.timeoutScheduler.schedule(() => {
        reject(new HttpRequestTimeoutError(this.requestTimeoutMs));

        abortController.abort();
      }, this.requestTimeoutMs);
    });

    try {
      const requestPromise = this.httpClient.post({
        ...request,
        signal: abortController.signal,
      });

      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      scheduledTimeout?.cancel();
    }
  }

  private async sendBatch(entries: readonly LogEntry[]): Promise<void> {
    const remoteBatch = toRemoteLogBatch(entries);

    const response = await this.postWithTimeout({
      url: this.endpoint,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(remoteBatch),
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new RemoteLogDeliveryError(response.statusCode);
    }
  }
}
