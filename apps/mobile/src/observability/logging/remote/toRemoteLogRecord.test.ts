import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LogEntry } from '../types';
import { toRemoteLogBatch, toRemoteLogRecord } from './toRemoteLogRecord';

const FIXED_TIMESTAMP = '2026-08-14T10:30:00.000Z';

describe('toRemoteLogRecord', () => {
  it('converts an internal entry into a flat remote record', () => {
    const entry: LogEntry = {
      timestamp: FIXED_TIMESTAMP,
      level: 'info',
      event: 'auth.login.succeeded',
      fields: {
        provider: 'google',
        durationMs: 450,
      },
    };

    const record = toRemoteLogRecord(entry);

    assert.deepEqual(record, {
      provider: 'google',
      durationMs: 450,
      schemaVersion: 1,
      timestamp: FIXED_TIMESTAMP,
      level: 'INFO',
      event: 'auth.login.succeeded',
    });
  });

  it('does not allow event fields to overwrite protocol fields', () => {
    const entry: LogEntry = {
      timestamp: FIXED_TIMESTAMP,
      level: 'warn',
      event: 'network.request.retrying',
      fields: {
        schemaVersion: 999,
        timestamp: 'forged-timestamp',
        level: 'forged-level',
        event: 'forged-event',
        attempt: 2,
      },
    };

    const record = toRemoteLogRecord(entry);

    assert.deepEqual(record, {
      attempt: 2,
      schemaVersion: 1,
      timestamp: FIXED_TIMESTAMP,
      level: 'WARN',
      event: 'network.request.retrying',
    });
  });

  it('converts multiple entries while preserving their order', () => {
    const entries: readonly LogEntry[] = [
      {
        timestamp: FIXED_TIMESTAMP,
        level: 'warn',
        event: 'request.retrying',
        fields: {},
      },
      {
        timestamp: FIXED_TIMESTAMP,
        level: 'error',
        event: 'request.failed',
        fields: {},
      },
    ];

    const batch = toRemoteLogBatch(entries);

    assert.deepEqual(
      batch.map(record => ({
        event: record.event,
        level: record.level,
      })),
      [
        {
          event: 'request.retrying',
          level: 'WARN',
        },
        {
          event: 'request.failed',
          level: 'ERROR',
        },
      ],
    );

    assert.doesNotThrow(() => {
      JSON.stringify(batch);
    });
  });
});
