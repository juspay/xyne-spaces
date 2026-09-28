import { db } from '@/database/client';
import { databaseFinder } from './adapters';

jest.mock('@/database/client', () => ({
  db: {
    user: { findMany: jest.fn() },
    channel: { findMany: jest.fn(), findFirst: jest.fn() },
  },
}));
jest.mock('@xyne/shared', () => ({
  GuestEntity: { CHANNEL: 'CHANNEL', CANVAS: 'CANVAS' },
  ChannelVisibility: { PUBLIC: 'PUBLIC' },
  CanvasVisibility: { PUBLIC: 'PUBLIC' },
}));
jest.mock('@/services/redisService', () => ({ redisService: {} }));
jest.mock('@/services/vespaSearch', () => ({ vespaService: {} }));

const userFindMany = db.user.findMany as jest.Mock;
const channelFindMany = db.channel.findMany as jest.Mock;
const channelFindFirst = db.channel.findFirst as jest.Mock;

describe('assistant record access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userFindMany.mockResolvedValue([]);
    channelFindMany.mockResolvedValue([]);
    channelFindFirst.mockResolvedValue(null);
  });

  it('scopes people lookups to the authenticated workspace', async () => {
    const finder = databaseFinder({ userId: 'caller', workspaceId: 'workspace-a', role: 'MEMBER' });

    await finder.find('person', 'Priya');

    const where = userFindMany.mock.calls[0]?.[0].where;
    expect(JSON.stringify(where)).toContain('"workspaceId":"workspace-a"');
    expect(JSON.stringify(where)).toContain('"id":{"not":"caller"}');
  });

  it('uses channel read ACLs for name search and on-screen resolution', async () => {
    const finder = databaseFinder({ userId: 'caller', workspaceId: 'workspace-a', role: 'MEMBER' });

    await finder.find('channel', 'android');
    await finder.get('channel', 'channel-1');

    for (const where of [
      channelFindMany.mock.calls[0]?.[0].where,
      channelFindFirst.mock.calls[0]?.[0].where,
    ]) {
      const serialized = JSON.stringify(where);
      expect(serialized).toContain('"workspaceId":"workspace-a"');
      expect(serialized).toContain('"visibility":"PUBLIC"');
      expect(serialized).toContain('"userId":"caller"');
    }
  });
});
