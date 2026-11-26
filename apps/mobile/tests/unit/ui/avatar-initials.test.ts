import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialsOf } from '@/src/ui/avatar/avatar.initials';

describe('initialsOf', () => {
  it('takes the first letters of the first two words', () => {
    assert.equal(initialsOf('Ravi Shah'), 'RS');
    assert.equal(initialsOf('ravi kumar shah'), 'RK');
  });

  it('handles one word and blank names', () => {
    assert.equal(initialsOf('Ravi'), 'R');
    assert.equal(initialsOf('   '), '?');
  });
});
