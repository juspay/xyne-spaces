import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getEmailChainItemPosition,
  getEmailChainBorderRadius,
} from '@/src/features/xyne-desks/detail/utils/get-email-chain-border-radius';
import {
  EMAIL_CHAIN_OUTER_RADIUS,
  EMAIL_CHAIN_INNER_RADIUS,
} from '@/src/features/xyne-desks/detail/constants';

const OUTER = EMAIL_CHAIN_OUTER_RADIUS;
const INNER = EMAIL_CHAIN_INNER_RADIUS;

describe('getEmailChainItemPosition', () => {
  it('treats a lone email as a single card', () => {
    assert.equal(getEmailChainItemPosition(0, 1), 'single');
    assert.equal(getEmailChainItemPosition(0, 0), 'single');
  });

  it('classifies first / middle / last within a chain', () => {
    assert.equal(getEmailChainItemPosition(0, 4), 'first');
    assert.equal(getEmailChainItemPosition(2, 4), 'middle');
    assert.equal(getEmailChainItemPosition(3, 4), 'last');
  });
});

describe('getEmailChainBorderRadius', () => {
  it('rounds every corner for a single card', () => {
    assert.deepEqual(getEmailChainBorderRadius('single'), {
      borderTopLeftRadius: OUTER,
      borderTopRightRadius: OUTER,
      borderBottomLeftRadius: OUTER,
      borderBottomRightRadius: OUTER,
    });
  });

  it('rounds only the outer edge for first and last cards', () => {
    assert.deepEqual(getEmailChainBorderRadius('first'), {
      borderTopLeftRadius: OUTER,
      borderTopRightRadius: OUTER,
      borderBottomLeftRadius: INNER,
      borderBottomRightRadius: INNER,
    });
    assert.deepEqual(getEmailChainBorderRadius('last'), {
      borderTopLeftRadius: INNER,
      borderTopRightRadius: INNER,
      borderBottomLeftRadius: OUTER,
      borderBottomRightRadius: OUTER,
    });
  });

  it('keeps all corners tight for middle cards', () => {
    assert.deepEqual(getEmailChainBorderRadius('middle'), {
      borderTopLeftRadius: INNER,
      borderTopRightRadius: INNER,
      borderBottomLeftRadius: INNER,
      borderBottomRightRadius: INNER,
    });
  });
});
