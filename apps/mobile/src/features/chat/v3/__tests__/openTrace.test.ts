import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  heightViolationFor,
  isVisibleHeightViolation,
  recordHeightViolation,
  takeHeightViolation,
} from '../observability/heightViolation';
import {
  OPEN_TRACE_PRODUCTION_SAMPLE_RATE,
  createOpenTrace,
  recordInbound,
  recordOutcome,
  recordTransition,
  recordWarmDecision,
  shouldSampleOpenTrace,
  summarizeOpenTrace,
} from '../observability/openTrace';
import {
  EMPTY_WARM_TELEMETRY,
  recordLiveSupersede,
  recordStoreBytes,
  recordWarmRead,
} from '../observability/warmTelemetry';

describe('shouldSampleOpenTrace', (): void => {
  it('always samples dev and beta, and only a small production slice otherwise', (): void => {
    assert.equal(OPEN_TRACE_PRODUCTION_SAMPLE_RATE, 0.02);
    assert.equal(
      shouldSampleOpenTrace({ isDev: true, isBetaUser: false, random: (): number => 1 }),
      true,
    );
    assert.equal(
      shouldSampleOpenTrace({ isDev: false, isBetaUser: true, random: (): number => 1 }),
      true,
    );
    assert.equal(
      shouldSampleOpenTrace({ isDev: false, isBetaUser: false, random: (): number => 0.01 }),
      true,
    );
    assert.equal(
      shouldSampleOpenTrace({ isDev: false, isBetaUser: false, random: (): number => 0.5 }),
      false,
    );
  });
});

describe('openTrace', (): void => {
  it('records enough to answer why a screen was blank without a repro', (): void => {
    let trace = createOpenTrace({
      intentKey: 'thread:ch-1:th-1',
      entry: 'notification',
      isColdStart: true,
      raw: { channelId: 'ch-1', threadId: 'th-1', messageId: 'm-9' },
      sampled: true,
    });
    trace = recordWarmDecision(trace, {
      containsTarget: false,
      fingerprint: '',
      ageMs: 0,
      at: 10,
    });
    trace = recordTransition(trace, 'resolving', 'loading', 'warmWindowRead', 11);
    trace = recordInbound(trace, 'zero-disconnect', 12);
    trace = recordOutcome(trace, 'error', 6011, { reason: 'timeout', stage: 'loading' });
    const summary = summarizeOpenTrace(trace);
    assert.equal(/intentKey=thread:ch-1:th-1/.test(summary), true);
    assert.equal(/entry=notification/.test(summary), true);
    assert.equal(/cold=true/.test(summary), true);
    assert.equal(/m-9/.test(summary), true);
    assert.equal(/containsTarget=false/.test(summary), true);
    assert.equal(/resolving->loading\(warmWindowRead\)/.test(summary), true);
    assert.equal(/timeout/.test(summary), true);
    assert.equal(
      trace.events.some(event => event.kind === 'inbound'),
      true,
    );
  });

  it('does not store events when the open is not sampled', (): void => {
    const quiet = createOpenTrace({
      intentKey: 'channel:ch-1',
      entry: 'tap',
      isColdStart: false,
      raw: {},
      sampled: false,
    });
    const next = recordTransition(quiet, 'resolving', 'placing', 'warmWindowRead', 1);
    assert.equal(next.events.length, 0);
  });
});

describe('heightViolation', (): void => {
  it('flags a size change only for an already-visible row', (): void => {
    const visible = new Set(['row-1']);
    const previous = new Map([
      ['row-1', 72],
      ['row-2', 80],
    ]);
    assert.equal(isVisibleHeightViolation('row-1', 90, visible, previous), true);
    assert.equal(isVisibleHeightViolation('row-2', 90, visible, previous), false);
    assert.equal(isVisibleHeightViolation('row-1', 72, visible, previous), false);
    assert.deepEqual(heightViolationFor('row-1', 90, visible, previous), {
      itemId: 'row-1',
      previousSize: 72,
      nextSize: 90,
    });
    recordHeightViolation(heightViolationFor('row-1', 90, visible, previous));
    assert.deepEqual(takeHeightViolation(), { itemId: 'row-1', previousSize: 72, nextSize: 90 });
    assert.equal(takeHeightViolation(), null);
  });
});

describe('warmTelemetry', (): void => {
  it('counts hits, stale hits, misses, live supersedes, and store size', (): void => {
    let stats = recordWarmRead(EMPTY_WARM_TELEMETRY, { containsTarget: true, ageMs: 1_000 });
    stats = recordWarmRead(stats, { containsTarget: true, ageMs: 40_000 });
    stats = recordWarmRead(stats, { containsTarget: false, ageMs: 0 });
    stats = recordLiveSupersede(stats);
    stats = recordStoreBytes(stats, 12_000);
    assert.equal(stats.reads, 3);
    assert.equal(stats.hits, 2);
    assert.equal(stats.staleHits, 1);
    assert.equal(stats.misses, 1);
    assert.equal(stats.liveSupersedes, 1);
    assert.equal(stats.lastStoreBytes, 12_000);
  });
});
