import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldRenderComposerUnfocusedTextPreview } from '@/src/components/input-composer/utils/composer-unfocused-preview-visibility.utils';

describe('shouldRenderComposerUnfocusedTextPreview', () => {
  it('never renders while the input is focused', () => {
    assert.equal(
      shouldRenderComposerUnfocusedTextPreview({
        isInputFocused: true,
        html: '<p>hi</p>',
        text: 'hi',
      }),
      false,
    );
  });

  it('renders when unfocused with plain text and no custom emoji', () => {
    assert.equal(
      shouldRenderComposerUnfocusedTextPreview({
        isInputFocused: false,
        html: '<p>hi</p>',
        text: 'hi',
      }),
      true,
    );
  });

  it('does not render when the text is only whitespace', () => {
    assert.equal(
      shouldRenderComposerUnfocusedTextPreview({
        isInputFocused: false,
        html: '<p>   </p>',
        text: '   ',
      }),
      false,
    );
  });

  it('does not render when the html contains a custom emoji image', () => {
    assert.equal(
      shouldRenderComposerUnfocusedTextPreview({
        isInputFocused: false,
        html: '<p>hi <img data-emoji-id="1" alt=":smile:" /></p>',
        text: 'hi :smile:',
      }),
      false,
    );
  });
});
