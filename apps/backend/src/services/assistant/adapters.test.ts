import { db } from '@/database/client';
import { databaseFinder } from './adapters';
import { matchName } from './records';

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

  it('offers bounded name candidates across people and agents when one word was misheard', async () => {
    userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'agent-xyne',
        name: 'Xyne Doctor',
        displayName: null,
        email: 'xyne-doctor@app.test',
        userType: 'BOT',
      },
      {
        id: 'user-zara',
        name: 'Zara Doctor',
        displayName: null,
        email: 'zara@example.test',
        userType: 'USER',
      },
    ]);
    const finder = databaseFinder({ userId: 'caller', workspaceId: 'workspace-a', role: 'MEMBER' });

    const found = await finder.find('person', 'Zahn Doctor');

    expect(userFindMany).toHaveBeenCalledTimes(2);
    const fallback = userFindMany.mock.calls[1]?.[0].where.AND[0].OR[0].AND;
    expect(fallback).toHaveLength(2);
    expect(JSON.stringify(fallback[0])).toContain('"startsWith":"x"');
    expect(JSON.stringify(fallback[0])).toContain('"startsWith":"z"');
    expect(JSON.stringify(fallback[1])).toContain('"contains":"doctor"');
    expect(found).toEqual([
      {
        record: { kind: 'person', id: 'agent-xyne', name: 'Xyne Doctor' },
        detail: 'Agent',
      },
      {
        record: { kind: 'person', id: 'user-zara', name: 'Zara Doctor' },
        detail: 'zara@example.test',
      },
    ]);
    expect(matchName('Zahn Doctor', found)).toMatchObject({ kind: 'several' });
  });

  it('searches the matching X/Z initial when speech changes how a name sounds', async () => {
    userFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'agent-xyne',
        name: 'Xyne Doctor',
        displayName: null,
        email: 'xyne-doctor@app.test',
        userType: 'BOT',
      },
    ]);
    const finder = databaseFinder({ userId: 'caller', workspaceId: 'workspace-a', role: 'MEMBER' });

    const found = await finder.find('person', 'Zyne');

    expect(JSON.stringify(userFindMany.mock.calls[1]?.[0].where)).toContain('"startsWith":"x"');
    expect(matchName('Zyne', found)).toMatchObject({
      kind: 'one',
      certain: false,
      record: { id: 'agent-xyne' },
    });
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
