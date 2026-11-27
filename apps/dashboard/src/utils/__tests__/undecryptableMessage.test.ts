import { describe, expect, it } from 'vitest';
import {
  getInitialMessageFromConversation,
  getParentMessageFromConversation,
} from '../conversationMessageHelpers';
import { isUndecryptableMessage, UNDECRYPTABLE_MESSAGE_TEXT } from '../undecryptableMessage';
import { createMessagePreview } from '../../components/Chat/ChatList/ChatListUtils';
import { getReactionMessagePreview } from '../../components/Activity/reactionMessagePreview';

const CIPHERTEXT = `ENC:v1|tk-1|${'A'.repeat(40)}`;

const conversation = {
  conversationId: 'conv-1',
  initialMessageId: 'msg-1',
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
  workspaceId: 'ws-1',
};

describe('isUndecryptableMessage', () => {
  it('matches ciphertext only', () => {
    expect(isUndecryptableMessage(CIPHERTEXT)).toBe(true);
    expect(isUndecryptableMessage('ENC: plan for the quarter')).toBe(false);
    expect(isUndecryptableMessage('<p>hello</p>')).toBe(false);
    expect(isUndecryptableMessage(null)).toBe(false);
  });
});

describe('getInitialMessageFromConversation', () => {
  it('builds the initial message from the conversation when initial_message_md is ciphertext', () => {
    const message = getInitialMessageFromConversation({
      ...conversation,
      initial_message_md: CIPHERTEXT,
    });
    expect(message).toMatchObject({
      messageId: 'msg-1',
      conversationId: 'conv-1',
      senderId: 'user-1',
      createdAt: conversation.createdAt,
      content: CIPHERTEXT,
      workspaceId: 'ws-1',
    });
  });

  it('returns null without initial_message_md or the columns to rebuild it from', () => {
    expect(
      getInitialMessageFromConversation({ ...conversation, initial_message_md: null }),
    ).toBeNull();
    expect(
      getInitialMessageFromConversation({ workspaceId: 'ws-1', initial_message_md: CIPHERTEXT }),
    ).toBeNull();
  });
});

describe('getParentMessageFromConversation', () => {
  it('returns a summary carrying the ciphertext when parent_message_md is ciphertext', () => {
    expect(
      getParentMessageFromConversation({
        parent_message_md: CIPHERTEXT,
        parentMessageId: 'parent-1',
      }),
    ).toMatchObject({ messageId: 'parent-1', content: CIPHERTEXT });
    expect(getParentMessageFromConversation({ parent_message_md: CIPHERTEXT })).toBeNull();
  });
});

describe('message previews', () => {
  it('show the placeholder for ciphertext', () => {
    expect(createMessagePreview(CIPHERTEXT)).toBe(UNDECRYPTABLE_MESSAGE_TEXT);
    expect(getReactionMessagePreview(CIPHERTEXT)).toBe(UNDECRYPTABLE_MESSAGE_TEXT);
  });
});
