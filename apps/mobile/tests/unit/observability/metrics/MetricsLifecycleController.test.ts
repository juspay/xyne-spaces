import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  AppLifecycle,
  AppLifecycleListener,
  AppLifecycleState,
  AppLifecycleSubscription,
} from '@/src/observability/logging/lifecycle/AppLifecycle';
import { MetricsLifecycleController } from '@/src/observability/metrics/MetricsLifecycleController';

class ManualAppLifecycle implements AppLifecycle {
  private readonly listeners = new Set<AppLifecycleListener>();

  currentState: AppLifecycleState;

  constructor(initialState: AppLifecycleState) {
    this.currentState = initialState;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  subscribe(listener: AppLifecycleListener): AppLifecycleSubscription {
    this.listeners.add(listener);

    return {
      remove: (): void => {
        this.listeners.delete(listener);
      },
    };
  }

  moveTo(nextState: AppLifecycleState): void {
    this.currentState = nextState;

    for (const listener of this.listeners) {
      listener(nextState);
    }
  }
}

class RecordingMetricsService {
  startCallCount = 0;
  flushCallCount = 0;
  shutdownCallCount = 0;

  flushFailure: Error | null = null;

  start(): void {
    this.startCallCount += 1;
  }

  forceFlush(): Promise<void> {
    this.flushCallCount += 1;

    if (this.flushFailure !== null) {
      return Promise.reject(this.flushFailure);
    }

    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    this.shutdownCallCount += 1;
    return Promise.resolve();
  }
}

describe('MetricsLifecycleController', () => {
  it('starts the metrics service only once', () => {
    const appLifecycle = new ManualAppLifecycle('foreground');
    const service = new RecordingMetricsService();
    const controller = new MetricsLifecycleController({
      service,
      appLifecycle,
    });

    controller.start();
    controller.start();

    assert.equal(service.startCallCount, 1);
    assert.equal(appLifecycle.listenerCount, 1);
  });

  it('flushes once when the app enters the background', () => {
    const appLifecycle = new ManualAppLifecycle('foreground');
    const service = new RecordingMetricsService();
    const controller = new MetricsLifecycleController({
      service,
      appLifecycle,
    });

    controller.start();

    appLifecycle.moveTo('background');
    appLifecycle.moveTo('background');

    assert.equal(service.flushCallCount, 1);
  });

  it('unsubscribes and shuts down when stopped', () => {
    const appLifecycle = new ManualAppLifecycle('foreground');
    const service = new RecordingMetricsService();
    const controller = new MetricsLifecycleController({
      service,
      appLifecycle,
    });

    controller.start();
    controller.stop();
    controller.stop();

    assert.equal(appLifecycle.listenerCount, 0);
    assert.equal(service.shutdownCallCount, 1);

    appLifecycle.moveTo('background');

    assert.equal(service.flushCallCount, 0);
  });

  it('reports flush failures without throwing', async () => {
    const expectedError = new Error('Network unavailable');
    const reportedErrors: unknown[] = [];

    const appLifecycle = new ManualAppLifecycle('foreground');
    const service = new RecordingMetricsService();

    service.flushFailure = expectedError;

    const controller = new MetricsLifecycleController({
      service,
      appLifecycle,
      onError: error => {
        reportedErrors.push(error);
      },
    });

    controller.start();
    appLifecycle.moveTo('background');

    await Promise.resolve();

    assert.deepEqual(reportedErrors, [expectedError]);
  });
});
