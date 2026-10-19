import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Event } from '@xyne/shared/logger';

import { Logger } from '@/src/observability/logging/Logger';
import type { AppLogEventMap } from '@/src/observability/logging/events';
import { MemoryTransport } from '@/src/observability/logging/transports/MemoryTransport';
import { InMemoryMetricsRecorder } from '@/src/observability/metrics/InMemoryMetricsRecorder';
import { createLotusInstrumentation } from '@/src/observability/zero/createLotusInstrumentation';

const FIXED_TIMESTAMP = '2026-09-03T10:00:00.000Z';

describe('createLotusInstrumentation', () => {
  it('maps shared zero_query_complete latency onto durationMs', () => {
    const memoryTransport = new MemoryTransport();
    const structuredLogger = new Logger<AppLogEventMap>({
      clock: { now: () => new Date(FIXED_TIMESTAMP) },
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });
    const metrics = new InMemoryMetricsRecorder();
    const instrumentation = createLotusInstrumentation({ structuredLogger, metrics });

    instrumentation.logger.info(Event.ZERO_QUERY_COMPLETE, {
      query: 'getAllUserGroups',
      latency: 24.6,
      skewed: false,
      rowCount: 12,
    });

    assert.deepEqual(memoryTransport.getEntries(), [
      {
        timestamp: FIXED_TIMESTAMP,
        level: 'info',
        event: Event.ZERO_QUERY_COMPLETE,
        fields: {
          query: 'getAllUserGroups',
          durationMs: 25,
          skewed: false,
          rowCount: 12,
        },
      },
    ]);
    assert.deepEqual(metrics.getRecords(), []);
  });

  it('records query latency histograms and operation counters', () => {
    const structuredLogger = new Logger<AppLogEventMap>({
      clock: { now: () => new Date(FIXED_TIMESTAMP) },
      minimumLevel: 'debug',
      transports: [new MemoryTransport()],
    });
    const metrics = new InMemoryMetricsRecorder();
    const instrumentation = createLotusInstrumentation({ structuredLogger, metrics });

    instrumentation.metrics.incrementCounter('zero.query.operations', {
      query: 'getAllUserGroups',
      stage: 'success',
    });
    instrumentation.metrics.recordLatency('zero.query.latency', 24.6, {
      query: 'getAllUserGroups',
    });

    assert.deepEqual(metrics.getRecords(), [
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
        value: 24.6,
        attributes: {
          query: 'getAllUserGroups',
        },
      },
    ]);
  });

  it('records mutation metrics under the mutation attribute', () => {
    const structuredLogger = new Logger<AppLogEventMap>({
      clock: { now: () => new Date(FIXED_TIMESTAMP) },
      minimumLevel: 'debug',
      transports: [new MemoryTransport()],
    });
    const metrics = new InMemoryMetricsRecorder();
    const instrumentation = createLotusInstrumentation({ structuredLogger, metrics });

    instrumentation.metrics.incrementCounter('zero.mutation.operations', {
      mutation: 'emailRead.bulkMarkAsRead',
      stage: 'start',
    });
    instrumentation.metrics.recordLatency('zero.mutation.latency', 180, {
      mutation: 'emailRead.bulkMarkAsRead',
    });

    assert.deepEqual(metrics.getRecords(), [
      {
        metric: 'zeroMutationOperations',
        kind: 'counter',
        value: 1,
        attributes: {
          mutation: 'emailRead.bulkMarkAsRead',
          stage: 'start',
        },
      },
      {
        metric: 'zeroMutationLatency',
        kind: 'histogram',
        value: 180,
        attributes: {
          mutation: 'emailRead.bulkMarkAsRead',
        },
      },
    ]);
  });

  it('logs zero_run_complete and still notifies the chat-open profiler', () => {
    const memoryTransport = new MemoryTransport();
    const structuredLogger = new Logger<AppLogEventMap>({
      clock: { now: () => new Date(FIXED_TIMESTAMP) },
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });
    const metrics = new InMemoryMetricsRecorder();
    const profilerMarks: Array<Record<string, unknown>> = [];
    const instrumentation = createLotusInstrumentation({
      structuredLogger,
      metrics,
      onChatOpenZeroRunComplete: fields => {
        profilerMarks.push(fields);
      },
    });

    instrumentation.logger.info(Event.ZERO_RUN_COMPLETE, {
      query: 'channelConversationsPaginatedV3',
      duration: 402.8,
      skewed: false,
    });

    assert.equal(memoryTransport.getEntries()[0]?.event, Event.ZERO_RUN_COMPLETE);
    assert.deepEqual(memoryTransport.getEntries()[0]?.fields, {
      query: 'channelConversationsPaginatedV3',
      duration: 403,
      skewed: false,
    });
    assert.equal(profilerMarks.length, 1);
    assert.equal(profilerMarks[0]?.['query'], 'channelConversationsPaginatedV3');
    assert.equal(profilerMarks[0]?.['durationMs'], 403);
  });

  it('ignores unknown shared events', () => {
    const memoryTransport = new MemoryTransport();
    const structuredLogger = new Logger<AppLogEventMap>({
      clock: { now: () => new Date(FIXED_TIMESTAMP) },
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });
    const metrics = new InMemoryMetricsRecorder();
    const instrumentation = createLotusInstrumentation({ structuredLogger, metrics });

    instrumentation.logger.info(Event.APP_REFRESH, { hit: true });
    instrumentation.logger.warn(Event.FRONTEND_ERROR, { message: 'boom' });
    instrumentation.logger.error(Event.FRONTEND_ERROR, { message: 'boom' });

    assert.deepEqual(memoryTransport.getEntries(), []);
    assert.deepEqual(metrics.getRecords(), []);
  });

  it('routes zero_query_failed to the structured logger', () => {
    const memoryTransport = new MemoryTransport();
    const structuredLogger = new Logger<AppLogEventMap>({
      clock: { now: () => new Date(FIXED_TIMESTAMP) },
      minimumLevel: 'debug',
      transports: [memoryTransport],
    });
    const metrics = new InMemoryMetricsRecorder();
    const instrumentation = createLotusInstrumentation({ structuredLogger, metrics });

    instrumentation.logger.error(Event.ZERO_QUERY_FAILED, {
      query: 'getUserProfile',
      error: 'timeout',
    });

    assert.deepEqual(memoryTransport.getEntries()[0], {
      timestamp: FIXED_TIMESTAMP,
      level: 'error',
      event: Event.ZERO_QUERY_FAILED,
      fields: {
        query: 'getUserProfile',
        error: 'timeout',
      },
    });
  });
});
