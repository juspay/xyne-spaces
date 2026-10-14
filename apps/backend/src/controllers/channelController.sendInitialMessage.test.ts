// Behavioural test for ChannelController.sendInitialMessage: the conversation
// and its first message commit together, and once they have committed no
// side-effect failure may turn the send into a failure (callers retry a failed
// send, which duplicated DMs before this boundary existed).

// Generic stand-in for modules this test does not exercise: every export is a
// jest.fn (constructible, so `new Repo()` works). Enum-like members resolve to
// their own key so `MessageType.USER === 'USER'`.
function mockModule() {
  return new Proxy({}, {
    get: (_t, key) => (key === '__esModule' ? true : jest.fn()),
  });
}
function mockEnums() {
  return new Proxy({}, {
    get: (_t, key) => (key === '__esModule' ? true : new Proxy({}, { get: (_e, member) => member })),
  });
}

jest.mock('@xyne/shared', () => mockEnums());
jest.mock('@/integrations/social-media/constants', () => mockEnums());
jest.mock('@/integrations/core/sourceScope', () => mockModule());
jest.mock('@/integrations/core/types', () => mockEnums());
jest.mock('../integrations/core/deskSources', () => mockModule());
jest.mock('../api/types/ChannelTypes', () => mockModule());

const mockTransaction = jest.fn();
jest.mock('@/database/client', () => ({ db: { $transaction: (...args: unknown[]) => mockTransaction(...args) } }));
jest.mock('@/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

jest.mock('../database/repositories/channelRepository', () => mockModule());
jest.mock('../database/repositories/channelParticipantRepository', () => mockModule());
jest.mock('../database/repositories/conversationRepository', () => mockModule());
jest.mock('../database/repositories/messageRepository', () => mockModule());
jest.mock('../database/repositories/messageAttachmentRepository', () => mockModule());
jest.mock('../database/repositories/users', () => mockModule());
jest.mock('../database/repositories/userGroups', () => mockModule());
jest.mock('../database/repositories/projectRepository', () => mockModule());
jest.mock('@/database/repositories/channelUserStatusRepository', () => mockModule());
jest.mock('@/database/repositories/emailChannelPreferenceRepository', () => mockModule());
jest.mock('@/database/repositories/externalSourceRepository', () => mockModule());
jest.mock('@/database/acl/admin-access', () => mockModule());
// sendInitialMessageTx and the bypass `transaction` primitive both run for real,
// against the mocked db client above.

jest.mock('@/services/dlResolver', () => mockModule());
jest.mock('@/services/channelEmailAliasService', () => mockModule());
jest.mock('@/services/encryptionService', () => mockModule());
jest.mock('@/services/vespaSearch', () => mockModule());
jest.mock('@/services/groupDmParticipantService', () => mockModule());
jest.mock('@/services/userActivityTrackingService', () => mockModule());
jest.mock('@/services/activity/activityService', () => mockModule());
jest.mock('@/queues/vespaQueue', () => mockModule());
jest.mock('@/vespa/src/types', () => mockModule());
jest.mock('@/vespa/vespaConfig', () => mockModule());
jest.mock('../utils/channelActivityUtils', () => mockModule());
jest.mock('../zero/side-effects/tables/channel-participants-handler', () => mockModule());
jest.mock('@/zero/side-effects/tables/mention-delivery', () => mockModule());
jest.mock('../services/unreadService', () => mockModule());
jest.mock('../types/express', () => ({}));

// The post-commit side effects. Each one is made to fail in the tests below.
const mockEnsureAuthor = jest.fn();
const mockSyncMetadata = jest.fn();
const mockNotifyDm = jest.fn();
const mockUnread = jest.fn();
const mockWsBroadcast = jest.fn();
const mockRedisBroadcast = jest.fn();
jest.mock('@/utils/dmConversationParticipants', () => ({
  ensureDmConversationAuthorParticipant: (...a: unknown[]) => mockEnsureAuthor(...a),
}));
jest.mock('@/services/messageMetadataService', () => ({
  messageMetadataService: { syncInitialMessageMd: (...a: unknown[]) => mockSyncMetadata(...a) },
}));
jest.mock('../services/notificationService', () => ({
  notificationService: { createDirectMessageNotifications: (...a: unknown[]) => mockNotifyDm(...a) },
}));
jest.mock('@/zero/utils/unreadCountUtlis', () => ({ handleUnreadCount: (...a: unknown[]) => mockUnread(...a) }));
jest.mock('../services/websocketService', () => ({
  websocketService: { broadcastToSession: (...a: unknown[]) => mockWsBroadcast(...a) },
}));
jest.mock('../services/redisService', () => ({
  redisService: { broadcastMessageToSession: (...a: unknown[]) => mockRedisBroadcast(...a) },
}));
jest.mock('@/utils/mentionUtils', () => ({
  extractSpecialMentions: () => ({ hasChannel: false, hasHere: false }),
  extractAllUsersForNotification: jest.fn(),
  getChannelParticipantsForMention: jest.fn(),
  getOnlineChannelParticipants: jest.fn(),
}));

import { ChannelController } from './channelController';

type SendResult = { conversationId: string; initialMessage: { messageId: string; content: string } } | null;

const CHANNEL_ID = 'ch_dm';
const SENDER_ID = 'user_sender';
const TX = { marker: 'tx' };
const SIDE_EFFECTS = [mockEnsureAuthor, mockSyncMetadata, mockNotifyDm, mockUnread, mockWsBroadcast, mockRedisBroadcast];

function buildController() {
  const controller = new ChannelController() as unknown as Record<string, unknown> & {
    sendInitialMessage(channelId: string, senderId: string, content: string): Promise<SendResult>;
  };
  const createdConversation = jest.fn(async (_tx: unknown, data: { conversationId: string }) => ({
    conversationId: data.conversationId,
  }));
  const createdMessage = jest.fn(async (_tx: unknown, data: { messageId: string; conversationId: string; content: string }) => ({
    messageId: data.messageId,
    senderId: SENDER_ID,
    content: data.content,
    msgType: 'USER',
    hasAttachment: false,
    createdAt: new Date('2026-10-14T00:00:00Z'),
  }));
  const failing = () => Promise.reject(new Error('side effect down'));

  controller.conversationRepository = { createInTransaction: createdConversation };
  controller.messageRepository = { createInTransaction: createdMessage };
  controller.channelRepository = {
    getWorkspaceId: jest.fn().mockResolvedValue('ws_1'),
    findById: jest.fn().mockResolvedValue({ id: CHANNEL_ID, scopeType: 'DM', name: 'a,b' }),
    updateLastActivity: jest.fn(failing),
  };
  controller.channelUserStatusRepository = { reopenForAllParticipants: jest.fn(failing) };
  controller.channelParticipantRepository = {
    getChannelParticipants: jest.fn().mockResolvedValue([{ userId: SENDER_ID }, { userId: 'user_recipient' }]),
  };
  controller.userRepository = {
    findById: jest.fn().mockResolvedValue({ id: SENDER_ID, name: 'Sender', email: 's@example.com' }),
  };
  return { controller, createdConversation, createdMessage };
}

describe('ChannelController.sendInitialMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockImplementation((run: (tx: unknown) => unknown) => run(TX));
    for (const sideEffect of SIDE_EFFECTS) sideEffect.mockRejectedValue(new Error('side effect down'));
  });

  it('writes the conversation and its first message in one transaction with linked ids', async () => {
    const { controller, createdConversation, createdMessage } = buildController();

    await controller.sendInitialMessage(CHANNEL_ID, SENDER_ID, '  hello  ');

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const conversationData = createdConversation.mock.calls[0][1] as { conversationId: string; initialMessageId: string };
    const messageData = createdMessage.mock.calls[0][1];
    expect(createdConversation.mock.calls[0][0]).toBe(TX);
    expect(createdMessage.mock.calls[0][0]).toBe(TX);
    expect(conversationData.initialMessageId).toBe(messageData.messageId);
    expect(messageData.conversationId).toBe(conversationData.conversationId);
    expect(messageData.content).toBe('hello');
  });

  it('returns the persisted ids even when every post-commit side effect fails', async () => {
    const { controller, createdMessage } = buildController();

    const result = await controller.sendInitialMessage(CHANNEL_ID, SENDER_ID, 'hello');

    const messageData = createdMessage.mock.calls[0][1];
    expect(result).toMatchObject({
      conversationId: messageData.conversationId,
      initialMessage: { messageId: messageData.messageId, content: 'hello' },
    });
    // Every side effect was attempted despite the earlier ones failing.
    for (const sideEffect of SIDE_EFFECTS) expect(sideEffect).toHaveBeenCalledTimes(1);
  });

  it('still returns the persisted message when the sender lookup fails after commit', async () => {
    const { controller } = buildController();
    jest.spyOn(controller as unknown as { getUserInfo: () => Promise<unknown> }, 'getUserInfo')
      .mockRejectedValue(new Error('users table unavailable'));

    const result = await controller.sendInitialMessage(CHANNEL_ID, SENDER_ID, 'hello');

    expect(result).not.toBeNull();
    expect(result?.initialMessage).toMatchObject({ content: 'hello', sender: { id: SENDER_ID } });
  });

  it('returns null without side effects when the transaction fails', async () => {
    const { controller } = buildController();
    mockTransaction.mockRejectedValue(new Error('deadlock'));

    const result = await controller.sendInitialMessage(CHANNEL_ID, SENDER_ID, 'hello');

    expect(result).toBeNull();
    expect(mockNotifyDm).not.toHaveBeenCalled();
    expect(mockWsBroadcast).not.toHaveBeenCalled();
  });
});
