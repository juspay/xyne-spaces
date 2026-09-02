/**
 * Regression test for the "18 seconds vs 49 minute transcript" call-duration bug.
 *
 * A scheduled call's duration is derived as endedAt - startedAt. startedAt is set to the
 * REAL first-join time by the first-activation branch of activateScheduledCall (correcting
 * the schema's schedule-time default). When everyone leaves within the scheduled window the
 * call reverts to SCHEDULED and can be rejoined. The rejoin branch used to overwrite
 * startedAt with the reconnect time, collapsing the whole call's duration to the length of
 * the last tiny reconnect — the reported bug (call showed 18s, transcript spanned 49m).
 *
 * These tests pin the fix: the rejoin branch must NOT write startedAt and must clear the
 * stale endedAt, while genuine first-join branches must still set startedAt to `now`.
 */

// Enums are runtime values used inside the method; @xyne/shared ships ESM jest won't transform.
jest.mock('@xyne/shared', () => ({
  CallStatus: { SCHEDULED: 'SCHEDULED', ACTIVE: 'ACTIVE', ENDED: 'ENDED' },
  CallType: { AUDIO: 'AUDIO', VIDEO: 'VIDEO', HEADLESS: 'HEADLESS' },
  CallOrigin: { CHANNEL: 'CHANNEL', CONVERSATION: 'CONVERSATION' },
  MessageType: { SYSTEM: 'SYSTEM', BOT: 'BOT' },
  MessageArtifactStatus: { ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED' },
  InvitationResponse: {},
  MeetingStatus: {},
  TagMethod: {},
}));

const dbMock = {
  $transaction: jest.fn(),
  call: { findUnique: jest.fn() },
};
jest.mock('../client', () => ({
  DatabaseClient: { getInstance: () => dbMock },
}));

jest.mock('./index', () => ({ repositories: { channels: { getWorkspaceId: jest.fn() } } }));
jest.mock('@/services/messageMetadataService', () => ({
  messageMetadataService: { syncInitialMessageMd: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('@/services/callVespaQueue', () => ({
  queueCallVespaFeed: jest.fn(),
  queueCallVespaDelete: jest.fn(),
  CallVespaFeedSource: { CallRepositoryActivateScheduledCall: 'activate' },
}));
jest.mock('@/zero/utils/systemMessagesUtils', () => ({
  updateCallSystemMessageIfNeeded: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/utils/callParticipantCountUtils', () => ({
  refreshCallParticipantPreview: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./messageArtifactRepository', () => ({
  setSlashCommandArtifactLifecycle: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() },
}));
jest.mock('@/database/tenant/workspace-utils', () => ({ resolveWorkspaceIdFromModel: jest.fn() }));
jest.mock('@/utils/email', () => ({ normalizeEmailList: (x: unknown) => x }));

import { CallRepository } from './callRepository';

type UpdateArg = { where: unknown; data: Record<string, unknown> };

/** Build a tx mock that records every call.update payload. */
function makeTx(callRow: Record<string, unknown>) {
  const callUpdates: UpdateArg[] = [];
  const tx = {
    call: {
      findUnique: jest.fn().mockResolvedValue(callRow),
      update: jest.fn((arg: UpdateArg) => {
        callUpdates.push(arg);
        return Promise.resolve({ ...callRow, ...arg.data });
      }),
    },
    conversation: { create: jest.fn(), update: jest.fn() },
    message: { create: jest.fn(), update: jest.fn() },
  };
  return { tx, callUpdates };
}

const ORIGINAL_STARTED = new Date('2025-09-02T12:59:29.000Z');
const NOW = new Date('2025-09-02T13:50:15.500Z');

describe('CallRepository.activateScheduledCall — startedAt handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dbMock.call.findUnique.mockResolvedValue({ metadata: { conversationId: 'conv-1' } });
  });

  it('rejoin within the window preserves the original startedAt and clears the stale endedAt', async () => {
    const callRow = {
      id: 'call-1',
      externalId: 'room-1',
      workspaceId: 'ws-1',
      channelId: 'chan-1',
      callUpdatesChannel: null,
      startedAt: ORIGINAL_STARTED,
      endedAt: new Date('2025-09-02T13:49:50.000Z'), // written by the previous revert-to-SCHEDULED
      // both keys present => rejoin branch
      metadata: { conversationId: 'conv-1', systemMessageId: 'sys-1' },
    };
    const { tx, callUpdates } = makeTx(callRow);
    dbMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));

    const repo = new CallRepository();
    await repo.activateScheduledCall({
      call: callRow as never,
      initiatorName: 'Utkarsh',
      now: NOW,
    });

    expect(callUpdates).toHaveLength(1);
    const data = callUpdates[0].data;
    expect(data.status).toBe('ACTIVE');
    // The bug: startedAt must NOT be overwritten on rejoin.
    expect(data).not.toHaveProperty('startedAt');
    // Re-open semantics: the stale endedAt from the previous revert is cleared.
    expect(data.endedAt).toBeNull();
  });

  it('first join (no conversation yet) sets startedAt to the real first-join time', async () => {
    const callRow = {
      id: 'call-2',
      externalId: 'room-2',
      workspaceId: 'ws-1',
      channelId: 'chan-1',
      callUpdatesChannel: null,
      startedAt: ORIGINAL_STARTED, // schema default (schedule time) — must be corrected to `now`
      endedAt: null,
      metadata: {}, // no conversationId => first-join branch
    };
    const { tx, callUpdates } = makeTx(callRow);
    dbMock.$transaction.mockImplementation((cb: (t: unknown) => unknown) => cb(tx));

    const repo = new CallRepository();
    await repo.activateScheduledCall({
      call: callRow as never,
      initiatorName: 'Utkarsh',
      now: NOW,
    });

    expect(callUpdates).toHaveLength(1);
    const data = callUpdates[0].data;
    expect(data.status).toBe('ACTIVE');
    expect(data.startedAt).toBe(NOW);
  });
});
