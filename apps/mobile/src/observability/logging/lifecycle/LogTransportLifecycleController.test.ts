import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LogEntry } from '../types';
import type { StartableLogTransport } from '../transports/LogTransport';
import type {
  AppLifecycle,
  AppLifecycleListener,
  AppLifecycleState,
  AppLifecycleSubscription,
} from './AppLifecycle';
import { LogTransportLifecycleController } from './LogTransportLifecycleController';

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

class RecordingStartableLogTransport implements StartableLogTransport {
  readonly name = 'recording';

  readonly writtenEntries: LogEntry[] = [];

  startCallCount = 0;
  stopCallCount = 0;
  flushCallCount = 0;

  flushFailure: Error | null = null;

  write(entry: LogEntry): void {
    this.writtenEntries.push(entry);
  }

  start(): void {
    this.startCallCount += 1;
  }

  stop(): void {
    this.stopCallCount += 1;
  }

  flush(): Promise<void> {
    this.flushCallCount += 1;

    if (this.flushFailure !== null) {
      return Promise.reject(this.flushFailure);
    }

    return Promise.resolve();
  }
}

describe('LogTransportLifecycleController', () => {
  it('starts the transport once when started in the foreground', () => {
    const appLifecycle = new ManualAppLifecycle('foreground');
    const transport = new RecordingStartableLogTransport();
    const controller = new LogTransportLifecycleController({
      transport,
      appLifecycle,
    });

    controller.start();
    controller.start();

    assert.equal(transport.startCallCount, 1);
    assert.equal(transport.stopCallCount, 0);
    assert.equal(transport.flushCallCount, 0);
    assert.equal(appLifecycle.listenerCount, 1);
  });

  it('stops and flushes when the app enters the background', () => {
    const appLifecycle = new ManualAppLifecycle('foreground');
    const transport = new RecordingStartableLogTransport();
    const controller = new LogTransportLifecycleController({
      transport,
      appLifecycle,
    });

    controller.start();
    appLifecycle.moveTo('background');

    assert.equal(transport.startCallCount, 1);
    assert.equal(transport.stopCallCount, 1);
    assert.equal(transport.flushCallCount, 1);
  });

  it('ignores repeated lifecycle states and restarts in the foreground', () => {
    const appLifecycle = new ManualAppLifecycle('foreground');
    const transport = new RecordingStartableLogTransport();
    const controller = new LogTransportLifecycleController({
      transport,
      appLifecycle,
    });

    controller.start();

    appLifecycle.moveTo('background');
    appLifecycle.moveTo('background');
    appLifecycle.moveTo('foreground');

    assert.equal(transport.startCallCount, 2);
    assert.equal(transport.stopCallCount, 1);
    assert.equal(transport.flushCallCount, 1);
  });

  it('handles being started while the app is already backgrounded', () => {
    const appLifecycle = new ManualAppLifecycle('background');
    const transport = new RecordingStartableLogTransport();
    const controller = new LogTransportLifecycleController({
      transport,
      appLifecycle,
    });

    controller.start();

    assert.equal(transport.startCallCount, 0);
    assert.equal(transport.stopCallCount, 1);
    assert.equal(transport.flushCallCount, 1);
    assert.equal(appLifecycle.listenerCount, 1);
  });

  it('unsubscribes, stops, and flushes when the controller stops', () => {
    const appLifecycle = new ManualAppLifecycle('foreground');
    const transport = new RecordingStartableLogTransport();
    const controller = new LogTransportLifecycleController({
      transport,
      appLifecycle,
    });

    controller.start();
    controller.stop();
    controller.stop();

    assert.equal(appLifecycle.listenerCount, 0);
    assert.equal(transport.startCallCount, 1);
    assert.equal(transport.stopCallCount, 1);
    assert.equal(transport.flushCallCount, 1);

    appLifecycle.moveTo('background');

    assert.equal(transport.stopCallCount, 1);
    assert.equal(transport.flushCallCount, 1);
  });

  it('reports lifecycle flush failures safely', async () => {
    const expectedError = new Error('Network unavailable');
    const reportedErrors: unknown[] = [];

    const appLifecycle = new ManualAppLifecycle('foreground');
    const transport = new RecordingStartableLogTransport();

    transport.flushFailure = expectedError;

    const controller = new LogTransportLifecycleController({
      transport,
      appLifecycle,
      onFlushError: (error): void => {
        reportedErrors.push(error);
      },
    });

    controller.start();
    appLifecycle.moveTo('background');

    await Promise.resolve();

    assert.equal(reportedErrors.length, 1);
    assert.equal(reportedErrors[0], expectedError);
  });
});
