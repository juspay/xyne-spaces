import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { IntervalScheduler, ScheduledInterval } from '../remote/flush/IntervalScheduler';
import type { HttpClient, HttpPostRequest, HttpPostResponse } from '../remote/http/HttpClient';
import { HttpRequestTimeoutError } from '../remote/http/HttpRequestTimeoutError';
import type { ScheduledTimeout, TimeoutScheduler } from '../remote/http/TimeoutScheduler';
import { RemoteLogDeliveryError } from '../remote/RemoteLogDeliveryError';
import type { LogEntry, LogLevel, NormalizedLogFields } from '../types';
import { RemoteLogTransport } from './RemoteLogTransport';
import type { Sleeper } from '../remote/retry/Sleeper';
import type { RemoteLogRetryPolicy } from '../remote/retry/RemoteLogRetryPolicy';

const ENDPOINT = 'https://example.com/godel/events';
const FIXED_TIMESTAMP = '2026-08-14T10:30:00.000Z';

const TEST_RETRY_POLICY: RemoteLogRetryPolicy = {
  maximumAttempts: 3,
  initialDelayMs: 1_000,
  maximumDelayMs: 30_000,
};

const NO_RETRY_POLICY: RemoteLogRetryPolicy = {
  maximumAttempts: 1,
  initialDelayMs: 1_000,
  maximumDelayMs: 30_000,
};

class RecordingSleeper implements Sleeper {
  readonly requestedDurationsMs: number[] = [];

  sleep(durationMs: number): Promise<void> {
    this.requestedDurationsMs.push(durationMs);
    return Promise.resolve();
  }
}

type ManualTimeoutTask = {
  readonly callback: () => void;
  readonly durationMs: number;
  cancelled: boolean;
};

class ManualTimeoutScheduler implements TimeoutScheduler {
  readonly tasks: ManualTimeoutTask[] = [];

  schedule(callback: () => void, durationMs: number): ScheduledTimeout {
    const task: ManualTimeoutTask = {
      callback,
      durationMs,
      cancelled: false,
    };

    this.tasks.push(task);

    return {
      cancel: () => {
        task.cancelled = true;
      },
    };
  }

  get activeTaskCount(): number {
    return this.tasks.filter(task => !task.cancelled).length;
  }

  fireNextActiveTask(): void {
    const task = this.tasks.find(candidate => !candidate.cancelled);

    assert.ok(task);

    task.callback();
  }
}

type ManualIntervalTask = {
  readonly callback: () => void;
  readonly intervalMs: number;
  cancelled: boolean;
};

class ManualIntervalScheduler implements IntervalScheduler {
  readonly tasks: ManualIntervalTask[] = [];

  scheduleRepeating(callback: () => void, intervalMs: number): ScheduledInterval {
    const task: ManualIntervalTask = {
      callback,
      intervalMs,
      cancelled: false,
    };

    this.tasks.push(task);

    return {
      cancel: () => {
        task.cancelled = true;
      },
    };
  }

  get activeTaskCount(): number {
    return this.tasks.filter(task => !task.cancelled).length;
  }

  fireActiveTasks(): void {
    for (const task of this.tasks) {
      if (!task.cancelled) {
        task.callback();
      }
    }
  }
}

function createEntry(
  event: string,
  level: LogLevel = 'info',
  fields: NormalizedLogFields = {},
): LogEntry {
  return {
    timestamp: FIXED_TIMESTAMP,
    level,
    event,
    fields,
  };
}

class StubHttpClient implements HttpClient {
  readonly requests: HttpPostRequest[] = [];
  readonly queuedStatusCodes: number[] = [];

  statusCode = 200;

  post(request: HttpPostRequest): Promise<HttpPostResponse> {
    this.requests.push(request);

    const statusCode = this.queuedStatusCodes.shift() ?? this.statusCode;

    return Promise.resolve({
      statusCode,
    });
  }
}

class DeferredHttpClient implements HttpClient {
  readonly requests: HttpPostRequest[] = [];

  private resolveResponse: ((response: HttpPostResponse) => void) | null = null;

  post(request: HttpPostRequest): Promise<HttpPostResponse> {
    this.requests.push(request);

    return new Promise(resolve => {
      this.resolveResponse = resolve;
    });
  }

  respond(statusCode: number): void {
    const resolveResponse = this.resolveResponse;

    assert.ok(resolveResponse);

    this.resolveResponse = null;
    resolveResponse({ statusCode });
  }
}

class HangingHttpClient implements HttpClient {
  readonly requests: HttpPostRequest[] = [];

  post(request: HttpPostRequest): Promise<HttpPostResponse> {
    this.requests.push(request);

    return new Promise<HttpPostResponse>(() => {
      // Intentionally never resolves or rejects.
    });
  }
}

describe('RemoteLogTransport', () => {
  it('queues entries synchronously and sends them when flushed', async () => {
    const httpClient = new StubHttpClient();

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 10,
    });

    transport.write(
      createEntry('auth.login.succeeded', 'info', {
        provider: 'google',
        durationMs: 450,
      }),
    );

    transport.write(createEntry('request.failed', 'error'));

    assert.equal(httpClient.requests.length, 0);
    assert.equal(transport.pendingEntryCount, 2);

    await transport.flush();

    assert.equal(httpClient.requests.length, 1);
    assert.equal(transport.pendingEntryCount, 0);

    const [request] = httpClient.requests;

    assert.ok(request);
    assert.equal(request.url, ENDPOINT);

    assert.deepEqual(request.headers, {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });

    assert.deepEqual(JSON.parse(request.body) as unknown, [
      {
        provider: 'google',
        durationMs: 450,
        schemaVersion: 1,
        timestamp: FIXED_TIMESTAMP,
        level: 'INFO',
        event: 'auth.login.succeeded',
      },
      {
        schemaVersion: 1,
        timestamp: FIXED_TIMESTAMP,
        level: 'ERROR',
        event: 'request.failed',
      },
    ]);
  });

  it('splits queued entries into multiple requests', async () => {
    const httpClient = new StubHttpClient();

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 2,
    });

    transport.write(createEntry('first'));
    transport.write(createEntry('second'));
    transport.write(createEntry('third'));
    transport.write(createEntry('fourth'));
    transport.write(createEntry('fifth'));

    await transport.flush();

    assert.equal(httpClient.requests.length, 3);

    const requestBodies = httpClient.requests.map(request => JSON.parse(request.body) as unknown);

    assert.deepEqual(requestBodies, [
      [
        {
          schemaVersion: 1,
          timestamp: FIXED_TIMESTAMP,
          level: 'INFO',
          event: 'first',
        },
        {
          schemaVersion: 1,
          timestamp: FIXED_TIMESTAMP,
          level: 'INFO',
          event: 'second',
        },
      ],
      [
        {
          schemaVersion: 1,
          timestamp: FIXED_TIMESTAMP,
          level: 'INFO',
          event: 'third',
        },
        {
          schemaVersion: 1,
          timestamp: FIXED_TIMESTAMP,
          level: 'INFO',
          event: 'fourth',
        },
      ],
      [
        {
          schemaVersion: 1,
          timestamp: FIXED_TIMESTAMP,
          level: 'INFO',
          event: 'fifth',
        },
      ],
    ]);
  });

  it('restores a batch when the server rejects it', async () => {
    const httpClient = new StubHttpClient();

    httpClient.statusCode = 400;

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 10,
    });

    transport.write(createEntry('request.failed', 'error'));

    await assert.rejects(
      () => transport.flush(),
      (error: unknown) => {
        assert.ok(error instanceof RemoteLogDeliveryError);
        assert.equal(error.statusCode, 400);
        return true;
      },
    );

    assert.equal(transport.pendingEntryCount, 1);
    assert.equal(httpClient.requests.length, 1);

    httpClient.statusCode = 200;

    await transport.flush();

    assert.equal(httpClient.requests.length, 2);
    assert.equal(transport.pendingEntryCount, 0);
  });

  it('shares one active flush between concurrent callers', async () => {
    const httpClient = new DeferredHttpClient();

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 10,
    });

    transport.write(createEntry('request.started'));

    const firstFlush = transport.flush();
    const secondFlush = transport.flush();

    assert.equal(firstFlush, secondFlush);
    assert.equal(httpClient.requests.length, 1);

    httpClient.respond(200);

    await Promise.all([firstFlush, secondFlush]);

    assert.equal(transport.pendingEntryCount, 0);
  });

  it('retries temporary failures and succeeds within the attempt limit', async () => {
    const httpClient = new StubHttpClient();
    const sleeper = new RecordingSleeper();

    httpClient.queuedStatusCodes.push(500, 429, 200);

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 10,
      retryPolicy: TEST_RETRY_POLICY,
      sleeper,
      random: () => 1,
    });

    transport.write(createEntry('request.failed', 'error'));

    await transport.flush();

    assert.equal(httpClient.requests.length, 3);
    assert.deepEqual(sleeper.requestedDurationsMs, [1_000, 2_000]);
    assert.equal(transport.pendingEntryCount, 0);
  });

  it('restores the batch after all temporary-failure attempts are exhausted', async () => {
    const httpClient = new StubHttpClient();
    const sleeper = new RecordingSleeper();

    httpClient.statusCode = 503;

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 10,
      retryPolicy: TEST_RETRY_POLICY,
      sleeper,
      random: () => 1,
    });

    transport.write(createEntry('request.failed', 'error'));

    await assert.rejects(() => transport.flush(), RemoteLogDeliveryError);

    assert.equal(httpClient.requests.length, 3);
    assert.deepEqual(sleeper.requestedDurationsMs, [1_000, 2_000]);
    assert.equal(transport.pendingEntryCount, 1);
  });

  it('aborts and restores a batch when the request times out', async () => {
    const httpClient = new HangingHttpClient();
    const timeoutScheduler = new ManualTimeoutScheduler();

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 10,
      retryPolicy: NO_RETRY_POLICY,
      requestTimeoutMs: 5_000,
      timeoutScheduler,
    });

    transport.write(createEntry('request.started'));

    const flushPromise = transport.flush();

    assert.equal(httpClient.requests.length, 1);
    assert.equal(timeoutScheduler.activeTaskCount, 1);

    const [request] = httpClient.requests;

    assert.ok(request);
    assert.equal(request.signal?.aborted, false);

    timeoutScheduler.fireNextActiveTask();

    await assert.rejects(
      () => flushPromise,
      (error: unknown) => {
        assert.ok(error instanceof HttpRequestTimeoutError);
        assert.equal(error.timeoutMs, 5_000);
        return true;
      },
    );

    assert.equal(request.signal?.aborted, true);
    assert.equal(timeoutScheduler.activeTaskCount, 0);
    assert.equal(transport.pendingEntryCount, 1);
  });

  it('cancels the timeout after a successful request', async () => {
    const httpClient = new StubHttpClient();
    const timeoutScheduler = new ManualTimeoutScheduler();

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 10,
      requestTimeoutMs: 5_000,
      timeoutScheduler,
    });

    transport.write(createEntry('request.started'));

    await transport.flush();

    assert.equal(httpClient.requests.length, 1);
    assert.equal(timeoutScheduler.tasks.length, 1);
    assert.equal(timeoutScheduler.activeTaskCount, 0);
    assert.equal(transport.pendingEntryCount, 0);
  });

  it('periodically flushes a partially filled queue after start', async () => {
    const httpClient = new StubHttpClient();
    const intervalScheduler = new ManualIntervalScheduler();
    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 10,
      flushIntervalMs: 5_000,
      intervalScheduler,
    });

    transport.start();
    transport.start();

    assert.equal(transport.isStarted, true);
    assert.equal(intervalScheduler.activeTaskCount, 1);

    transport.write(createEntry('first'));

    assert.equal(httpClient.requests.length, 0);

    intervalScheduler.fireActiveTasks();
    await transport.flush();

    assert.equal(httpClient.requests.length, 1);
    assert.equal(transport.pendingEntryCount, 0);

    const [scheduledTask] = intervalScheduler.tasks;

    assert.ok(scheduledTask);
    assert.equal(scheduledTask.intervalMs, 5_000);

    transport.stop();
  });

  it('flushes immediately when the queue reaches the maximum batch size', async () => {
    const httpClient = new StubHttpClient();
    const intervalScheduler = new ManualIntervalScheduler();
    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 2,
      intervalScheduler,
    });

    transport.start();

    transport.write(createEntry('first'));

    assert.equal(httpClient.requests.length, 0);

    transport.write(createEntry('second'));
    await transport.flush();

    assert.equal(httpClient.requests.length, 1);
    assert.equal(transport.pendingEntryCount, 0);

    transport.stop();
  });

  it('stops automatic flushing without disabling manual flushes', async () => {
    const httpClient = new StubHttpClient();
    const intervalScheduler = new ManualIntervalScheduler();
    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 1,
      intervalScheduler,
    });

    transport.start();
    transport.stop();

    assert.equal(transport.isStarted, false);
    assert.equal(intervalScheduler.activeTaskCount, 0);

    transport.write(createEntry('first'));
    intervalScheduler.fireActiveTasks();

    assert.equal(httpClient.requests.length, 0);
    assert.equal(transport.pendingEntryCount, 1);

    await transport.flush();

    assert.equal(httpClient.requests.length, 1);
    assert.equal(transport.pendingEntryCount, 0);
  });

  it('reports automatic flush failures without leaving an unhandled rejection', async () => {
    const httpClient = new StubHttpClient();
    const intervalScheduler = new ManualIntervalScheduler();
    const backgroundErrors: unknown[] = [];

    httpClient.statusCode = 400;

    const transport = new RemoteLogTransport({
      endpoint: ENDPOINT,
      httpClient,
      queueCapacity: 10,
      maximumBatchSize: 1,
      retryPolicy: NO_RETRY_POLICY,
      intervalScheduler,
      onBackgroundFlushError: error => {
        backgroundErrors.push(error);
      },
    });

    transport.start();
    transport.write(createEntry('first'));

    await assert.rejects(() => transport.flush(), RemoteLogDeliveryError);
    await Promise.resolve();

    assert.equal(backgroundErrors.length, 1);
    assert.equal(transport.pendingEntryCount, 1);

    transport.stop();
  });
});
