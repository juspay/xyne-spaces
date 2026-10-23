import assert from 'node:assert/strict';
import { it } from 'node:test';
import { applyThreadTagEdits } from '@/src/features/chat/thread-header/thread-tag-edits';

it('preserves tags arriving from another client while applying local adds and removals', () => {
  assert.deepEqual(applyThreadTagEdits(['OLD', 'REMOTE'], { OLD: false, NEW: true }), [
    'REMOTE',
    'NEW',
  ]);
});
it('does not resurrect remotely removed tags that the user never edited', () => {
  assert.deepEqual(applyThreadTagEdits([], { NEW: true }), ['NEW']);
});
it('does not duplicate a tag added by another client', () => {
  assert.deepEqual(applyThreadTagEdits(['NEW'], { NEW: true }), ['NEW']);
});
