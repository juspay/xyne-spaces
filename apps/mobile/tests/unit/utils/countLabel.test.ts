import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatCountLabel } from '@/src/utils/countLabel';

describe('formatCountLabel', () => {
  it('renders small counts verbatim', () => {
    assert.equal(formatCountLabel(0), '0');
    assert.equal(formatCountLabel(1), '1');
    assert.equal(formatCountLabel(42), '42');
  });

  it('renders 99 as the last uncapped value', () => {
    assert.equal(formatCountLabel(99), '99');
  });

  it('caps anything above 99 as "99+"', () => {
    assert.equal(formatCountLabel(100), '99+');
    assert.equal(formatCountLabel(1000), '99+');
  });

  it('always returns a string', () => {
    assert.equal(typeof formatCountLabel(5), 'string');
    assert.equal(typeof formatCountLabel(250), 'string');
  });
});
