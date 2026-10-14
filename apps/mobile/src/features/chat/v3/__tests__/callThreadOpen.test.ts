import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { callThreadOpen } from '../screens/callThreadOpen';
import { buildRows } from '../model/buildRows';
import type { ConversationInput } from '../model/conversationInput';

const input = (over: Partial<ConversationInput> = {}): ConversationInput => ({
  conversationId: 'conversation-1',
  channelId: 'channel-1',
  createdAt: Date.UTC(2026, 7, 22, 12, 0, 0),
  messageId: 'message-1',
  senderId: 'system',
  senderDisplayName: 'System',
  senderAvatarUri: null,
  messageType: 'SYSTEM',
  html: '',
  markdown: 'Call',
  isDeleted: false,
  showInChannel: false,
  isVisibleToCurrentUser: true,
  metadata: { isCallMessage: true, callId: 'call-1' },
  attachments: [],
  ticketPreview: null,
  parentConversationId: null,
  parentMessageId: null,
  parentMarkdown: null,
  replyCount: 0,
  latestReplierIds: [],
  reactionsMd: null,
  linkUrl: null,
  linkTitle: null,
  linkDescription: null,
  forwardedFromName: null,
  forwardedSource: null,
  isPinned: false,
  isBookmarked: false,
  isEdited: false,
  isFlowJson: false,
  ...over,
});

const model = (() => {
  const row = buildRows([input()], {
    channelId: 'channel-1',
    channelKind: 'channel',
    currentUserId: 'me',
  }).find(item => item.type === 'message');
  assert.ok(row && row.type === 'message');
  return row.model;
})();

describe('callThreadOpen', (): void => {
  it('passes the full thread route for the summary action', (): void => {
    assert.deepEqual(callThreadOpen(model, 'summary'), {
      pathname: '/chat/[channelId]/[threadId]',
      params: {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        isTranscript: 'false',
      },
    });
  });

  it('passes the full thread route for the transcript action', (): void => {
    assert.deepEqual(callThreadOpen(model, 'transcript'), {
      pathname: '/chat/[channelId]/[threadId]',
      params: {
        channelId: 'channel-1',
        threadId: 'conversation-1',
        isTranscript: 'true',
      },
    });
  });
});
