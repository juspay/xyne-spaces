import test from 'node:test';
import assert from 'node:assert/strict';

import { searchMentionableChannels } from '../dist/utils/channelMentionSearch.js';

const channel = (id, name, scopeType = 'DEFAULT') => ({ id, name, scopeType });

test('returns exact, prefix, partial and typo-tolerant channel matches', () => {
  const channels = [
    channel('feedback', 'xyne-spaces-feedback'),
    channel('feed', 'feedback-triage'),
    channel('backend', 'backend-platform'),
  ];

  assert.equal(
    searchMentionableChannels(channels, 'xyne-spaces-feedback')[0]?.id,
    'feedback',
  );
  assert.equal(searchMentionableChannels(channels, 'feed')[0]?.id, 'feed');
  assert.equal(
    searchMentionableChannels(channels, 'spaces feedback')[0]?.id,
    'feedback',
  );
  assert.equal(
    searchMentionableChannels(channels, 'xyne feedjback')[0]?.id,
    'feedback',
  );
});

test('filters non-mentionable scopes before applying the result limit', () => {
  const channels = [
    channel('dm', 'target-dm', 'DM'),
    channel('group', 'target-group', 'GROUP_DM'),
    channel('ticket', 'target-ticket', 'TICKET'),
    channel('document', 'target-document', 'DOCUMENT'),
    channel('default', 'target-channel'),
  ];

  assert.deepEqual(
    searchMentionableChannels(channels, 'target', 1).map((result) => result.id),
    ['default'],
  );
});

test('keeps accessible private default channels eligible', () => {
  const privateChannel = {
    ...channel('private', 'private-planning'),
    visibility: 'PRIVATE',
  };

  assert.deepEqual(searchMentionableChannels([privateChannel], 'planning'), [
    privateChannel,
  ]);
});

test('preserves input order for an empty query after eligibility filtering', () => {
  const channels = [
    channel('dm', 'direct', 'DM'),
    channel('second', 'second-channel'),
    channel('first', 'first-channel'),
  ];

  assert.deepEqual(
    searchMentionableChannels(channels, '', 2).map((result) => result.id),
    ['second', 'first'],
  );
});

test('returns no result for an unrelated query', () => {
  assert.deepEqual(
    searchMentionableChannels(
      [channel('feedback', 'xyne-spaces-feedback')],
      'payroll',
    ),
    [],
  );
});
