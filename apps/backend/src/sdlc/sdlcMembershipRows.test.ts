// @xyne/shared ships as ESM dist/, which this CJS jest setup cannot load, so it is
// mocked here the same way src/zero/acl/tables/messages-acl.test.ts does. The value
// mirrors SDLC_MEMBERSHIP_RELATION in packages/shared/src/sdlc.ts.
jest.mock('@xyne/shared/sdlc', () => ({
  SDLC_MEMBERSHIP_RELATION: 'REPOSITORY',
  SDLC_TRACK_MEMBERSHIP_RELATION: 'TRACK',
}));

import {
  membershipRowsFor,
  trackMembershipRowsFor,
  type LegacySdlcHub,
} from './sdlcMembershipRows';

const hub = (over: Partial<LegacySdlcHub> = {}): LegacySdlcHub => ({
  id: 'repo-a',
  workspaceId: 'w1',
  channelId: 'chan-a',
  createdBy: 'user-1',
  ...over,
});

describe('membershipRowsFor', () => {
  it('turns a hub into a CHANNEL -> REPOSITORY edge', () => {
    expect(membershipRowsFor([hub()])).toEqual([
      {
        workspaceId: 'w1',
        channelId: 'chan-a',
        sourceType: 'CHANNEL',
        sourceId: 'chan-a',
        targetType: 'REPOSITORY',
        targetId: 'repo-a',
        relationType: 'REPOSITORY',
        createdBy: 'user-1',
      },
    ]);
  });

  it('names both ends of the edge', () => {
    // channelId repeats sourceId, and targetId is the only place the repository is
    // recorded. The unique guarding one membership row per (repo, channel) is keyed
    // on both, so these drifting apart would silently unguard it.
    const hubs = [hub(), hub({ id: 'repo-b', channelId: 'chan-b' })];
    for (const [index, row] of membershipRowsFor(hubs).entries()) {
      expect(row.sourceId).toBe(row.channelId);
      expect(row.targetId).toBe(hubs[index]!.id);
    }
  });

  it('carries each hub its own workspace and creator', () => {
    const rows = membershipRowsFor([
      hub(),
      hub({ id: 'repo-b', channelId: 'chan-b', workspaceId: 'w2', createdBy: 'user-2' }),
    ]);
    expect(rows.map(row => [row.workspaceId, row.createdBy])).toEqual([
      ['w1', 'user-1'],
      ['w2', 'user-2'],
    ]);
  });

  it('emits nothing when no hub is left to migrate', () => {
    expect(membershipRowsFor([])).toEqual([]);
  });
});

describe('trackMembershipRowsFor', () => {
  const track = (id: string) => ({ id, workspaceId: 'w1', createdBy: 'user-1' });

  it('turns a track into a CHANNEL -> TRACK edge', () => {
    expect(trackMembershipRowsFor('chan-a', [track('track-a')])).toEqual([
      {
        workspaceId: 'w1',
        channelId: 'chan-a',
        sourceType: 'CHANNEL',
        sourceId: 'chan-a',
        targetType: 'TRACK',
        targetId: 'track-a',
        relationType: 'TRACK',
        createdBy: 'user-1',
      },
    ]);
  });

  it('scopes every edge to the hub it was given', () => {
    // A track has no scope column, so this edge is the only thing placing it. If
    // channelId and sourceId ever drift apart the unique stops guarding it.
    const rows = trackMembershipRowsFor('chan-b', [track('track-a'), track('track-b')]);
    expect(rows.map(row => [row.channelId, row.sourceId])).toEqual([
      ['chan-b', 'chan-b'],
      ['chan-b', 'chan-b'],
    ]);
  });

  it('emits nothing for a hub with no tracks', () => {
    expect(trackMembershipRowsFor('chan-a', [])).toEqual([]);
  });
});
