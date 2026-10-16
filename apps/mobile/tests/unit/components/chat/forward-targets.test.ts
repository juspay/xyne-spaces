import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

import {
  MAX_FORWARD_RECIPIENTS,
  applyForwardSelection,
  buildForwardTargetItems,
  canAddMoreTargets,
  getForwardRecipientIds,
  getSelectionMode,
  type ForwardChannel,
  type ForwardTarget,
  type ForwardUser,
} from '@/src/components/chat/message-sheet/views/forward-targets';

const ME = 'u-me';
const users: ForwardUser[] = [
  { id: ME, name: 'Me Myself', email: 'me@x.in' },
  { id: 'u-asha', name: 'Asha', email: 'asha@x.in' },
  { id: 'u-ravi', name: 'Ravi', email: 'ravi@x.in' },
  { id: 'u-meera', name: 'Meera', email: 'meera@x.in' },
  { id: 'u-kiran', name: 'Kiran', email: 'kiran@x.in' },
];

const channel = (
  over: Partial<ForwardChannel> & Pick<ForwardChannel, 'id' | 'name'>,
): ForwardChannel => ({
  scopeType: ChannelScopeType.DEFAULT,
  visibility: ChannelVisibility.PUBLIC,
  isArchived: false,
  channelStats: { lastActivityAt: 0 },
  ...over,
});

const channels: ForwardChannel[] = [
  channel({ id: 'c-eng', name: 'engineering', channelStats: { lastActivityAt: 5 } }),
  channel({ id: 'c-old', name: 'archived-eng', isArchived: true }),
  channel({
    id: 'g-team',
    name: [ME, 'u-asha', 'u-ravi'].sort().join(','),
    scopeType: ChannelScopeType.GROUP_DM,
    visibility: ChannelVisibility.PRIVATE,
    channelStats: { lastActivityAt: 10 },
  }),
  channel({
    id: 'dm-meera',
    name: [ME, 'u-meera'].sort().join(','),
    scopeType: ChannelScopeType.DM,
    visibility: ChannelVisibility.PRIVATE,
    channelStats: { lastActivityAt: 20 },
  }),
];

const build = (query: string, selectedTargets: ForwardTarget[] = []) =>
  buildForwardTargetItems({ channels, users, currentUserId: ME, query, selectedTargets });

describe('forward targets (mobile parity with web)', () => {
  it('suggests recent DMs, group DMs and channels when nothing is typed', () => {
    const items = build('');
    assert.deepEqual(
      items.map(i => [i.type, i.id]),
      [
        ['user', 'u-meera'],
        ['group_dm', 'g-team'],
        ['channel', 'c-eng'],
      ],
    );
    const group = items.find(i => i.type === 'group_dm');
    assert.equal(group?.name, 'Asha, Ravi');
    assert.deepEqual(group?.memberIds?.sort(), ['u-asha', 'u-ravi']);
  });

  it('searches group DMs by member name and excludes archived channels', () => {
    assert.deepEqual(
      build('asha').map(i => [i.type, i.id]),
      [
        ['user', 'u-asha'],
        ['group_dm', 'g-team'],
      ],
    );
    assert.deepEqual(
      build('eng').map(i => i.id),
      ['c-eng'],
    );
  });

  it('offers self only as a solo pick, labelled (You)', () => {
    const self = build('myself').find(i => i.id === ME);
    assert.equal(self?.name, 'Me Myself (You)');
    const afterPick = build('myself', [{ type: 'user', id: 'u-asha', name: 'Asha' }]);
    assert.equal(
      afterPick.some(i => i.id === ME),
      false,
    );
  });

  it('picking a group DM replaces the selection and only allows adding users not in it', () => {
    const group = build('').find(i => i.type === 'group_dm')!;
    const selected = applyForwardSelection([{ type: 'user', id: 'u-kiran', name: 'Kiran' }], group);
    assert.equal(getSelectionMode(selected), 'group_dm');
    assert.equal(selected.length, 1);

    const suggestions = build('a', selected);
    assert.equal(
      suggestions.every(i => i.type === 'user'),
      true,
    );
    assert.equal(
      suggestions.some(i => i.id === 'u-asha' || i.id === 'u-ravi'),
      false,
    );

    const withExtra = applyForwardSelection(selected, {
      type: 'user',
      id: 'u-meera',
      name: 'Meera',
    });
    assert.deepEqual(getForwardRecipientIds(withExtra).sort(), ['u-asha', 'u-meera', 'u-ravi']);
  });

  it('a channel selection is exclusive and stops further suggestions', () => {
    const selected = applyForwardSelection([], {
      type: 'channel',
      id: 'c-eng',
      name: 'engineering',
    });
    assert.equal(getSelectionMode(selected), 'channel');
    assert.equal(canAddMoreTargets(selected), false);
    assert.deepEqual(build('a', selected), []);
    assert.deepEqual(getForwardRecipientIds(selected), []);
  });

  it(`caps recipients at ${MAX_FORWARD_RECIPIENTS}`, () => {
    let selected: ForwardTarget[] = [];
    for (let i = 0; i < MAX_FORWARD_RECIPIENTS + 2; i += 1) {
      selected = applyForwardSelection(selected, { type: 'user', id: `u-${i}`, name: `U${i}` });
    }
    assert.equal(selected.length, MAX_FORWARD_RECIPIENTS);
    assert.equal(canAddMoreTargets(selected), false);
    assert.deepEqual(build('u', selected), []);
  });
});
