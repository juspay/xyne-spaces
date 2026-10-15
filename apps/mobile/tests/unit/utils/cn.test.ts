import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cn } from '@/src/utils/cn';

describe('cn', () => {
  it('joins truthy class values', () => {
    assert.equal(cn('a', 'b'), 'a b');
  });

  it('drops falsy values', () => {
    assert.equal(cn('a', false, null, undefined, '', 'b'), 'a b');
  });

  it('supports conditional object syntax', () => {
    assert.equal(cn('a', { b: true, c: false }), 'a b');
  });

  it('merges conflicting tailwind classes so the last one wins', () => {
    assert.equal(cn('px-2', 'px-4'), 'px-4');
    assert.equal(cn('text-red-500', 'text-blue-500'), 'text-blue-500');
  });
});
