const mockOnDelete = jest.fn().mockResolvedValue(undefined);
const mockOnUpdate = jest.fn().mockResolvedValue(undefined);
const mockDeleteFile = jest.fn().mockResolvedValue(undefined);
const mockBuildUserQueryContext = jest.fn().mockResolvedValue({ userID: 'bot-1' });

const message = {
  messageId: 'msg-1',
  conversationId: 'conv-1',
  senderId: 'bot-1',
  msgType: 'BOT',
  content: 'hello',
  isDeleted: false,
};
const conversation = {
  conversationId: 'conv-1',
  channelId: 'chan-1',
  initialMessageId: 'root-1',
  replyCount: 2,
  ticketId: null,
};

const tx = {
  message: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  conversation: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  conversationParticipant: { deleteMany: jest.fn() },
  messageAttachment: { deleteMany: jest.fn() },
  reaction: { deleteMany: jest.fn() },
  reactionCount: { deleteMany: jest.fn() },
  messageSearch: { deleteMany: jest.fn() },
};

const db = {
  messageAttachment: { findMany: jest.fn() },
  $transaction: jest.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)),
};

jest.mock('@xyne/shared', () => ({
  AttachmentEntityType: { CHAT: 'CHAT' },
  MessageType: { BOT: 'BOT', SYSTEM: 'SYSTEM' },
}));
jest.mock('@/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('@/database/client', () => ({ db }));
jest.mock('@/services/storage', () => ({ storageService: { deleteFile: mockDeleteFile } }));
jest.mock('@/utils/queryContext', () => ({ buildUserQueryContext: mockBuildUserQueryContext }));
jest.mock('@/zero/side-effects/tables/messages-handler', () => ({
  MessagesSideEffectHandler: jest.fn().mockImplementation(() => ({ onDelete: mockOnDelete, onUpdate: mockOnUpdate })),
}));
jest.mock('@/database/repositories', () => ({
  repositories: {
    messages: { findById: jest.fn() },
    conversations: { findById: jest.fn() },
    messageAttachments: { findByMessageIds: jest.fn() },
  },
}));
jest.mock('@/services/conversationService', () => ({ conversationService: {} }));

import { repositories } from '@/database/repositories';
import { deleteConversationMessage } from './conversationUtils';

const mockRepositories = repositories as unknown as {
  messages: { findById: jest.Mock };
  conversations: { findById: jest.Mock };
};

describe('deleteConversationMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepositories.messages.findById.mockResolvedValue(message as never);
    mockRepositories.conversations.findById.mockResolvedValue(conversation as never);
    db.messageAttachment.findMany.mockResolvedValue([{ url: 'gs://bucket/file', thumbnailUrl: 'gs://bucket/thumb' }]);
    tx.message.findUnique.mockResolvedValue({ messageId: 'msg-1', isDeleted: false, conversationId: 'conv-1' });
    tx.conversation.findUnique.mockResolvedValue(conversation);
    tx.conversation.findMany.mockResolvedValue([]);
    tx.messageAttachment.deleteMany.mockResolvedValue({ count: 1 });
    tx.reaction.deleteMany.mockResolvedValue({ count: 0 });
    tx.reactionCount.deleteMany.mockResolvedValue({ count: 0 });
    tx.messageSearch.deleteMany.mockResolvedValue({ count: 1 });
    tx.message.updateMany.mockResolvedValue({ count: 1 });
    tx.message.deleteMany.mockResolvedValue({ count: 1 });
    tx.conversation.update.mockResolvedValue(conversation);
    tx.conversationParticipant.deleteMany.mockResolvedValue({ count: 0 });
    tx.conversation.deleteMany.mockResolvedValue({ count: 0 });
  });

  it('hard-deletes replies, decrements replyCount, deletes blobs, and runs onDelete side effects', async () => {
    tx.message.findMany.mockResolvedValue([
      { messageId: 'root-1', isDeleted: false },
      { messageId: 'msg-1', isDeleted: false },
    ]);

    await deleteConversationMessage('msg-1', 'bot-1');

    expect(tx.message.deleteMany).toHaveBeenCalledWith({ where: { messageId: 'msg-1', isDeleted: false } });
    expect(tx.conversation.update).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1' },
      data: { replyCount: 1 },
    });
    expect(mockDeleteFile).toHaveBeenCalledWith('gs://bucket/file');
    expect(mockDeleteFile).toHaveBeenCalledWith('gs://bucket/thumb');
    expect(mockOnDelete).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'msg-1', operation: 'delete' }));
    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it('soft-deletes root messages with replies and runs onUpdate once', async () => {
    mockRepositories.conversations.findById.mockResolvedValue({ ...conversation, initialMessageId: 'msg-1' } as never);
    tx.conversation.findUnique.mockResolvedValue({ ...conversation, initialMessageId: 'msg-1' });
    tx.message.findMany.mockResolvedValue([
      { messageId: 'msg-1', isDeleted: false },
      { messageId: 'reply-1', isDeleted: false },
    ]);

    await deleteConversationMessage('msg-1', 'bot-1');

    expect(tx.message.updateMany).toHaveBeenCalledWith({
      where: { messageId: 'msg-1', isDeleted: false },
      data: { isDeleted: true, content: '', hasAttachment: false, edited: false, link_preview_md: '' },
    });
    expect(mockOnUpdate).toHaveBeenCalledTimes(1);
    expect(mockOnDelete).not.toHaveBeenCalled();
  });

  it('is idempotent when the message is already deleted', async () => {
    mockRepositories.messages.findById.mockResolvedValue({ ...message, isDeleted: true } as never);

    const result = await deleteConversationMessage('msg-1', 'bot-1');

    expect(result.eventType).toBe('MESSAGE_DELETED');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(mockOnDelete).not.toHaveBeenCalled();
    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it('is idempotent when a retry loses the transaction race', async () => {
    tx.message.findUnique.mockResolvedValue({ messageId: 'msg-1', isDeleted: true, conversationId: 'conv-1' });

    await deleteConversationMessage('msg-1', 'bot-1');

    expect(mockOnDelete).not.toHaveBeenCalled();
    expect(mockOnUpdate).not.toHaveBeenCalled();
  });
});
