import { describe, expect, it, jest } from '@jest/globals';

jest.mock('uuid', () => ({ v7: (): string => 'test-session-id' }));

import { createDateSeparatorObservationRecorder } from '@/src/observability/logging/chat/emitChatDateSeparatorObserved';

const validObservation = {
  surface: 'thread-inline' as const,
  phase: 'initial-open' as const,
  channelId: 'channel-1',
  conversationId: 'thread-1',
  boundaryId: 'message-1',
  createdAtMs: 1_760_000_000_000,
  formattedLabel: 'Sunday, 13 September',
  layout: { width: 142, height: 28 },
  screenWidthDp: 390,
  fontScale: 1,
};

describe('chat date separator observation recorder', () => {
  it('keeps one baseline event per surface despite repeated layout callbacks', () => {
    const events: Array<{ level: string; fields: Readonly<Record<string, unknown>> }> = [];
    const recorder = createDateSeparatorObservationRecorder((level, fields) => {
      events.push({ level, fields });
    });

    recorder.record(validObservation);
    recorder.record(validObservation);

    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe('info');
    expect(events[0]?.fields).toMatchObject({
      reason: 'baseline',
      timestampStatus: 'valid-ms',
      labelShape: 'weekday-day-month',
      measurementStatus: 'measured',
    });
  });

  it('records a complete long-date boundary after a relative baseline', () => {
    const events: Array<{ level: string; fields: Readonly<Record<string, unknown>> }> = [];
    const recorder = createDateSeparatorObservationRecorder((level, fields) => {
      events.push({ level, fields });
    });

    recorder.record({
      ...validObservation,
      boundaryId: 'relative-boundary',
      formattedLabel: 'Yesterday',
    });
    recorder.record({
      ...validObservation,
      boundaryId: 'long-date-boundary',
      formattedLabel: 'Sunday, 13 September',
    });

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      level: 'info',
      fields: {
        reason: 'long-date-boundary',
        formattedLabel: 'Sunday, 13 September',
        labelShape: 'weekday-day-month',
      },
    });
  });

  it('retains an incomplete label as a warning for RCA', () => {
    const events: Array<{ level: string; fields: Readonly<Record<string, unknown>> }> = [];
    const recorder = createDateSeparatorObservationRecorder((level, fields) => {
      events.push({ level, fields });
    });

    recorder.record({ ...validObservation, formattedLabel: 'Sunday, 13' });
    recorder.record({ ...validObservation, formattedLabel: 'Sunday, 13' });

    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe('warn');
    expect(events[0]?.fields).toMatchObject({
      reason: 'anomaly',
      labelShape: 'weekday-day-only',
    });
  });

  it('bounds anomaly volume per mounted chat surface', () => {
    const events: Array<{ level: string; fields: Readonly<Record<string, unknown>> }> = [];
    const recorder = createDateSeparatorObservationRecorder((level, fields) => {
      events.push({ level, fields });
    });

    for (let index = 0; index < 9; index += 1) {
      recorder.record({
        ...validObservation,
        boundaryId: `message-${index}`,
        formattedLabel: 'Sunday, 13',
      });
    }

    expect(events).toHaveLength(8);
    expect(events.every(event => event.level === 'warn')).toBe(true);
  });

  it('flags seconds-like timestamps and invalid labels as anomalies', () => {
    const events: Array<{ level: string; fields: Readonly<Record<string, unknown>> }> = [];
    const recorder = createDateSeparatorObservationRecorder((level, fields) => {
      events.push({ level, fields });
    });

    recorder.record({
      ...validObservation,
      createdAtMs: 1_784_300_000,
      formattedLabel: 'Sunday, 13 September',
    });
    recorder.record({
      ...validObservation,
      boundaryId: 'invalid-date',
      createdAtMs: Number.NaN,
      formattedLabel: 'Date unavailable',
    });

    expect(events).toEqual([
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({
          reason: 'anomaly',
          timestampStatus: 'seconds-like',
          labelShape: 'weekday-day-month',
        }),
      }),
      expect.objectContaining({
        level: 'warn',
        fields: expect.objectContaining({
          reason: 'anomaly',
          timestampStatus: 'invalid',
          createdAtMs: null,
          labelShape: 'unavailable',
        }),
      }),
    ]);
  });

  it('allows a new baseline after reset', () => {
    const events: Array<{ level: string; fields: Readonly<Record<string, unknown>> }> = [];
    const recorder = createDateSeparatorObservationRecorder((level, fields) => {
      events.push({ level, fields });
    });

    recorder.record(validObservation);
    recorder.record(validObservation);
    recorder.reset();
    recorder.record(validObservation);

    expect(events).toHaveLength(2);
    expect(events.every(event => event.fields['reason'] === 'baseline')).toBe(true);
  });
});
