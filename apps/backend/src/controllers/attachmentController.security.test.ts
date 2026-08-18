/**
 * POT for XYNE-56394 M2 — IMPACT / FORM_ENTITY_VALUE attachment download leak.
 *
 * assertAttachmentAccess previously fell through to a workspace-only check for these
 * non-chat attachment types, so any workspace member could download a PRIVATE-channel
 * ticket's impact / stage-form documents by id. The fix resolves the owning ticket's
 * channel and requires PUBLIC visibility or channel participation. These tests drive
 * the private method with a mocked db + participation repo and assert the gate.
 *
 * Heavy/side-effectful imports of the controller module are mocked so the suite runs
 * without Redis, storage, or a live DB.
 */

const mockDb = {
  impact: { findUnique: jest.fn() },
  formEntityValues: { findUnique: jest.fn() },
  ticket: { findUnique: jest.fn() },
  channel: { findUnique: jest.fn() },
};
const mockIsParticipant = jest.fn();

jest.mock('../database/client', () => ({
  DatabaseClient: { getInstance: () => mockDb },
}));
jest.mock('../database/repositories/messageAttachmentRepository', () => ({
  MessageAttachmentRepository: class {
    findByEntityIdAndType = jest.fn();
    createMany = jest.fn();
  },
}));
jest.mock('../database/repositories/conversationRepository', () => ({
  ConversationRepository: class {
    findById = jest.fn();
  },
}));
jest.mock('../database/repositories/channelParticipantRepository', () => ({
  ChannelParticipantRepository: class {
    isParticipant = mockIsParticipant;
  },
}));
jest.mock('../services/storage/index', () => ({ storageService: {}, getStorageService: jest.fn() }));
jest.mock('../services/fileUploadService', () => ({ uploadFiles: jest.fn() }));
jest.mock('../services/canvasAuthService', () => ({ canvasAuthService: { requireViewAccess: jest.fn() } }));
jest.mock('@/services/fileProcessor', () => ({ isSupportedMimeType: () => false }));
jest.mock('@/queues/vespaQueue', () => ({ vespaQueue: { add: jest.fn() } }));
jest.mock('@/vespa/src/types', () => ({ fileSchema: 'file', SubApp: {} }));
jest.mock('@/vespa/vespaConfig', () => ({ NAMESPACE: 'ns' }));
jest.mock('@xyne/storage', () => ({ normalizeStoragePath: (x: string) => x }));
jest.mock('@xyne/shared', () => ({
  AttachmentEntityType: {
    IMPACT: 'IMPACT',
    FORM_ENTITY_VALUE: 'FORM_ENTITY_VALUE',
    DRAFT: 'DRAFT',
    DELAYED_MESSAGE: 'DELAYED_MESSAGE',
    CANVAS: 'CANVAS',
  },
  ChannelVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
}));

import { AttachmentController } from './attachmentController';
import { AttachmentEntityType } from '@xyne/shared';

const WS = 'ws-1';

function attachment(entityType: AttachmentEntityType, entityId: string) {
  return {
    id: 'att-1',
    entityType,
    entityId,
    conversationId: null,
    workspaceId: WS,
    createdBy: 'user-1',
  } as never;
}

function callGate(entityType: AttachmentEntityType, entityId: string) {
  const controller = new AttachmentController();
  return (controller as unknown as {
    assertAttachmentAccess: (a: unknown, u: string, w?: string) => Promise<{ ok: boolean; status?: number }>;
  }).assertAttachmentAccess(attachment(entityType, entityId), 'user-1', WS);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('XYNE-56394 M2 — IMPACT attachment download gate', () => {
  it('denies a non-participant of the ticket PRIVATE channel', async () => {
    mockDb.impact.findUnique.mockResolvedValue({ ticketId: 't1' });
    mockDb.ticket.findUnique.mockResolvedValue({ channelId: 'ch1', workspaceId: WS });
    mockDb.channel.findUnique.mockResolvedValue({ visibility: 'PRIVATE' });
    mockIsParticipant.mockResolvedValue(false);

    const res = await callGate(AttachmentEntityType.IMPACT, 'imp-1');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });

  it('allows a participant of the ticket PRIVATE channel', async () => {
    mockDb.impact.findUnique.mockResolvedValue({ ticketId: 't1' });
    mockDb.ticket.findUnique.mockResolvedValue({ channelId: 'ch1', workspaceId: WS });
    mockDb.channel.findUnique.mockResolvedValue({ visibility: 'PRIVATE' });
    mockIsParticipant.mockResolvedValue(true);

    const res = await callGate(AttachmentEntityType.IMPACT, 'imp-1');
    expect(res.ok).toBe(true);
  });

  it('allows any workspace member when the ticket channel is PUBLIC', async () => {
    mockDb.impact.findUnique.mockResolvedValue({ ticketId: 't1' });
    mockDb.ticket.findUnique.mockResolvedValue({ channelId: 'ch1', workspaceId: WS });
    mockDb.channel.findUnique.mockResolvedValue({ visibility: 'PUBLIC' });

    const res = await callGate(AttachmentEntityType.IMPACT, 'imp-1');
    expect(res.ok).toBe(true);
    expect(mockIsParticipant).not.toHaveBeenCalled();
  });
});

describe('XYNE-56394 M2 — FORM_ENTITY_VALUE attachment download gate', () => {
  it('denies a non-participant for a TICKET-scoped form value in a PRIVATE channel', async () => {
    mockDb.formEntityValues.findUnique.mockResolvedValue({ entityId: 't1', entityType: 'TICKET' });
    mockDb.ticket.findUnique.mockResolvedValue({ channelId: 'ch1', workspaceId: WS });
    mockDb.channel.findUnique.mockResolvedValue({ visibility: 'PRIVATE' });
    mockIsParticipant.mockResolvedValue(false);

    const res = await callGate(AttachmentEntityType.FORM_ENTITY_VALUE, 'fev-1');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });

  it('does NOT over-block a non-ticket-scoped form value (keeps workspace-bounded default)', async () => {
    mockDb.formEntityValues.findUnique.mockResolvedValue({ entityId: 'u1', entityType: 'USER' });

    const res = await callGate(AttachmentEntityType.FORM_ENTITY_VALUE, 'fev-2');
    expect(res.ok).toBe(true);
    expect(mockDb.ticket.findUnique).not.toHaveBeenCalled();
  });
});
