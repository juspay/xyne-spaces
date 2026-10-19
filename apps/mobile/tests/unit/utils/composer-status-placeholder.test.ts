import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldShowComposerStatusPlaceholder } from '@/src/components/input-composer/utils/composer-status-placeholder.utils';

describe('shouldShowComposerStatusPlaceholder', () => {
  it('shows status in an empty unfocused composer', () => {
    assert.equal(
      shouldShowComposerStatusPlaceholder({
        hasStatusEmoji: true,
        isInputFocused: false,
        hasDraft: false,
      }),
      true,
    );
  });

  it('hides status when a draft is present', () => {
    assert.equal(
      shouldShowComposerStatusPlaceholder({
        hasStatusEmoji: true,
        isInputFocused: false,
        hasDraft: true,
      }),
      false,
    );
  });

  it('hides status while the field is focused', () => {
    assert.equal(
      shouldShowComposerStatusPlaceholder({
        hasStatusEmoji: true,
        isInputFocused: true,
        hasDraft: false,
      }),
      false,
    );
  });

  it('hides when the peer has no status', () => {
    assert.equal(
      shouldShowComposerStatusPlaceholder({
        hasStatusEmoji: false,
        isInputFocused: false,
        hasDraft: false,
      }),
      false,
    );
  });
});
