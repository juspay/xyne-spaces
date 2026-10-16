import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { channelScopeParams } from '@/src/features/xyne-ai/model/askAIParams';

describe('channelScopeParams', () => {
  it('scopes a channel by id and name', () => {
    assert.deepEqual(channelScopeParams({ id: 'c1', name: 'general', scopeType: 'DEFAULT' }), {
      channelId: 'c1',
      channelName: 'general',
    });
  });

  it('leaves DMs, group DMs and a missing channel unscoped, like the dashboard', () => {
    assert.deepEqual(channelScopeParams({ id: 'd1', name: 'Ann', scopeType: 'DM' }), {});
    assert.deepEqual(channelScopeParams({ id: 'g1', name: 'Ann, Bo', scopeType: 'GROUP_DM' }), {});
    assert.deepEqual(channelScopeParams(undefined), {});
  });
});
