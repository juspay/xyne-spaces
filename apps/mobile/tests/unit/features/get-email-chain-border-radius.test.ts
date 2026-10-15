import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getEmailChainItemPosition,
  getEmailChainBorderRadius,
} from '@/src/features/xyne-desks/detail/utils/get-email-chain-border-radius';

const OUTER = 12;
const INNER = 3;

describe('getEmailChainItemPosition', () => {
  it('returns "single" for a one-message chain', () => {
    assert.equal(getEmailChainItemPosition(0, 1), 'single');
  });

  it('returns "single" for an empty/degenerate total', () => {
    assert.equal(getEmailChainItemPosition(0, 0), 'single');
  });

  it('classifies first / middle / last within a 3-message chain', () => {
    assert.equal(getEmailChainItemPosition(0, 3), 'first');
    assert.equal(getEmailChainItemPosition(1, 3), 'middle');
    assert.equal(getEmailChainItemPosition(2, 3), 'last');
  });
});

describe('getEmailChainBorderRadius', () => {
  it('rounds all four corners with the outer radius for "single"', () => {
    assert.deepEqual(getEmailChainBorderRadius('single'), {
      borderTopLeftRadius: OUTER,
      borderTopRightRadius: OUTER,
      borderBottomLeftRadius: OUTER,
      borderBottomRightRadius: OUTER,
    });
  });

  it('rounds the top outer and bottom inner for "first"', () => {
    assert.deepEqual(getEmailChainBorderRadius('first'), {
      borderTopLeftRadius: OUTER,
      borderTopRightRadius: OUTER,
      borderBottomLeftRadius: INNER,
      borderBottomRightRadius: INNER,
    });
  });

  it('uses inner radius on all corners for "middle"', () => {
    assert.deepEqual(getEmailChainBorderRadius('middle'), {
      borderTopLeftRadius: INNER,
      borderTopRightRadius: INNER,
      borderBottomLeftRadius: INNER,
      borderBottomRightRadius: INNER,
    });
  });

  it('rounds the top inner and bottom outer for "last"', () => {
    assert.deepEqual(getEmailChainBorderRadius('last'), {
      borderTopLeftRadius: INNER,
      borderTopRightRadius: INNER,
      borderBottomLeftRadius: OUTER,
      borderBottomRightRadius: OUTER,
    });
  });
});
