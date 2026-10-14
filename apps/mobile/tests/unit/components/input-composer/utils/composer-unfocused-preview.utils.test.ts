import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseComposerHtmlToUnfocusedPreviewSegments } from '@/src/components/input-composer/utils/composer-unfocused-preview.utils';

describe('parseComposerHtmlToUnfocusedPreviewSegments', () => {
  it('returns a single trimmed text segment for plain paragraph html', () => {
    assert.deepEqual(parseComposerHtmlToUnfocusedPreviewSegments('<p>Hello world</p>'), [
      { type: 'text', value: 'Hello world' },
    ]);
  });

  it('uses the fallback text when the html has no visible content', () => {
    assert.deepEqual(parseComposerHtmlToUnfocusedPreviewSegments('<p>   </p>', 'draft text'), [
      { type: 'text', value: 'draft text' },
    ]);
  });

  it('returns an empty array when html and fallback are both empty', () => {
    assert.deepEqual(parseComposerHtmlToUnfocusedPreviewSegments(''), []);
  });

  it('splits a trailing user mention into its own segment', () => {
    assert.deepEqual(
      parseComposerHtmlToUnfocusedPreviewSegments(
        '<p>Hi <mention data-username="Alice">@Alice</mention></p>',
      ),
      [
        { type: 'text', value: 'Hi ' },
        { type: 'mention', label: '@Alice' },
      ],
    );
  });

  it('renders channel mentions with a hash indicator from data-channel-name', () => {
    assert.deepEqual(
      parseComposerHtmlToUnfocusedPreviewSegments(
        '<p><mention indicator="#" data-channel-name="general">#general</mention></p>',
      ),
      [{ type: 'mention', label: '#general' }],
    );
  });

  it('inserts a separating space when text immediately follows a mention', () => {
    assert.deepEqual(
      parseComposerHtmlToUnfocusedPreviewSegments(
        '<p><mention data-username="Bob">@Bob</mention>says hi</p>',
      ),
      [
        { type: 'mention', label: '@Bob' },
        { type: 'text', value: ' says hi' },
      ],
    );
  });

  it('keeps text and mentions ordered across several mentions', () => {
    assert.deepEqual(
      parseComposerHtmlToUnfocusedPreviewSegments(
        '<p><mention data-username="A">@A</mention> and <mention data-username="B">@B</mention></p>',
      ),
      [
        { type: 'mention', label: '@A' },
        { type: 'text', value: ' and ' },
        { type: 'mention', label: '@B' },
      ],
    );
  });

  it('collapses line breaks and paragraph boundaries into single spaces', () => {
    assert.deepEqual(parseComposerHtmlToUnfocusedPreviewSegments('<p>Line1<br>Line2</p>'), [
      { type: 'text', value: 'Line1 Line2' },
    ]);
    assert.deepEqual(parseComposerHtmlToUnfocusedPreviewSegments('<p>Para1</p><p>Para2</p>'), [
      { type: 'text', value: 'Para1 Para2' },
    ]);
  });

  it('substitutes an image with its alt text', () => {
    assert.deepEqual(
      parseComposerHtmlToUnfocusedPreviewSegments('<p><img alt="star"/> rating</p>'),
      [{ type: 'text', value: 'star rating' }],
    );
  });

  it('decodes html entities in text content', () => {
    assert.deepEqual(parseComposerHtmlToUnfocusedPreviewSegments('<p>a &amp; b</p>'), [
      { type: 'text', value: 'a & b' },
    ]);
  });

  it('prefers the username attribute over the inner label for user mentions', () => {
    assert.deepEqual(
      parseComposerHtmlToUnfocusedPreviewSegments(
        '<p><mention username="Carol">@wrong</mention></p>',
      ),
      [{ type: 'mention', label: '@Carol' }],
    );
  });
});
