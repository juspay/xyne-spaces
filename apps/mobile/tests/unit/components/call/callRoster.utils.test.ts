import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CallOrigin, ChannelScopeType, ChannelType } from '@xyne/shared';

import { isBroadcastChannelCall } from '@/src/components/call/callRoster.utils';

describe('isBroadcastChannelCall', () => {
  it('treats a whole-channel call in a normal channel as broadcast', () => {
    const channel = { scopeType: ChannelScopeType.DEFAULT, type: ChannelType.DEFAULT };
    assert.equal(isBroadcastChannelCall(channel, CallOrigin.CHANNEL), true);
  });

  it('does not treat an SDLC hub call as broadcast', () => {
    const channel = { scopeType: ChannelScopeType.DEFAULT, type: ChannelType.SDLC };
    assert.equal(isBroadcastChannelCall(channel, CallOrigin.CHANNEL), false);
  });

  it('does not treat a thread call as broadcast', () => {
    const channel = { scopeType: ChannelScopeType.DEFAULT, type: ChannelType.DEFAULT };
    assert.equal(isBroadcastChannelCall(channel, CallOrigin.CONVERSATION), false);
  });
});
