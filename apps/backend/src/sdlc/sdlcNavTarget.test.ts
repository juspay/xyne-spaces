// @xyne/shared ships as ESM dist/, which this CJS jest setup cannot load, so both
// entry points are mocked the same way src/sdlc/sdlcMembershipRows.test.ts does.
jest.mock('@xyne/shared', () => ({ ChannelType: { SDLC: 'SDLC' } }));
jest.mock('@xyne/shared/sdlc', () => ({ sdlcSectionForCanvas: () => ({ section: 'docs' }) }));

const mockChannelFindUnique = jest.fn();
const mockTicketFindUnique = jest.fn();
const mockTicketFindFirst = jest.fn();
const mockResolveInheritedOwner = jest.fn();
const mockIsTrackInChannel = jest.fn();

jest.mock('@/database/client', () => ({
  db: {
    channel: { findUnique: (...args: unknown[]) => mockChannelFindUnique(...args) },
    canvas: { findUnique: jest.fn() },
    ticket: {
      findUnique: (...args: unknown[]) => mockTicketFindUnique(...args),
      findFirst: (...args: unknown[]) => mockTicketFindFirst(...args),
    },
  },
}));
jest.mock('@/database/tenant/context', () => ({
  runAsSystem: <T>(run: () => Promise<T>) => run(),
}));
jest.mock('./entityLinkService', () => ({
  resolveInheritedOwner: (...args: unknown[]) => mockResolveInheritedOwner(...args),
  resolveItemTrackId: jest.fn(),
  resolveFolderTrackId: jest.fn(),
}));
jest.mock('./sdlcChannelMembership', () => ({
  isTrackInChannel: (...args: unknown[]) => mockIsTrackInChannel(...args),
}));

import { resolveSdlcNavTarget } from './sdlcNavTarget';

// Ids are memoized per entity for 60s, so every case uses its own.
beforeEach(() => {
  jest.clearAllMocks();
  mockChannelFindUnique.mockResolvedValue({ type: 'SDLC' });
});

describe('resolveSdlcNavTarget', () => {
  it('drops a conversation owned by another hub', async () => {
    mockResolveInheritedOwner.mockResolvedValue({ sourceType: 'TRACK', sourceId: 'track-b' });
    mockIsTrackInChannel.mockResolvedValue(false);

    await expect(
      resolveSdlcNavTarget({ channelId: 'hub-a', conversationId: 'conv-1' })
    ).resolves.toBeNull();
  });

  it('returns the target when the conversation is in the named hub', async () => {
    mockResolveInheritedOwner.mockResolvedValue({ sourceType: 'TRACK', sourceId: 'track-b2' });
    mockIsTrackInChannel.mockResolvedValue(true);

    await expect(
      resolveSdlcNavTarget({ channelId: 'hub-b', conversationId: 'conv-2', messageId: 'msg-2' })
    ).resolves.toEqual({
      channelId: 'hub-b',
      section: 'tracks',
      trackId: 'track-b2',
      conversationId: 'conv-2',
      messageId: 'msg-2',
    });
  });

  it('drops the ticket fallback when the ticket is in another hub', async () => {
    mockResolveInheritedOwner.mockResolvedValue(null);
    mockTicketFindFirst.mockResolvedValue({ id: 'ticket-b' });
    mockTicketFindUnique.mockResolvedValue({ channelId: 'hub-b' });

    await expect(
      resolveSdlcNavTarget({ channelId: 'hub-a', conversationId: 'conv-3' })
    ).resolves.toBeNull();
  });
});
