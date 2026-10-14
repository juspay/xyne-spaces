import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

import {
  buildChannelMentionAttributes,
  buildGroupMentionAttributes,
  buildSpecialMentionAttributes,
  buildUserMentionAttributes,
  closeMentionPicker,
  toMentionChannels,
  toMentionItems,
  type MentionChannelOption,
  type MentionUserOption,
} from '@/src/components/input-composer/utils/mentions';

const channel = (over: Partial<Parameters<typeof toMentionChannels>[0][number]> = {}) => ({
  id: over.id ?? 'c1',
  name: over.name ?? 'General',
  scopeType: over.scopeType ?? ChannelScopeType.DEFAULT,
  visibility: over.visibility ?? ChannelVisibility.PUBLIC,
});

describe('toMentionChannels', () => {
  it('keeps only DEFAULT-scope channels and maps them', () => {
    const result = toMentionChannels(
      [
        channel({ id: 'a', name: 'Alpha' }),
        channel({ id: 'b', name: 'Beta', scopeType: ChannelScopeType.DM }),
      ],
      '',
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'a');
    assert.equal(result[0]?.type, 'channel');
  });

  it('marks private channels', () => {
    const result = toMentionChannels(
      [channel({ id: 'a', name: 'Secret', visibility: ChannelVisibility.PRIVATE })],
      '',
    );
    assert.equal(result[0]?.isPrivate, true);
  });

  it('falls back to Unknown for a null name', () => {
    const result = toMentionChannels(
      [
        {
          id: 'a',
          name: null,
          scopeType: ChannelScopeType.DEFAULT,
          visibility: ChannelVisibility.PUBLIC,
        },
      ],
      '',
    );
    assert.equal(result[0]?.name, 'Unknown');
  });

  it('filters by the normalized (lowercased) query', () => {
    const result = toMentionChannels(
      [channel({ id: 'a', name: 'Engineering' }), channel({ id: 'b', name: 'Design' })],
      'eng',
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, 'a');
  });

  it('caps the result at 10 items', () => {
    const channels = Array.from({ length: 12 }, (_, i) =>
      channel({ id: `c${i}`, name: `Ch ${i}` }),
    );
    assert.equal(toMentionChannels(channels, '').length, 10);
  });
});

describe('toMentionItems', () => {
  const users: MentionUserOption[] = [{ id: 'u1', name: 'Alice', type: 'user' }];
  const channels: MentionChannelOption[] = [{ id: 'c1', name: 'General', type: 'channel' }];

  it('returns channels in # mode', () => {
    assert.deepEqual(toMentionItems('#', users, channels), channels);
  });

  it('returns users in @ mode', () => {
    assert.deepEqual(toMentionItems('@', users, channels), users);
  });
});

describe('closeMentionPicker', () => {
  it('closes the picker and clears the query', () => {
    let open = true;
    let query = 'abc';
    closeMentionPicker(
      v => {
        open = v;
      },
      q => {
        query = q;
      },
    );
    assert.equal(open, false);
    assert.equal(query, '');
  });
});

describe('mention attribute builders', () => {
  it('builds special mention attributes', () => {
    assert.deepEqual(buildSpecialMentionAttributes('here'), { 'data-mention-type': 'here' });
  });

  it('builds group mention attributes with fallbacks', () => {
    const group: MentionUserOption = { id: 'g1', name: 'Team', type: 'group' };
    assert.deepEqual(buildGroupMentionAttributes(group), {
      'data-mention-type': 'group',
      'data-group-id': 'g1',
      'data-group-name': 'Team',
      'data-group-alias': '',
      'data-description': '',
      'data-member-count': '0',
    });
  });

  it('builds user mention attributes with fallbacks', () => {
    const user: MentionUserOption = { id: 'u1', name: 'Alice', type: 'user' };
    assert.deepEqual(buildUserMentionAttributes(user), {
      'data-user-id': 'u1',
      'data-username': 'Alice',
      'data-user-email': '',
      'data-user-picture': '',
      'data-mention-type': 'user',
    });
  });

  it('builds channel mention attributes and stringifies privacy', () => {
    const publicChannel: MentionChannelOption = { id: 'c1', name: 'General', type: 'channel' };
    assert.deepEqual(buildChannelMentionAttributes(publicChannel), {
      'data-channel-id': 'c1',
      'data-channel-name': 'General',
      'data-is-private': 'false',
    });
    assert.equal(
      buildChannelMentionAttributes({ id: 'c2', name: 'Secret', type: 'channel', isPrivate: true })[
        'data-is-private'
      ],
      'true',
    );
  });
});
