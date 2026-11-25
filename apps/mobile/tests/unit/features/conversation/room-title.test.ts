import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelScopeType } from '@xyne/shared';

import {
  composerPlaceholder,
  isSelfDmName,
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

  it('drops the "#" for a private channel, whose lock stands in for it', () => {
    assert.equal(roomTitle('payroll', 'channel', true), 'payroll');
    assert.equal(composerPlaceholder('payroll', 'channel', { isPrivate: true }), 'Message payroll');
  });

  it('does not address you by name in your own DM', () => {
    assert.equal(
      composerPlaceholder('Tom Alvarez', 'dm', { isSelfDm: true }),
      'Jot something down',
    );
  });
});

describe('isSelfDmName', () => {
  it('is true only when the DM lists just you', () => {
    assert.equal(isSelfDmName('u1', 'u1'), true);
    assert.equal(isSelfDmName(' u1 , ', 'u1'), true);
    assert.equal(isSelfDmName('u1,u2', 'u1'), false);
    assert.equal(isSelfDmName('u10', 'u1'), false);
    assert.equal(isSelfDmName(null, 'u1'), false);
  });
});
