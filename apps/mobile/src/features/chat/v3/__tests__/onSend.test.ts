import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { onSend } from '../composer/onSend';
import { sendScrollToEndOptions } from '../composer/sendScroll';
import { CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND } from '../composer/chatKeyboardConfig';
import type { OnSendPayload } from '../composer/onSend';

const payload = (over: Partial<OnSendPayload> = {}): OnSendPayload => ({
  text: 'hello',
  content: '<p>hello</p>',
  attachments: [],
  ...over,
});

describe('onSend', (): void => {
  it('calls sendMessage while the connection is disconnected', (): void => {
    const calls: { state: string; content: string }[] = [];
    const zero = { connection: { state: 'disconnected' } };
    const result = onSend(
      {
        zero: zero as unknown as Parameters<typeof onSend>[0]['zero'],
        ref: { kind: 'channel', channelId: 'ch-1', isMember: true },
        createId: (): string => 'id-1',
        sendMessage: (engineZero, _ref, next) => {
          calls.push({
            state: (engineZero as unknown as typeof zero).connection.state,
            content: next.content,
          });
          return { messageId: 'id-1', conversationId: 'id-1' };
        },
      },
      payload(),
    );
    assert.ok(result);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.state, 'disconnected');
    assert.ok((calls[0]?.content.length ?? 0) > 0);
  });

  it('sends client-generated ids as the offline idempotency key', (): void => {
    let n = 0;
    let messageId: string | undefined;
    let conversationId: string | undefined;
    onSend(
      {
        zero: {} as never,
        ref: { kind: 'channel', channelId: 'ch-1', isMember: true },
        createId: (): string => `id-${++n}`,
        sendMessage: (_zero, _ref, next) => {
          messageId = next.messageId;
          conversationId = next.conversationId;
          return { messageId: next.messageId ?? 'x', conversationId: next.conversationId ?? 'y' };
        },
      },
      payload(),
    );
    assert.equal(messageId, 'id-1');
    assert.equal(conversationId, 'id-2');
  });

  it('does not mint a conversation id when sending in a thread', (): void => {
    let messageId: string | undefined;
    let conversationId: string | undefined;
    onSend(
      {
        zero: {} as never,
        ref: { kind: 'thread', channelId: 'ch-1', conversationId: 'thread-1', isMember: true },
        createId: (): string => 'msg-1',
        sendMessage: (_zero, _ref, next) => {
          messageId = next.messageId;
          conversationId = next.conversationId;
          return { messageId: next.messageId ?? 'x', conversationId: next.conversationId ?? 'y' };
        },
      },
      payload(),
    );
    assert.equal(messageId, 'msg-1');
    assert.equal(conversationId, undefined);
  });

  it('does not call sendMessage for an empty body', (): void => {
    let called = false;
    const result = onSend(
      {
        zero: {} as never,
        ref: { kind: 'channel', channelId: 'ch-1', isMember: true },
        createId: (): string => 'id-1',
        sendMessage: () => {
          called = true;
          return { messageId: 'x', conversationId: 'y' };
        },
      },
      payload({ text: '', content: null }),
    );
    assert.equal(result, null);
    assert.equal(called, false);
  });
});

describe('sendScrollToEndOptions', (): void => {
  it('keeps the keyboard open and scrolls the tail like v2', (): void => {
    assert.equal(sendScrollToEndOptions.animated, true);
    assert.equal(sendScrollToEndOptions.closeKeyboard, false);
    assert.equal(sendScrollToEndOptions.closeKeyboard, CHAT_KEYBOARD_SCROLL_CLOSE_ON_SEND);
  });
});
