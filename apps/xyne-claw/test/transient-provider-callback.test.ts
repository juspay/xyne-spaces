import { describe, expect, test } from 'vitest';
import { transientProviderCallback } from '../src/transient-provider-callback.js';

describe('transient provider callback status', () => {
  test('structured SDLC-style delivery fails instead of pretending completion', () => {
    expect(transientProviderCallback(true)).toEqual({
      status: 'failed',
      error: 'Model provider stalled or was temporarily unavailable. Retry the run.',
    });
  });

  test('interactive chat keeps its user-visible completion notice', () => {
    expect(transientProviderCallback(false)).toEqual({
      status: 'completed',
      result:
        "⚠️ The model provider was temporarily unavailable and your request couldn't be completed. Please try again in a moment.",
    });
  });
});
