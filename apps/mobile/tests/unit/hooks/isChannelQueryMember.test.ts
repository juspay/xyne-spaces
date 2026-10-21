import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelScopeType } from '@xyne/shared';

import { isChannelQueryMember } from '@/src/hooks/useJoinableChannel';

describe('isChannelQueryMember', () => {
  it('keeps an unloaded channel on the member path', () => {
    assert.equal(isChannelQueryMember(undefined, undefined), true);
  });

  it('keeps DMs on the member path before a status row exists', () => {
    assert.equal(
      isChannelQueryMember({ scopeType: ChannelScopeType.DM }, undefined),
      true,
    );
    assert.equal(
      isChannelQueryMember({ scopeType: ChannelScopeType.GROUP_DM }, undefined),
      true,
    );
  });

  it('reads a public channel the user has not joined on the public path', () => {
    assert.equal(
      isChannelQueryMember({ scopeType: ChannelScopeType.DEFAULT }, undefined),
      false,
    );
  });

  it('reads a joined channel on the member path', () => {
    assert.equal(
      isChannelQueryMember({ scopeType: ChannelScopeType.DEFAULT }, { channelId: 'c1' }),
      true,
    );
  });
});
