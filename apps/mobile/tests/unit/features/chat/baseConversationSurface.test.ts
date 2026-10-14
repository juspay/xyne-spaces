import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelScopeType } from '@xyne/shared';

import {
  getBaseConversationSurfacePath,
  resolveBaseConversationSurface,
} from '@/src/features/chat/baseConversationSurface';

describe('getBaseConversationSurfacePath', () => {
  it('maps dms to the dms tab route', () => {
    assert.equal(getBaseConversationSurfacePath('dms'), '/(protected)/(tabs)/dms');
  });

  it('maps channels to the channels tab route', () => {
    assert.equal(getBaseConversationSurfacePath('channels'), '/(protected)/(tabs)/channels');
  });
});

describe('resolveBaseConversationSurface', () => {
  it('returns the explicit surface regardless of scope type', () => {
    assert.equal(resolveBaseConversationSurface(ChannelScopeType.DM, 'channels'), 'channels');
    assert.equal(resolveBaseConversationSurface(ChannelScopeType.DEFAULT, 'dms'), 'dms');
  });

  it('resolves DM and GROUP_DM scopes to dms', () => {
    assert.equal(resolveBaseConversationSurface(ChannelScopeType.DM), 'dms');
    assert.equal(resolveBaseConversationSurface(ChannelScopeType.GROUP_DM), 'dms');
  });

  it('resolves other or unknown scopes to channels', () => {
    assert.equal(resolveBaseConversationSurface(ChannelScopeType.DEFAULT), 'channels');
    assert.equal(resolveBaseConversationSurface(ChannelScopeType.TICKET), 'channels');
    assert.equal(resolveBaseConversationSurface(undefined), 'channels');
    assert.equal(resolveBaseConversationSurface('SOMETHING_ELSE'), 'channels');
  });
});
