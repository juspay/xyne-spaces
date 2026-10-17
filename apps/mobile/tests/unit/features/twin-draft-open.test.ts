import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  consumeTwinDraftOpenSelection,
  peekTwinDraftOpenSelection,
  setTwinDraftOpenSelection,
} from '@/src/features/drafts-sent/twin-draft-open';

describe('twin draft open selection', () => {
  it('stores a pending draft id and consumes it once for the matching thread', () => {
    setTwinDraftOpenSelection(null);
    setTwinDraftOpenSelection({ conversationId: 'thread-1', draftId: 'draft-9' });
    assert.deepEqual(peekTwinDraftOpenSelection(), {
      conversationId: 'thread-1',
      draftId: 'draft-9',
    });
    assert.equal(consumeTwinDraftOpenSelection('thread-2'), null);
    assert.equal(consumeTwinDraftOpenSelection('thread-1'), 'draft-9');
    assert.equal(peekTwinDraftOpenSelection(), null);
    assert.equal(consumeTwinDraftOpenSelection('thread-1'), null);
  });
});
