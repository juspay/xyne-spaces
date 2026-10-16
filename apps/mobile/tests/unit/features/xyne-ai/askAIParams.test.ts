import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createForwardedMessageXml } from '@xyne/shared';

import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import { channelScopeParams, messageScopeParams } from '@/src/features/xyne-ai/model/askAIParams';

describe('channelScopeParams', () => {
  it('scopes a channel by id and name', () => {
    assert.deepEqual(channelScopeParams({ id: 'c1', name: 'general', scopeType: 'DEFAULT' }), {
      channelId: 'c1',
      channelName: 'general',
    });
  });

  it('leaves DMs, group DMs and a missing channel unscoped, like the dashboard', () => {
    assert.deepEqual(channelScopeParams({ id: 'd1', name: 'Ann', scopeType: 'DM' }), {});
    assert.deepEqual(channelScopeParams({ id: 'g1', name: 'Ann, Bo', scopeType: 'GROUP_DM' }), {});
    assert.deepEqual(channelScopeParams(undefined), {});
  });
});

describe('messageScopeParams', () => {
  const ID = '2af694dc-c64e-466f-b5c1-000000000000';
  const ask = (
    message: Parameters<typeof messageScopeParams>[0],
  ): ReturnType<typeof messageScopeParams> => messageScopeParams(message, composerHtmlToPlainText);
  const forward = (optionalText: string | null): string =>
    createForwardedMessageXml({
      originalMessageId: ID,
      originalSenderId: 'u2',
      originalSenderName: 'Ann',
      originalCreatedAt: 1,
      originalChannelId: 'c1',
      originalConversationId: ID,
      optionalText,
      content: '<p>Original plan</p>',
    });

  it('shows the text on one line with the sender', () => {
    assert.deepEqual(ask({ senderId: 'u1', content: '<p></p><p>Ship it\n today</p>' }), {
      previewText: 'Ship it today',
      senderId: 'u1',
    });
  });

  it('names a call instead of showing its id, without a sender', () => {
    assert.deepEqual(
      ask({ senderId: 'u1', content: ID, metadata: { isCallMessage: true, callTitle: 'Standup' } }),
      { previewText: 'Standup' },
    );
  });

  it('shows a forward by its comment, else its original text, never its ids', () => {
    assert.equal(
      ask({ senderId: 'u1', content: forward('Look at this') }).previewText,
      'Look at this',
    );
    assert.equal(ask({ senderId: 'u1', content: forward(null) }).previewText, 'Original plan');
  });

  it('never shows an agent card body or a blank pill', () => {
    assert.equal(
      ask({ senderId: 'u1', content: '{}', metadata: { isFlowJson: true } }).previewText,
      'Message',
    );
    assert.equal(ask({ senderId: 'u1', content: '<p>\u200B</p>' }).previewText, 'Message');
    assert.equal(
      ask({ senderId: 'u1', content: '', attachments: [{}, {}] }).previewText,
      '2 Attachments',
    );
  });
});
