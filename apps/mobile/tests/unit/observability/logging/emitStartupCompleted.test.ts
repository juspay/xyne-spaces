import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_VALID_STARTUP_MS,
  resolveStartupEmitDecision,
} from '@/src/observability/logging/startup/resolveStartupEmitDecision';

describe('resolveStartupEmitDecision', () => {
  it('skips null completions', () => {
    assert.deepEqual(resolveStartupEmitDecision(null), { kind: 'skip' });
  });

  it('drops outlier durations', () => {
    assert.deepEqual(
      resolveStartupEmitDecision({
        durationMs: 152_634,
        launchCause: 'notification',
        destination: 'dms',
        nativeAnchor: 'app',
      }),
      {
        kind: 'dropped',
        payload: {
          durationMs: 152_634,
          launchCause: 'notification',
          destination: 'dms',
          nativeAnchor: 'app',
          reason: 'exceeds_max_valid_duration',
          maxValidMs: MAX_VALID_STARTUP_MS,
        },
      },
    );
  });

  it('accepts plausible durations', () => {
    assert.deepEqual(
      resolveStartupEmitDecision({
        durationMs: 1_450,
        launchCause: 'direct',
        destination: 'dms',
        nativeAnchor: 'activity',
      }),
      {
        kind: 'completed',
        payload: {
          durationMs: 1_450,
          launchCause: 'direct',
          destination: 'dms',
          nativeAnchor: 'activity',
        },
      },
    );
  });

  it('accepts durations at the max valid threshold', () => {
    const decision = resolveStartupEmitDecision({
      durationMs: MAX_VALID_STARTUP_MS,
      launchCause: 'notification',
      destination: 'dms',
      nativeAnchor: 'app',
    });

    assert.equal(decision.kind, 'completed');
  });
});
