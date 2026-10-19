import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  composerHtmlToPlainText,
  composerNativeSetValue,
  getConversationInputComposerKey,
  resolveComposerPlainText,
  shouldWriteComposerNativeValue,
} from '@/src/components/input-composer/utils/conversation-input.utils';

describe('composerHtmlToPlainText', () => {
  it('strips a single paragraph to its text', () => {
    assert.equal(composerHtmlToPlainText('<p>Hello</p>'), 'Hello');
  });

  it('turns paragraph breaks into newlines', () => {
    assert.equal(composerHtmlToPlainText('<p>Hello</p><p>World</p>'), 'Hello\nWorld');
  });

  it('preserves custom emoji shortcodes from the img alt attribute', () => {
    assert.equal(
      composerHtmlToPlainText('<p>hi <img data-emoji-id="1" alt=":smile:" /></p>'),
      'hi :smile:',
    );
  });

  it('drops a custom emoji img that has no alt', () => {
    assert.equal(composerHtmlToPlainText('<p>x<img data-emoji-id="1" /></p>'), 'x');
  });

  it('preserves a native file:// custom emoji as a shortcode', () => {
    assert.equal(
      composerHtmlToPlainText(
        '<p><img src="file:///tmp/emojis/abc.gif" width="16" height="16"/></p>',
      ),
      ':abc:',
    );
  });

  it('decodes HTML entities', () => {
    assert.equal(composerHtmlToPlainText('<p>a &amp; b</p>'), 'a & b');
  });
});

describe('resolveComposerPlainText', () => {
  it('prefers live plain text when it has content', () => {
    assert.equal(resolveComposerPlainText('hello', '<p>ignored</p>'), 'hello');
    assert.equal(resolveComposerPlainText('hello', '<p>ignored</p>', false), 'hello');
  });

  it('falls back to HTML when plain text is empty or whitespace', () => {
    assert.equal(resolveComposerPlainText('', '<p>Hello</p>'), 'Hello');
    assert.equal(resolveComposerPlainText('   ', '<p>Hello</p>'), 'Hello');
    assert.equal(resolveComposerPlainText('', '<p>Hello</p>', true), 'Hello');
  });

  it('does not revive stale HTML after plain text was explicitly cleared', () => {
    assert.equal(resolveComposerPlainText('', '<p>Hello</p>', false), '');
    assert.equal(resolveComposerPlainText('   ', '<p>Hello</p>', false), '   ');
  });

  it('returns empty when both text and HTML have no sendable body', () => {
    assert.equal(resolveComposerPlainText('', '<p></p>'), '');
    assert.equal(resolveComposerPlainText('', '<p><br></p>'), '');
    assert.equal(resolveComposerPlainText('   ', ''), '');
  });

  it('treats custom emoji alt as sendable HTML fallback', () => {
    assert.equal(
      resolveComposerPlainText('', '<p><img data-emoji-id="1" alt=":smile:" /></p>'),
      ':smile:',
    );
  });
});

describe('composerNativeSetValue', () => {
  it('prefers HTML when it has a body', () => {
    const value = composerNativeSetValue('', '<p>Hello</p>');
    assert.match(value, /<p>Hello<\/p>/);
    assert.match(value, /<html/i);
  });

  it('wraps plain text when HTML was never persisted', () => {
    const value = composerNativeSetValue('Hello', '');
    assert.match(value, /<p>Hello<\/p>/);
    assert.match(value, /<html/i);
  });

  it('falls back to plain text when HTML is only an empty shell', () => {
    const value = composerNativeSetValue('Hello', '<p></p>');
    assert.match(value, /<p>Hello<\/p>/);
  });

  it('keeps HTML that only has a custom emoji image', () => {
    const html = '<p><img src="file:///tmp/emojis/wave.gif" width="16" height="16"/></p>';
    const value = composerNativeSetValue('', html);
    assert.match(value, /wave\.gif/);
  });

  it('returns empty when both sides are empty', () => {
    assert.equal(composerNativeSetValue('', ''), '');
    assert.equal(composerNativeSetValue('   ', '   '), '');
    assert.equal(composerNativeSetValue('', '<p></p>'), '');
  });
});

describe('shouldWriteComposerNativeValue', () => {
  it('skips a no-op empty write on a fresh field', () => {
    assert.equal(shouldWriteComposerNativeValue('', undefined), false);
    assert.equal(shouldWriteComposerNativeValue('', ''), false);
  });

  it('skips writing the same native payload twice', () => {
    const value = composerNativeSetValue('Hello', '<p>Hello</p>');
    assert.equal(shouldWriteComposerNativeValue(value, value), false);
  });

  it('writes content and writes a later clear', () => {
    const value = composerNativeSetValue('Hello', '<p>Hello</p>');
    assert.equal(shouldWriteComposerNativeValue(value, undefined), true);
    assert.equal(shouldWriteComposerNativeValue('', value), true);
  });
});

describe('getConversationInputComposerKey', () => {
  it('builds a compose key without a thread', () => {
    assert.equal(getConversationInputComposerKey('c1', undefined, 0), 'c1:root:composer:0');
  });

  it('builds a compose key with a thread', () => {
    assert.equal(getConversationInputComposerKey('c1', 't1', 5), 'c1:t1:composer:5');
  });

  it('includes the edit session so a new edit remounts', () => {
    assert.equal(getConversationInputComposerKey('c1', undefined, 2), 'c1:root:composer:2');
    assert.equal(getConversationInputComposerKey('c1', 't1', 3), 'c1:t1:composer:3');
  });

  it('produces a different key when the edit session changes', () => {
    const a = getConversationInputComposerKey('c1', 't1', 2);
    const b = getConversationInputComposerKey('c1', 't1', 3);
    assert.notEqual(a, b);
  });
});
