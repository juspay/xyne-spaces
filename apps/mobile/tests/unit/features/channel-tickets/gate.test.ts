import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelScopeType, ChannelType } from '@xyne/shared';

import { canShowChannelTickets } from '@/src/features/channel-tickets/gate';

describe('canShowChannelTickets', () => {
  const regular = { scopeType: ChannelScopeType.DEFAULT, type: ChannelType.DEFAULT };

  it('shows for a regular channel when the user can read tickets', () => {
    assert.equal(canShowChannelTickets(regular, true), true);
  });

  it('hides without ticket read permission', () => {
    assert.equal(canShowChannelTickets(regular, false), false);
  });

  it('hides for DMs and group DMs', () => {
    assert.equal(
      canShowChannelTickets({ scopeType: ChannelScopeType.DM, type: ChannelType.DEFAULT }, true),
      false,
    );
    assert.equal(
      canShowChannelTickets(
        { scopeType: ChannelScopeType.GROUP_DM, type: ChannelType.DEFAULT },
        true,
      ),
      false,
    );
  });

  it('hides for desk channels (EMAIL / SLACK / APP)', () => {
    for (const type of [ChannelType.EMAIL, ChannelType.SLACK, ChannelType.APP]) {
      assert.equal(
        canShowChannelTickets({ scopeType: ChannelScopeType.DEFAULT, type }, true),
        false,
        type,
      );
    }
  });

  it('hides when the channel is not loaded yet', () => {
    assert.equal(canShowChannelTickets(undefined, true), false);
    assert.equal(canShowChannelTickets(null, true), false);
  });

  it('tolerates a channel with no type / scope (treated as a regular channel)', () => {
    assert.equal(canShowChannelTickets({}, true), true);
  });
});
