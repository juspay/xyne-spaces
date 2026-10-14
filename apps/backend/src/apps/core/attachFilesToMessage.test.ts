const mockMessage = jest.fn();
const mockConversation = jest.fn();
const mockUpdateMessageContent = jest.fn();
const mockFindByMessageId = jest.fn();

jest.mock('@/config/env', () => ({ config: {} }));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@xyne/shared', () => ({ MessageType: { BOT: 'BOT' } }));
jest.mock('@/database/client', () => ({
  db: {
    message: { findUnique: (...args: unknown[]) => mockMessage(...args) },
    conversation: { findUnique: (...args: unknown[]) => mockConversation(...args) },
  },
}));
jest.mock('@/services/conversationService', () => ({
  conversationService: { updateMessageContent: (...args: unknown[]) => mockUpdateMessageContent(...args) },
}));
jest.mock('@/database/repositories/messageAttachmentRepository', () => ({
  MessageAttachmentRepository: jest.fn().mockImplementation(() => ({
    findByMessageId: (...args: unknown[]) => mockFindByMessageId(...args),
  })),
}));
jest.mock('@/services/fileUploadService', () => ({ uploadFiles: jest.fn() }));
jest.mock('./conversationUtils', () => ({ findOrCreateConversation: jest.fn() }));
jest.mock('@/integrations/adapters/slack-webhook-tickets/utils/slackUserResolver', () => ({ resolveSlackMentions: jest.fn() }));
jest.mock('@/integrations/adapters/slack-webhook-tickets/utils/slackBlockKitParser', () => ({
  SlackBlockKitParser: jest.fn().mockImplementation(() => ({ parse: jest.fn() })),
}));
jest.mock('../types', () => ({ FileUploadEventType: { FILE_UPLOADED: 'file_uploaded' } }));

import { attachFilesToMessage } from './fileUtils';

const file = { originalname: 'proof.md' } as Express.Multer.File;

describe('attachFilesToMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMessage.mockResolvedValue({ messageId: 'm1', conversationId: 'c1', senderId: 'bot_1', isDeleted: false });
    mockConversation.mockResolvedValue({ channelId: 'ch_1' });
    mockFindByMessageId.mockResolvedValue([
      { id: 'a1', originalFilename: 'proof.md', url: 'attachments/proof.md', size: 10, mimetype: 'text/markdown' },
    ]);
  });

  it('attaches the files to a message the same bot posted in that channel', async () => {
    const result = await attachFilesToMessage({ messageId: 'm1', files: [file], userId: 'bot_1', channelId: 'ch_1' });
    expect(mockUpdateMessageContent).toHaveBeenCalledWith({ messageId: 'm1', files: [file] });
    expect(result).toEqual({
      eventType: 'file_uploaded',
      conversationId: 'c1',
      messageId: 'm1',
      attachments: [{ fileid: 'a1', originalFilename: 'proof.md', url: 'attachments/proof.md', size: 10, mimeType: 'text/markdown' }],
    });
  });

  it("refuses another sender's message", async () => {
    await expect(
      attachFilesToMessage({ messageId: 'm1', files: [file], userId: 'bot_2', channelId: 'ch_1' }),
    ).rejects.toThrow('Message not found');
    expect(mockUpdateMessageContent).not.toHaveBeenCalled();
  });

  it('refuses a message from another channel', async () => {
    await expect(
      attachFilesToMessage({ messageId: 'm1', files: [file], userId: 'bot_1', channelId: 'ch_other' }),
    ).rejects.toThrow('Message not found');
    expect(mockUpdateMessageContent).not.toHaveBeenCalled();
  });

  it('refuses a deleted or missing message', async () => {
    mockMessage.mockResolvedValueOnce({ messageId: 'm1', conversationId: 'c1', senderId: 'bot_1', isDeleted: true });
    await expect(
      attachFilesToMessage({ messageId: 'm1', files: [file], userId: 'bot_1', channelId: 'ch_1' }),
    ).rejects.toThrow('Message not found');
    mockMessage.mockResolvedValueOnce(null);
    await expect(
      attachFilesToMessage({ messageId: 'm1', files: [file], userId: 'bot_1', channelId: 'ch_1' }),
    ).rejects.toThrow('Message not found');
  });
});
