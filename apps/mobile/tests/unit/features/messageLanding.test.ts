import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isMeasuredRowVisible } from '@/src/features/chat/v2/landing/messageLanding';

const state = {
  scroll: 100,
  scrollLength: 500,
  start: 2,
  end: 8,
  positionByKey: (key: string): number | undefined => (key === 'target' ? 220 : undefined),
  sizeAtIndex: (index: number): number | undefined => (index === 4 ? 80 : undefined),
};

describe('isMeasuredRowVisible', (): void => {
  it('requires the target key to be measured inside the render window and viewport', (): void => {
    assert.equal(
      isMeasuredRowVisible({
        state,
        key: 'target',
        index: 4,
        readableTop: 12,
        readableBottom: state.scrollLength,
      }),
      true,
    );
  });

  it('does not treat a target covered by the composer as landed', (): void => {
    assert.equal(
      isMeasuredRowVisible({
        state,
        key: 'target',
        index: 4,
        readableTop: 12,
        readableBottom: 180,
      }),
      false,
    );
  });

  it('does not treat an unmeasured or off-window target as landed', (): void => {
    assert.equal(
      isMeasuredRowVisible({
        state,
        key: 'missing',
        index: 4,
        readableTop: 12,
        readableBottom: state.scrollLength,
      }),
      false,
    );
    assert.equal(
      isMeasuredRowVisible({
        state,
        key: 'target',
        index: 1,
        readableTop: 12,
        readableBottom: state.scrollLength,
      }),
      false,
    );
  });
});
