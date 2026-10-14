// Runtime behaviour of the 1:1 DM find-or-create used by createDM and
// user-send-message (recipientUserId). The DB client is mocked; the tests
// drive the transaction callback directly, so they assert what the repository
// actually does on a hit, a miss, and a serialization conflict.

// @xyne/shared ships ESM dist/, which this CJS jest setup cannot load.
jest.mock('@xyne/shared', () => ({
  SDLC_MEMBERSHIP_RELATION: 'member',
  VespaInsertionStatus: { FAILED: 'FAILED' },
  VespaOperationType: { INSERT: 'INSERT' },
  ChannelRole: { ADMIN: 'ADMIN', MEMBER: 'MEMBER' },
  ChannelScopeType: { DEFAULT: 'DEFAULT', DM: 'DM', GROUP_DM: 'GROUP_DM', TICKET: 'TICKET', DOCUMENT: 'DOCUMENT' },
  ChannelVisibility: { PUBLIC: 'PUBLIC', PRIVATE: 'PRIVATE' },
  ChannelType: { SDLC: 'SDLC' },
  ProjectType: { DM: 'DM' },
}));

const mockTransaction = jest.fn();
jest.mock('@/database/client', () => ({
  DatabaseClient: { getInstance: () => ({ $transaction: (...args: unknown[]) => mockTransaction(...args) }) },
  db: {},
}));
jest.mock('@/database/tenant/context', () => ({
  withWorkspaceScope: <T>(fn: () => T) => fn(),
}));
jest.mock('@/database/connectGroup', () => ({ newConnectId: () => 'connect_1' }));
const mockCreateChannelWithConnectGroup = jest.fn();
jest.mock('@/bypassAcl/transactions/connectGroupEntities', () => ({
  createChannelWithConnectGroupMaybeTx: (...args: unknown[]) => mockCreateChannelWithConnectGroup(...args),
  createChannelWithConnectGroupTx: jest.fn(),
}));
jest.mock('@/queues/vespaQueue', () => ({ vespaQueue: { addJob: jest.fn() } }));
jest.mock('@/vespa/src/types', () => ({ channelSchema: 'chat_container' }));
jest.mock('@/vespa/vespaConfig', () => ({ NAMESPACE: 'ns' }));
jest.mock('@/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { ChannelRepository } from './channelRepository';

type Tx = {
  channel: { findFirst: jest.Mock; findUniqueOrThrow: jest.Mock };
  board: { findMany: jest.Mock };
  channelBoardMapping: { createMany: jest.Mock };
};

const NEW_CHANNEL = { id: 'ch_new', name: 'user_a,user_b', scopeType: 'DM' };
const EXISTING_CHANNEL = { id: 'ch_old', name: 'user_a,user_b', scopeType: 'DM' };

function makeTx(existing: unknown = null): Tx {
  return {
    channel: {
      findFirst: jest.fn().mockResolvedValue(existing),
      findUniqueOrThrow: jest.fn().mockResolvedValue(NEW_CHANNEL),
    },
    board: { findMany: jest.fn().mockResolvedValue([{ id: 'board_1' }]) },
    channelBoardMapping: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
}

function serializationConflict() {
  return Object.assign(new Error('could not serialize access'), { code: 'P2034' });
}

describe('ChannelRepository.findOrCreateOneOnOneDMChannel', () => {
  const participants = { addParticipantInTransaction: jest.fn().mockResolvedValue({ added: true }) };
  const input = {
    // Deliberately unsorted: the canonical name is the sorted pair.
    userId: 'user_b',
    targetUserId: 'user_a',
    channelParticipants: participants as never,
    workspaceId: 'ws_1',
    projectId: 'proj_dm',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTransaction.mockReset();
    mockCreateChannelWithConnectGroup.mockResolvedValue({ id: NEW_CHANNEL.id });
  });

  it('reuses an existing DM without creating a channel or participants', async () => {
    const tx = makeTx(EXISTING_CHANNEL);
    mockTransaction.mockImplementation((run: (t: Tx) => unknown) => run(tx));

    const result = await new ChannelRepository().findOrCreateOneOnOneDMChannel(input);

    expect(result).toEqual({ channel: EXISTING_CHANNEL, isExisting: true });
    expect(tx.channel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: 'ws_1', scopeType: 'DM', name: 'user_a,user_b' },
    }));
    expect(mockCreateChannelWithConnectGroup).not.toHaveBeenCalled();
    expect(participants.addParticipantInTransaction).not.toHaveBeenCalled();
  });

  it('runs the probe and insert in one SERIALIZABLE transaction', async () => {
    mockTransaction.mockImplementation((run: (t: Tx) => unknown) => run(makeTx()));

    await new ChannelRepository().findOrCreateOneOnOneDMChannel(input);

    expect(mockTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('creates the channel with its connect_group row, board mapping and both participants in the same tx', async () => {
    const tx = makeTx();
    mockTransaction.mockImplementation((run: (t: Tx) => unknown) => run(tx));

    const result = await new ChannelRepository().findOrCreateOneOnOneDMChannel(input);

    expect(result).toEqual({ channel: NEW_CHANNEL, isExisting: false });
    expect(mockCreateChannelWithConnectGroup).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        scopeType: 'DM',
        name: 'user_a,user_b',
        visibility: 'PRIVATE',
        workspaceId: 'ws_1',
        projectId: 'proj_dm',
        connectId: 'connect_1',
      }),
      'ws_1',
      'connect_1',
    );
    expect(tx.channelBoardMapping.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ channelId: NEW_CHANNEL.id, boardId: 'board_1', isDefault: true })],
    }));
    expect(participants.addParticipantInTransaction).toHaveBeenCalledTimes(2);
    expect(participants.addParticipantInTransaction).toHaveBeenNthCalledWith(1, tx, NEW_CHANNEL.id, 'user_b', null, 'ADMIN', false);
    expect(participants.addParticipantInTransaction).toHaveBeenNthCalledWith(2, tx, NEW_CHANNEL.id, 'user_a', null, 'MEMBER', false);
  });

  it('retries a serialization conflict and returns the DM the concurrent winner created', async () => {
    mockTransaction
      .mockRejectedValueOnce(serializationConflict())
      .mockImplementationOnce((run: (t: Tx) => unknown) => run(makeTx(EXISTING_CHANNEL)));

    const result = await new ChannelRepository().findOrCreateOneOnOneDMChannel(input);

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ channel: EXISTING_CHANNEL, isExisting: true });
    expect(mockCreateChannelWithConnectGroup).not.toHaveBeenCalled();
  });

  it('gives up after three serialization conflicts', async () => {
    mockTransaction.mockRejectedValue(serializationConflict());

    await expect(new ChannelRepository().findOrCreateOneOnOneDMChannel(input)).rejects.toMatchObject({ code: 'P2034' });
    expect(mockTransaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-serialization errors', async () => {
    mockTransaction.mockRejectedValue(new Error('connection reset'));

    await expect(new ChannelRepository().findOrCreateOneOnOneDMChannel(input)).rejects.toThrow('connection reset');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });
});
