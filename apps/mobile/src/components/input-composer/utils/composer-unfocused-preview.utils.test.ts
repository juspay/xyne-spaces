import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldRenderComposerUnfocusedTextPreview } from './composer-unfocused-preview-visibility.utils';

test('keeps the native renderer visible for inline custom emojis after blur', () => {
  const html =
    '<html><p>\u00a0</p><p><img src="file:///tmp/emojis/first.gif" width="16" height="16"/>' +
    ' <img src="file:///tmp/emojis/second.gif" width="16" height="16"/></p></html>';

  assert.equal(
    shouldRenderComposerUnfocusedTextPreview({
      isInputFocused: false,
      html,
      text: ':first: :second:',
    }),
    false,
  );
});

test('still renders the formatted text preview for plain composer content', () => {
  assert.equal(
    shouldRenderComposerUnfocusedTextPreview({
      isInputFocused: false,
      html: '<html><p>Hello</p></html>',
      text: 'Hello',
    }),
    true,
  );
});
