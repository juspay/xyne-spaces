import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getChatComposerBottomPadding } from '@/src/features/chat/v2/chatKeyboardConfig';
import {
  TYPING_BAR_DICTATING_WIDTH as DICTATING_WIDTH,
  TYPING_BAR_FIELD_HEIGHT as FIELD_MIN_HEIGHT,
  TYPING_BAR_FIELD_PADDING_LEFT as TEXT_LEFT,
  TYPING_BAR_FIELD_PADDING_RIGHT as SHELL_RIGHT,
  TYPING_BAR_PADDING_TOP as BAR_TOP_PADDING,
  TYPING_BAR_SEND_SIZE as SEND_SIZE,
  TYPING_BAR_TRAILING_GUTTER as GUTTER,
} from '@/src/features/conversation/constants';
import { composerInputTrailingInset } from '@/src/components/input-composer/composer-input-typography';
import {
  consumeDictationEcho,
  fieldTrailingInset,
  getRoomTypingBarMinimumHeight,
  isDictationEcho,
  queueDictationWrite,
  trailingInset,
  typingBarAction,
  typingBarPlaceholder,
} from '@/src/features/conversation/model/typing-bar';

describe('typingBarAction', () => {
  it('offers the mic on an empty field', () => {
    assert.equal(typingBarAction({ hasContent: false, isEditing: false, listening: false }), 'mic');
  });
  it('turns the mic into send once there is content or attachments', () => {
    assert.equal(typingBarAction({ hasContent: true, isEditing: false, listening: false }), 'send');
  });
  it('keeps send while editing, even when emptied', () => {
    assert.equal(typingBarAction({ hasContent: false, isEditing: true, listening: false }), 'send');
  });
  it('shows dictation controls while listening', () => {
    assert.equal(
      typingBarAction({ hasContent: true, isEditing: false, listening: true }),
      'dictating',
    );
  });
});

describe('trailingInset', () => {
  it('reserves more room for dictation than for send or mic', () => {
    assert.ok(trailingInset('dictating') > trailingInset('send'));
    assert.equal(trailingInset('send'), SEND_SIZE + GUTTER);
    assert.equal(trailingInset('send'), trailingInset('mic'));
    assert.equal(trailingInset('dictating'), DICTATING_WIDTH + GUTTER);
  });
});

describe('fieldTrailingInset', () => {
  it('clears the trailing control while the field is a pill', () => {
    for (const action of ['mic', 'send', 'dictating'] as const) {
      assert.equal(fieldTrailingInset(action, false), trailingInset(action));
    }
  });

  it('gives focused text the same inset on the right as on the left', () => {
    for (const action of ['mic', 'send', 'dictating'] as const) {
      const right =
        SHELL_RIGHT + composerInputTrailingInset(true) + fieldTrailingInset(action, true);
      assert.equal(right, TEXT_LEFT);
    }
  });
});

describe('getRoomTypingBarMinimumHeight', () => {
  it('matches the bar: bottom padding, top padding and the pill', () => {
    assert.equal(
      getRoomTypingBarMinimumHeight(34, true),
      getChatComposerBottomPadding(34, true) + BAR_TOP_PADDING + FIELD_MIN_HEIGHT,
    );
    assert.equal(
      getRoomTypingBarMinimumHeight(34, false),
      getChatComposerBottomPadding(34, false) + BAR_TOP_PADDING + FIELD_MIN_HEIGHT,
    );
  });
});

describe('typingBarPlaceholder', () => {
  it('prefers the screen placeholder', () => {
    assert.equal(typingBarPlaceholder('Message #general', 't1'), 'Message #general');
  });
  it('falls back to Reply… in a thread', () => {
    assert.equal(typingBarPlaceholder(undefined, 't1'), 'Reply…');
  });
  it('leaves the composer default outside a thread', () => {
    assert.equal(typingBarPlaceholder(undefined, undefined), undefined);
    assert.equal(typingBarPlaceholder(undefined, '  '), undefined);
  });
});

describe('isDictationEcho', () => {
  it('recognises the editor echoing dictated text', () => {
    assert.equal(isDictationEcho('hello world', 'hello world'), true);
    assert.equal(isDictationEcho('hello world ', 'hello world'), true);
  });
  it('treats other text as the user typing', () => {
    assert.equal(isDictationEcho('hello worl', 'hello world'), false);
    assert.equal(isDictationEcho('hi', null), false);
  });
});

describe('dictation echo queue', () => {
  it('accepts an echo of an older write after a newer one was queued', () => {
    let pending = queueDictationWrite([], 'hello');
    pending = queueDictationWrite(pending, 'hello wor');
    const first = consumeDictationEcho('hello', pending);
    assert.equal(first.echo, true);
    assert.deepEqual(first.pending, ['hello wor']);
    const second = consumeDictationEcho('hello wor', first.pending);
    assert.equal(second.echo, true);
    assert.deepEqual(second.pending, []);
  });
  it('settles skipped writes when a later one echoes first', () => {
    const pending = ['a', 'a b', 'a b c'];
    const result = consumeDictationEcho('a b', pending);
    assert.equal(result.echo, true);
    assert.deepEqual(result.pending, ['a b c']);
  });
  it('treats text matching no pending write as typing', () => {
    const result = consumeDictationEcho('hello x', ['hello', 'hello wor']);
    assert.equal(result.echo, false);
    assert.deepEqual(result.pending, ['hello', 'hello wor']);
  });
  it('keeps only the latest writes', () => {
    let pending: readonly string[] = [];
    for (let i = 0; i < 20; i++) pending = queueDictationWrite(pending, `w${i}`);
    assert.equal(pending.length, 8);
    assert.equal(pending[7], 'w19');
  });
});
