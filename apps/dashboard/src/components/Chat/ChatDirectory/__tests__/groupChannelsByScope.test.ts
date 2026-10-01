import { describe, expect, it } from 'vitest';
import { ChannelScopeType, ChannelType, type ChannelUserStatus } from '@xyne/shared';
import type { VisibleChannel } from '../../../../machines/stateMachine';
import { groupChannelsByScope } from '../ChatDirectory.utils';

const channel = (id: string, type: ChannelType, scopeType = ChannelScopeType.DEFAULT) =>
  ({ id, type, scopeType, name: id }) as unknown as VisibleChannel;

const status = (channelId: string, isStarred: boolean) =>
  ({ channelId, isStarred, isClosed: false }) as unknown as ChannelUserStatus;

const ids = (list: VisibleChannel[]) => list.map(c => c.id);

describe('groupChannelsByScope', () => {
  it('shows a starred SDLC channel under Starred', () => {
    const result = groupChannelsByScope(
      [channel('sdlc-1', ChannelType.SDLC)],
      [status('sdlc-1', true)],
    );
    expect(ids(result.starred)).toEqual(['sdlc-1']);
    expect(result.channels).toEqual([]);
    expect(result.directMessages).toEqual([]);
  });

  it('keeps an unstarred SDLC channel hidden from every group', () => {
    const result = groupChannelsByScope(
      [channel('sdlc-1', ChannelType.SDLC)],
      [status('sdlc-1', false)],
    );
    expect(result).toEqual({ starred: [], channels: [], directMessages: [] });
  });

  it('keeps an SDLC channel with no status row hidden', () => {
    const result = groupChannelsByScope([channel('sdlc-1', ChannelType.SDLC)], []);
    expect(result).toEqual({ starred: [], channels: [], directMessages: [] });
  });

  it('still routes regular channels by star state', () => {
    const result = groupChannelsByScope(
      [channel('a', ChannelType.DEFAULT), channel('b', ChannelType.DEFAULT)],
      [status('a', true), status('b', false)],
    );
    expect(ids(result.starred)).toEqual(['a']);
    expect(ids(result.channels)).toEqual(['b']);
  });
});
