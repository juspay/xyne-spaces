import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldAnimateComposerHeight } from '@/src/features/chat/v2/hooks/chat-composer-geometry';

describe('shouldAnimateComposerHeight', () => {
  it('animates when the keyboard is fully hidden', () => {
    assert.equal(shouldAnimateComposerHeight(false), true);
  });

  it('snaps for the full IME transition (willShow → didHide visibility)', () => {
    assert.equal(shouldAnimateComposerHeight(true), false);
  });

  it('always snaps on geometry reset even if the keyboard is hidden', () => {
    assert.equal(shouldAnimateComposerHeight(false, true), false);
    assert.equal(shouldAnimateComposerHeight(true, true), false);
  });
});
