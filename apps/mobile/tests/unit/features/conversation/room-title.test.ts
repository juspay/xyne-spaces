import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelScopeType } from '@xyne/shared';

import {
  composerPlaceholder,
  roomKindOf,
  roomTitle,
} from '@/src/features/conversation/model/room-title';

describe('roomTitle', () => {
  it('prefixes a channel with #', () => {
    assert.equal(roomTitle('design', 'channel'), '#design');
  });

  it('leaves people and group chats as their name', () => {
    assert.equal(roomTitle('Ravi Shah', 'dm'), 'Ravi Shah');
    assert.equal(roomTitle('Ravi, Asha', 'group'), 'Ravi, Asha');
  });
});

describe('roomKindOf', () => {
  it('maps channel scope types to a room kind', () => {
    assert.equal(roomKindOf(ChannelScopeType.DM), 'dm');
    assert.equal(roomKindOf(ChannelScopeType.GROUP_DM), 'group');
    assert.equal(roomKindOf(ChannelScopeType.DEFAULT), 'channel');
    assert.equal(roomKindOf(undefined), 'channel');
  });
});

describe('composerPlaceholder', () => {
  it('names the room being written to', () => {
    assert.equal(composerPlaceholder('design', 'channel'), 'Message #design');
    assert.equal(composerPlaceholder('Ravi Shah', 'dm'), 'Message Ravi');
    assert.equal(composerPlaceholder('Ravi Shah, Priya', 'group'), 'Message Ravi Shah, Priya');
    assert.equal(composerPlaceholder('', 'dm'), 'Message ');
  });
});
