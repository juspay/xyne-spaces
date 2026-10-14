import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryMetricsRecorder } from '@/src/observability/metrics/InMemoryMetricsRecorder';

describe('InMemoryMetricsRecorder', () => {
  it('records a histogram measurement', () => {
    const recorder = new InMemoryMetricsRecorder();

    recorder.recordHistogram('appStartupDuration', 1450, {
      launch_cause: 'direct',
      destination: 'dms',
      native_anchor: 'app',
    });

    assert.deepEqual(recorder.getRecords(), [
      {
        metric: 'appStartupDuration',
        kind: 'histogram',
        value: 1450,
        attributes: {
          launch_cause: 'direct',
          destination: 'dms',
          native_anchor: 'app',
        },
      },
    ]);
  });

  it('clears records without changing an older snapshot', () => {
    const recorder = new InMemoryMetricsRecorder();

    recorder.recordHistogram('appStartupDuration', 900, {
      launch_cause: 'notification',
      destination: 'dms',
      native_anchor: 'activity',
    });

    const snapshot = recorder.getRecords();

    recorder.clear();

    assert.equal(snapshot.length, 1);
    assert.deepEqual(recorder.getRecords(), []);
  });

  it('records a notification message highlight duration', () => {
    const recorder = new InMemoryMetricsRecorder();

    recorder.recordHistogram('notificationMessageHighlightDuration', 1825, {
      app_state: 'warm',
      surface: 'thread',
      native_anchor: 'app',
    });

    assert.deepEqual(recorder.getRecords(), [
      {
        metric: 'notificationMessageHighlightDuration',
        kind: 'histogram',
        value: 1825,
        attributes: {
          app_state: 'warm',
          surface: 'thread',
          native_anchor: 'app',
        },
      },
    ]);
  });

  it('records a notification header resolve duration', () => {
    const recorder = new InMemoryMetricsRecorder();

    recorder.recordHistogram('notificationHeaderResolveDuration', 240, {
      surface: 'channel',
      native_anchor: 'activity',
    });

    assert.deepEqual(recorder.getRecords(), [
      {
        metric: 'notificationHeaderResolveDuration',
        kind: 'histogram',
        value: 240,
        attributes: {
          surface: 'channel',
          native_anchor: 'activity',
        },
      },
    ]);
  });

  it('records a chat open skeleton duration', () => {
    const recorder = new InMemoryMetricsRecorder();

    recorder.recordHistogram('chatOpenSkeletonDuration', 380, {
      surface: 'channel',
      entry: 'direct',
    });

    assert.deepEqual(recorder.getRecords(), [
      {
        metric: 'chatOpenSkeletonDuration',
        kind: 'histogram',
        value: 380,
        attributes: {
          surface: 'channel',
          entry: 'direct',
        },
      },
    ]);
  });

  it('records zero query latency and operations', () => {
    const recorder = new InMemoryMetricsRecorder();

    recorder.incrementCounter('zeroQueryOperations', {
      query: 'getAllUserGroups',
      stage: 'success',
    });
    recorder.recordHistogram('zeroQueryLatency', 24.5, {
      query: 'getAllUserGroups',
    });

    assert.deepEqual(recorder.getRecords(), [
      {
        metric: 'zeroQueryOperations',
        kind: 'counter',
        value: 1,
        attributes: {
          query: 'getAllUserGroups',
          stage: 'success',
        },
      },
      {
        metric: 'zeroQueryLatency',
        kind: 'histogram',
        value: 24.5,
        attributes: {
          query: 'getAllUserGroups',
        },
      },
    ]);
  });
});
