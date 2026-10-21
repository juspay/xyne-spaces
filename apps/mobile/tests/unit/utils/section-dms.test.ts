import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelScopeType, ChannelType } from '@xyne/shared';
import {
  selectSectionableDms,
  selectSectionedDms,
} from '@/src/components/chat/channel-list/section-dms';

type Candidate = {
  id: string;
  type?: ChannelType;
  scopeType: ChannelScopeType;
  channelStats?: { lastActivityAt?: number };
};

const mk = (
  id: string,
  scopeType: ChannelScopeType,
  lastActivityAt = 0,
  type: ChannelType = ChannelType.DEFAULT,
): Candidate => ({ id, scopeType, type, channelStats: { lastActivityAt } });

const status = (
  channelId: string,
  overrides: { isClosed?: boolean; sectionId?: string | null } = {},
) => ({ channelId, isClosed: false, sectionId: null, ...overrides });

describe('selectSectionableDms', () => {
  it('offers DMs and group DMs, never channels', () => {
    const result = selectSectionableDms(
      [
        mk('channel', ChannelScopeType.DEFAULT),
        mk('dm', ChannelScopeType.DM),
        mk('group', ChannelScopeType.GROUP_DM),
      ],
      [],
    );
    assert.deepEqual(result.map(c => c.id).sort(), ['dm', 'group']);
  });

  it('leaves out closed DMs and email channels', () => {
    const result = selectSectionableDms(
      [
        mk('open', ChannelScopeType.DM),
        mk('closed', ChannelScopeType.DM),
        mk('email', ChannelScopeType.DM, 0, ChannelType.EMAIL),
      ],
      [status('closed', { isClosed: true })],
    );
    assert.deepEqual(
      result.map(c => c.id),
      ['open'],
    );
  });

  it('orders freshest first', () => {
    const result = selectSectionableDms(
      [mk('old', ChannelScopeType.DM, 1), mk('new', ChannelScopeType.DM, 5)],
      [],
    );
    assert.deepEqual(
      result.map(c => c.id),
      ['new', 'old'],
    );
  });
});

describe('selectSectionedDms', () => {
  const channels = [
    mk('in-section', ChannelScopeType.DM),
    mk('group-in-section', ChannelScopeType.GROUP_DM),
    mk('no-section', ChannelScopeType.DM),
    mk('deleted-section', ChannelScopeType.DM),
    mk('closed', ChannelScopeType.DM),
    mk('channel', ChannelScopeType.DEFAULT),
  ];
  const statuses = [
    status('in-section', { sectionId: 's1' }),
    status('group-in-section', { sectionId: 's1' }),
    status('deleted-section', { sectionId: 'gone' }),
    status('closed', { sectionId: 's1', isClosed: true }),
    status('channel', { sectionId: 's1' }),
  ];

  it('returns only open DMs whose section still exists', () => {
    const result = selectSectionedDms(channels, statuses, [{ id: 's1' }]);
    assert.deepEqual(result.map(c => c.id).sort(), ['group-in-section', 'in-section']);
  });

  it('returns nothing when the user has no sections', () => {
    assert.deepEqual(selectSectionedDms(channels, statuses, []), []);
  });
});
