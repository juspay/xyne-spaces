import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isOlderPageShimmerVisible } from '../list/useOlderPageShimmer';

describe('isOlderPageShimmerVisible', (): void => {
  it('is off while idle', (): void => {
    assert.equal(isOlderPageShimmerVisible(undefined, 'row-1', false), false);
  });

  it('is on while waiting for the same oldest row', (): void => {
    assert.equal(isOlderPageShimmerVisible('row-1', 'row-1', false), true);
  });

  it('turns off when older rows prepend or history starts', (): void => {
    assert.equal(isOlderPageShimmerVisible('row-1', 'row-0', false), false);
    assert.equal(isOlderPageShimmerVisible('row-1', 'row-1', true), false);
  });
});
