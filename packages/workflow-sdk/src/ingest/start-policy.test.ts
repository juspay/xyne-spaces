import { describe, it, expect } from 'vitest';
import {
  anchorSource,
  durationMs,
  isDelayedStart,
  MAX_START_DELAY_MS,
  readAnchor,
  resolveStartAt,
  startNeedsPayload,
  startSkipReason,
  TriggerStartSchema,
  type TriggerStart,
} from './start-policy.js';
import type { TriggerEvent } from './types.js';

const NOW = new Date('2026-03-01T10:00:00.000Z');

const event = (occurredAt?: string): TriggerEvent => ({
  type: 'ticket.created',
  payload: { ticketId: 't_1' },
  ...(occurredAt !== undefined ? { occurredAt } : {}),
});

describe('durationMs', () => {
  it('converts each unit', () => {
    expect(durationMs({ amount: 90, unit: 'minutes' })).toBe(5_400_000);
    expect(durationMs({ amount: 2, unit: 'hours' })).toBe(7_200_000);
    expect(durationMs({ amount: 3, unit: 'days' })).toBe(259_200_000);
  });
});

describe('startNeedsPayload', () => {
  it('is true only for an anchor that lives in the payload', () => {
    expect(startNeedsPayload(undefined)).toBe(false);
    expect(startNeedsPayload({ kind: 'immediate' })).toBe(false);
    expect(startNeedsPayload({ kind: 'delay', offset: { amount: 2, unit: 'hours' } })).toBe(false);
    expect(
      startNeedsPayload({ kind: 'at', anchor: '{{trigger.ticket.eta}}', ifPast: 'skip' }),
    ).toBe(true);
    // A workflow variable is a constant the author set — no read needed.
    expect(startNeedsPayload({ kind: 'at', anchor: '{{vars.cutoff}}', ifPast: 'skip' })).toBe(
      false,
    );
  });

  it('knows which bindings wait at all', () => {
    expect(isDelayedStart(undefined)).toBe(false);
    expect(isDelayedStart({ kind: 'immediate' })).toBe(false);
    expect(isDelayedStart({ kind: 'delay', offset: { amount: 1, unit: 'days' } })).toBe(true);
  });
});

describe('resolveStartAt — immediate', () => {
  it('runs now when the binding says nothing', () => {
    expect(resolveStartAt(undefined, event(), {}, NOW)).toEqual({ kind: 'now' });
    expect(resolveStartAt({ kind: 'immediate' }, event(), {}, NOW)).toEqual({ kind: 'now' });
  });
});

describe('resolveStartAt — anchored on the event', () => {
  const start: TriggerStart = { kind: 'delay', offset: { amount: 2, unit: 'hours' } };

  it('fires two hours after the event happened, with no read', () => {
    const decision = resolveStartAt(start, event('2026-03-01T09:30:00.000Z'), {}, NOW);
    expect(decision).toEqual({
      kind: 'at',
      at: new Date('2026-03-01T11:30:00.000Z'),
      anchor: { source: 'event', value: '2026-03-01T09:30:00.000Z' },
    });
  });

  it('treats an event with no clock of its own as having just happened', () => {
    const decision = resolveStartAt(start, event(), {}, NOW);
    expect(decision).toEqual({
      kind: 'at',
      at: new Date('2026-03-01T12:00:00.000Z'),
      anchor: { source: 'event', value: NOW.toISOString() },
    });
  });

  it('runs at once when the wait has already elapsed — a replayed delivery', () => {
    const decision = resolveStartAt(start, event('2026-02-28T09:00:00.000Z'), {}, NOW);
    expect(decision).toEqual({ kind: 'now' });
  });
});

describe('resolveStartAt — anchored on a date the run can read', () => {
  const start: TriggerStart = {
    kind: 'at',
    anchor: '{{trigger.ticket.eta}}',
    offset: { amount: 30, unit: 'minutes', direction: 'after' },
    ifPast: 'skip',
  };

  it('fires relative to the anchor, and says where the time came from', () => {
    const decision = resolveStartAt(start, event(), '2026-03-01T14:00:00.000Z', NOW);
    expect(decision).toEqual({
      kind: 'at',
      at: new Date('2026-03-01T14:30:00.000Z'),
      anchor: { source: 'trigger.ticket.eta', value: '2026-03-01T14:00:00.000Z' },
    });
  });

  it('fires BEFORE the anchor when the offset says so', () => {
    const remind: TriggerStart = {
      kind: 'at',
      anchor: '{{trigger.ticket.dueAt}}',
      offset: { amount: 1, unit: 'days', direction: 'before' },
      ifPast: 'skip',
    };
    const decision = resolveStartAt(remind, event(), '2026-03-05T09:00:00.000Z', NOW);
    expect(decision).toEqual({
      kind: 'at',
      at: new Date('2026-03-04T09:00:00.000Z'),
      anchor: { source: 'trigger.ticket.dueAt', value: '2026-03-05T09:00:00.000Z' },
    });
  });

  it('fires exactly on the anchor when there is no offset', () => {
    const onTime: TriggerStart = { kind: 'at', anchor: '{{trigger.dueAt}}', ifPast: 'skip' };
    const decision = resolveStartAt(onTime, event(), '2026-03-01T16:00:00.000Z', NOW);
    expect(decision).toMatchObject({ kind: 'at', at: new Date('2026-03-01T16:00:00.000Z') });
  });

  it('accepts a date given as an epoch or a Date', () => {
    const at = new Date('2026-03-01T18:00:00.000Z');
    expect(resolveStartAt(start, event(), at.getTime() - 30 * 60_000, NOW)).toMatchObject({
      kind: 'at',
      at,
    });
    expect(
      resolveStartAt(start, event(), new Date(at.getTime() - 30 * 60_000), NOW),
    ).toMatchObject({ kind: 'at', at });
  });

  it('skips when the anchor resolves to nothing', () => {
    expect(resolveStartAt(start, event(), undefined, NOW)).toEqual({
      kind: 'skip',
      reason: 'anchor-missing',
    });
  });

  it('skips when the anchor is not a date', () => {
    expect(resolveStartAt(start, event(), 'soon', NOW)).toEqual({
      kind: 'skip',
      reason: 'anchor-unreadable',
    });
  });

  it('honours ifPast for a time already behind us', () => {
    const past = '2026-02-01T09:00:00.000Z';
    expect(resolveStartAt(start, event(), past, NOW)).toEqual({
      kind: 'skip',
      reason: 'anchor-past',
    });
    expect(resolveStartAt({ ...start, ifPast: 'run' }, event(), past, NOW)).toEqual({
      kind: 'now',
    });
  });

  it('treats a "before" offset that has already elapsed the same way', () => {
    const remind: TriggerStart = {
      kind: 'at',
      anchor: '{{trigger.ticket.dueAt}}',
      offset: { amount: 1, unit: 'days', direction: 'before' },
      ifPast: 'run',
    };
    // Due in two hours, so "a day before" passed yesterday.
    expect(resolveStartAt(remind, event(), '2026-03-01T12:00:00.000Z', NOW)).toEqual({
      kind: 'now',
    });
  });

  it('refuses to park a timer for longer than a month', () => {
    const decision = resolveStartAt(
      { kind: 'at', anchor: '{{trigger.dueAt}}', ifPast: 'skip' },
      event(),
      '2035-01-01T00:00:00.000Z',
      NOW,
    );
    expect(decision).toEqual({ kind: 'skip', reason: 'anchor-too-far' });
  });

  it('accepts a date right at the limit', () => {
    const eta = new Date(NOW.getTime() + MAX_START_DELAY_MS).toISOString();
    const decision = resolveStartAt(
      { kind: 'at', anchor: '{{trigger.dueAt}}', ifPast: 'skip' },
      event(),
      eta,
      NOW,
    );
    expect(decision.kind).toBe('at');
  });
});

describe('resolveStartAt — anchored on a literal time', () => {
  it('needs no reading at all', async () => {
    const start: TriggerStart = {
      kind: 'at',
      anchor: '2026-03-01T16:00:00.000Z',
      ifPast: 'skip',
    };
    expect(startNeedsPayload(start)).toBe(false);
    expect(resolveStartAt(start, event(), await readAnchor(start.anchor, {}, undefined), NOW)).toEqual({
      kind: 'at',
      at: new Date('2026-03-01T16:00:00.000Z'),
      anchor: { source: '2026-03-01T16:00:00.000Z', value: '2026-03-01T16:00:00.000Z' },
    });
  });
});

describe('readAnchor', () => {
  it('reads the trigger payload', async () => {
    const value = await readAnchor('{{trigger.ticket.eta}}', { ticket: { eta: '2026-03-01T14:00:00.000Z' } }, undefined);
    expect(value).toBe('2026-03-01T14:00:00.000Z');
  });

  it('reads a workflow variable', async () => {
    const value = await readAnchor('{{vars.cutoff}}', {}, [
      { key: 'cutoff', type: 'text', value: '2026-03-02T09:00:00.000Z' },
    ]);
    expect(value).toBe('2026-03-02T09:00:00.000Z');
  });

  it('is undefined when the field is not there', async () => {
    expect(await readAnchor('{{trigger.ticket.eta}}', { ticket: {} }, undefined)).toBeUndefined();
  });

  it('passes a literal timestamp straight through', async () => {
    expect(await readAnchor('2026-03-01T16:00:00.000Z', {}, undefined)).toBe('2026-03-01T16:00:00.000Z');
  });

  it('names the path an anchor reads, for display', () => {
    expect(anchorSource('{{trigger.ticket.eta}}')).toBe('trigger.ticket.eta');
    expect(anchorSource('{{context.trigger.ticket.eta}}')).toBe('trigger.ticket.eta');
  });
});

describe('TriggerStartSchema', () => {
  it('accepts the three shapes', () => {
    expect(TriggerStartSchema.safeParse({ kind: 'immediate' }).success).toBe(true);
    expect(
      TriggerStartSchema.safeParse({ kind: 'delay', offset: { amount: 2, unit: 'hours' } }).success,
    ).toBe(true);
    expect(
      TriggerStartSchema.safeParse({
        kind: 'at',
        anchor: '{{trigger.ticket.eta}}',
        ifPast: 'run',
      }).success,
    ).toBe(true);
    expect(
      TriggerStartSchema.safeParse({
        kind: 'at',
        anchor: '{{trigger.ticket.dueAt}}',
        offset: { amount: 1, unit: 'days', direction: 'before' },
        ifPast: 'skip',
      }).success,
    ).toBe(true);
  });

  it('rejects an offset beyond the 30-day cap', () => {
    const parsed = TriggerStartSchema.safeParse({
      kind: 'delay',
      offset: { amount: 60, unit: 'days' },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a fractional or negative offset', () => {
    expect(
      TriggerStartSchema.safeParse({ kind: 'delay', offset: { amount: 1.5, unit: 'hours' } }).success,
    ).toBe(false);
    expect(
      TriggerStartSchema.safeParse({ kind: 'delay', offset: { amount: -2, unit: 'hours' } }).success,
    ).toBe(false);
  });

  it('rejects an "at" policy with no ifPast decision', () => {
    expect(
      TriggerStartSchema.safeParse({ kind: 'at', anchor: '{{trigger.ticket.eta}}' }).success,
    ).toBe(false);
  });

  it('rejects an offset with no side', () => {
    expect(
      TriggerStartSchema.safeParse({
        kind: 'at',
        anchor: '{{trigger.ticket.eta}}',
        offset: { amount: 1, unit: 'days' },
        ifPast: 'skip',
      }).success,
    ).toBe(false);
  });

  it('accepts a literal timestamp as the anchor', () => {
    expect(
      TriggerStartSchema.safeParse({
        kind: 'at',
        anchor: '2026-03-01T14:00:00.000Z',
        ifPast: 'skip',
      }).success,
    ).toBe(true);
    // An offset from the source's own clock is a perfectly ordinary timestamp.
    expect(
      TriggerStartSchema.safeParse({
        kind: 'at',
        anchor: '2026-03-01T19:30:00+05:30',
        ifPast: 'skip',
      }).success,
    ).toBe(true);
  });

  it('rejects an anchor that is neither a time nor a reference', () => {
    expect(
      TriggerStartSchema.safeParse({ kind: 'at', anchor: 'ticket.eta', ifPast: 'skip' }).success,
    ).toBe(false);
    expect(
      TriggerStartSchema.safeParse({ kind: 'at', anchor: 'tomorrow', ifPast: 'skip' }).success,
    ).toBe(false);
  });

  it('rejects an anchor reading something that does not exist before a run', () => {
    expect(
      TriggerStartSchema.safeParse({
        kind: 'at',
        anchor: '{{steps.s1.output.when}}',
        ifPast: 'skip',
      }).success,
    ).toBe(false);
  });
});

describe('startSkipReason', () => {
  it('explains each skip in words a run list can show', () => {
    expect(startSkipReason('anchor-missing')).toMatch(/not set/);
    expect(startSkipReason('anchor-past')).toMatch(/already passed/);
    expect(startSkipReason('anchor-too-far')).toMatch(/30 days/);
  });
});

describe('an anchor that works something out', () => {
  it('assembles a moment from what the event carried', async () => {
    expect(
      await readAnchor('{% trigger.ticket.date & "T09:00:00Z" %}', { ticket: { date: '2026-03-01' } }, undefined),
    ).toBe('2026-03-01T09:00:00Z');
  });

  it('reads nothing when the event did not carry it', async () => {
    expect(await readAnchor('{% trigger.ticket.eta %}', { ticket: {} }, undefined)).toBeUndefined();
  });
});
