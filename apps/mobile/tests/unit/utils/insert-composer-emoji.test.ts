import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appendMarkupToComposerHtml } from '@/src/components/input-composer/utils/composer-html';
import {
  COMPOSER_NATIVE_DOCUMENT_END,
  COMPOSER_NATIVE_IMAGE_CHAR,
  composerCustomEmojiInsertMarkup,
  planEmojiInsert,
} from '@/src/components/input-composer/utils/insert-composer-emoji.plan';

const unicode = { type: 'emoji' as const, value: '😀' };
const custom = { type: 'custom' as const, value: ':wave:', emojiId: 'abc', name: 'wave' };

describe('planEmojiInsert', () => {
  it('appends a unicode emoji after the last character, with a leading space', () => {
    const plan = planEmojiInsert('hello', unicode);
    assert.ok(plan);
    assert.equal(plan.needsSpace, true);
    assert.equal(plan.isAppending, true);
    assert.equal(plan.nextText, 'hello 😀');
  });

  it('does not add a second space when the text already ends with one', () => {
    const plan = planEmojiInsert('hello ', unicode);
    assert.ok(plan);
    assert.equal(plan.needsSpace, false);
    assert.equal(plan.nextText, 'hello 😀');
  });

  it('uses the native image character for custom emoji, not the :name: shortcode', () => {
    const plan = planEmojiInsert('hello', custom);
    assert.ok(plan);
    assert.equal(plan.needsSpace, true);
    assert.equal(plan.nextText, `hello ${COMPOSER_NATIVE_IMAGE_CHAR}`);
    assert.equal(plan.nextText.includes(':wave:'), false);
    assert.equal(plan.nextText.length, 'hello '.length + 1);
  });

  it('places a second custom emoji after the first native image character', () => {
    const first = planEmojiInsert('hello', custom);
    assert.ok(first);
    const second = planEmojiInsert(first.nextText, custom);
    assert.ok(second);
    assert.equal(
      second.nextText,
      `hello ${COMPOSER_NATIVE_IMAGE_CHAR} ${COMPOSER_NATIVE_IMAGE_CHAR}`,
    );
  });

  it('inserts a custom emoji in the middle of the message without inventing a space', () => {
    const plan = planEmojiInsert('hello world', custom, { start: 5, end: 5 });
    assert.ok(plan);
    assert.equal(plan.needsSpace, false);
    assert.equal(plan.isAppending, false);
    assert.equal(plan.nextText, `hello${COMPOSER_NATIVE_IMAGE_CHAR} world`);
  });

  it('uses a native caret index that always clamps to the document end', () => {
    assert.ok(COMPOSER_NATIVE_DOCUMENT_END > 10_000);
  });
});

describe('composerCustomEmojiInsertMarkup', () => {
  it('appends the image at the end of the current html, never in the middle', () => {
    const html = '<html><p>hello world</p></html>';
    const markup = composerCustomEmojiInsertMarkup('file:///tmp/emojis/wave.gif', true);
    const next = appendMarkupToComposerHtml(html, markup);
    assert.match(next, /hello world <img src="file:\/\/\/tmp\/emojis\/wave\.gif"/);
    assert.doesNotMatch(next, /hello <img/);
  });
});
