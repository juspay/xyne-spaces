import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  AppLifecycle,
  AppLifecycleListener,
  AppLifecycleState,
  AppLifecycleSubscription,
} from '@/src/observability/logging/lifecycle/AppLifecycle';
import {
  AppHeartbeatController,
  type HeartbeatScheduler,
  type ScheduledHeartbeat,
} from '@/src/observability/metrics/AppHeartbeatController';
import { InMemoryMetricsRecorder } from '@/src/observability/metrics/InMemoryMetricsRecorder';

class ManualAppLifecycle implements AppLifecycle {
  private readonly listeners = new Set<AppLifecycleListener>();

  constructor(public currentState: AppLifecycleState) {}

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

class ManualHeartbeatScheduler implements HeartbeatScheduler {
  private callback: (() => void) | null = null;

  scheduledIntervalMs: number | null = null;
  cancelCallCount = 0;

  scheduleRepeating(callback: () => void, intervalMs: number): ScheduledHeartbeat {
    this.callback = callback;
    this.scheduledIntervalMs = intervalMs;

    return {
      cancel: (): void => {
        this.callback = null;
        this.cancelCallCount += 1;
      },
    };
  }

  tick(): void {
    this.callback?.();
  }
}

describe('AppHeartbeatController', () => {
  it('records immediately and then on each foreground interval', () => {
    const recorder = new InMemoryMetricsRecorder();
    const lifecycle = new ManualAppLifecycle('foreground');
    const scheduler = new ManualHeartbeatScheduler();
    const controller = new AppHeartbeatController({
      recorder,
      appLifecycle: lifecycle,
      sessionId: 'session-1',
      scheduler,
      intervalMs: 30_000,
    });

    controller.start();
    scheduler.tick();
    scheduler.tick();

    assert.equal(scheduler.scheduledIntervalMs, 30_000);
    assert.deepEqual(
      recorder.getRecords().map(record => record.metric),
      ['appSessionHeartbeat', 'appSessionHeartbeat', 'appSessionHeartbeat'],
    );
    assert.deepEqual(recorder.getRecords()[0]?.attributes, {
      session_id: 'session-1',
    });
  });

  it('stops in the background and restarts on the next foreground', () => {
    const recorder = new InMemoryMetricsRecorder();
    const lifecycle = new ManualAppLifecycle('foreground');
    const scheduler = new ManualHeartbeatScheduler();
    const controller = new AppHeartbeatController({
      recorder,
      appLifecycle: lifecycle,
      sessionId: 'session-1',
      scheduler,
    });

    controller.start();
    lifecycle.moveTo('background');
    scheduler.tick();

    assert.equal(recorder.getRecords().length, 1);
    assert.equal(scheduler.cancelCallCount, 1);

    lifecycle.moveTo('foreground');

    assert.equal(recorder.getRecords().length, 2);
  });

  it('does not record until an initially backgrounded app enters the foreground', () => {
    const recorder = new InMemoryMetricsRecorder();
    const lifecycle = new ManualAppLifecycle('background');
    const scheduler = new ManualHeartbeatScheduler();
    const controller = new AppHeartbeatController({
      recorder,
      appLifecycle: lifecycle,
      sessionId: 'session-1',
      scheduler,
    });

    controller.start();

    assert.equal(recorder.getRecords().length, 0);

    lifecycle.moveTo('foreground');

    assert.equal(recorder.getRecords().length, 1);
  });

  it('cancels future heartbeats when stopped', () => {
    const recorder = new InMemoryMetricsRecorder();
    const lifecycle = new ManualAppLifecycle('foreground');
    const scheduler = new ManualHeartbeatScheduler();
    const controller = new AppHeartbeatController({
      recorder,
      appLifecycle: lifecycle,
      sessionId: 'session-1',
      scheduler,
    });

    controller.start();
    controller.stop();
    scheduler.tick();
    lifecycle.moveTo('foreground');

    assert.equal(recorder.getRecords().length, 1);
    assert.equal(scheduler.cancelCallCount, 1);
  });
});
