import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getActivityActionText,
  getActivityDescription,
  getActivityIconType,
  getActivityPreviewSegmentsFromHtml,
  getChannelName,
  truncateChannelNameForActivity,
} from '@/src/components/activity/activity-item/activity-item.utils';

// Derive the parameter type without importing the RN-tainted activity types module.
type Activity = Parameters<typeof getActivityIconType>[0];
const activity = (partial: Record<string, unknown>): Activity => partial as unknown as Activity;

describe('getActivityIconType', () => {
  const cases: Array<[string, string]> = [
    ['mentioned_user', 'mention'],
    ['group_mention', 'mention'],
    ['replied', 'reply'],
    ['replied_v2', 'reply'],
    ['added', 'reaction'],
    ['removed_v2', 'reaction'],
    ['direct_message', 'message'],
    ['eta_breach', 'warning'],
    ['stage_eta_breach', 'warning'],
    ['ticket_status', 'ticket'],
    ['ticket_board', 'ticket'],
    ['something_unknown', 'default'],
  ];

  for (const [action, icon] of cases) {
    it(`maps ${action} -> ${icon}`, () => {
      assert.equal(getActivityIconType(activity({ actorAction: action })), icon);
    });
  }
});

describe('getActivityActionText', () => {
  it('returns fixed phrases for common actions', () => {
    assert.equal(
      getActivityActionText(activity({ actorAction: 'mentioned_user' })),
      ' mentioned you',
    );
    assert.equal(getActivityActionText(activity({ actorAction: 'replied' })), ' replied');
    assert.equal(
      getActivityActionText(activity({ actorAction: 'ticket_status' })),
      ' updated ticket status',
    );
  });

  it('treats a direct_message as a mention only when the content mentions the current user', () => {
    const dm = activity({
      actorAction: 'direct_message',
      message: { content: 'hey <span data-user-id="U1">you</span>' },
    });
    assert.equal(getActivityActionText(dm, 'U1'), ' mentioned you');
    assert.equal(getActivityActionText(dm, 'U2'), ' replied');
    assert.equal(getActivityActionText(dm), ' replied');
  });

  it('returns an empty string for unknown actions', () => {
    assert.equal(getActivityActionText(activity({ actorAction: 'noop' })), '');
  });
});

describe('getActivityDescription', () => {
  it('extracts the text field from JSON content', () => {
    assert.equal(
      getActivityDescription(activity({ message: { content: '{"text":"hello there"}' } })),
      'hello there',
    );
  });

  it('truncates long plain-text content to 100 chars + ellipsis', () => {
    const long = 'x'.repeat(150);
    const out = getActivityDescription(activity({ message: { content: long } }));
    assert.equal(out, 'x'.repeat(100) + '...');
  });

  it('falls back to ticket title, then canvas title, then empty', () => {
    assert.equal(getActivityDescription(activity({ ticket: { title: 'My Ticket' } })), 'My Ticket');
    assert.equal(getActivityDescription(activity({ canvas: { title: 'My Canvas' } })), 'My Canvas');
    assert.equal(getActivityDescription(activity({})), '');
  });
});

describe('getChannelName', () => {
  it('returns the name or empty string', () => {
    assert.equal(getChannelName({ name: 'general' }), 'general');
    assert.equal(getChannelName({ name: null }), '');
    assert.equal(getChannelName(null), '');
    assert.equal(getChannelName(undefined), '');
  });
});

describe('truncateChannelNameForActivity', () => {
  it('returns empty string for empty input', () => {
    assert.equal(truncateChannelNameForActivity(''), '');
    assert.equal(truncateChannelNameForActivity(null), '');
  });

  it('prefixes with # and keeps up to two names', () => {
    assert.equal(truncateChannelNameForActivity('general'), '#general');
    assert.equal(truncateChannelNameForActivity('alice, bob'), '#alice, bob');
  });

  it('strips an existing leading # before re-prefixing', () => {
    assert.equal(truncateChannelNameForActivity('#general'), '#general');
  });

  it('collapses 3+ names into "and N others"', () => {
    assert.equal(truncateChannelNameForActivity('alice, bob, carol'), '#alice, bob and 1 others');
    assert.equal(truncateChannelNameForActivity('a, b, c, d, e'), '#a, b and 3 others');
  });
});

describe('getActivityPreviewSegmentsFromHtml', () => {
  it('returns an empty array for empty/blank/null input', () => {
    assert.deepEqual(getActivityPreviewSegmentsFromHtml(''), []);
    assert.deepEqual(getActivityPreviewSegmentsFromHtml('   '), []);
    assert.deepEqual(getActivityPreviewSegmentsFromHtml(null), []);
    assert.deepEqual(getActivityPreviewSegmentsFromHtml(undefined), []);
  });

  it('returns a single text segment for plain content', () => {
    const segs = getActivityPreviewSegmentsFromHtml('hello world');
    assert.deepEqual(segs, [{ type: 'text', text: 'hello world' }]);
  });

  it('extracts a user mention span with an @ prefix', () => {
    const segs = getActivityPreviewSegmentsFromHtml(
      '<span data-user-id="U1" data-mention-type="user">John</span> hi',
    );
    assert.equal(segs[0]?.type, 'userMention');
    assert.deepEqual(segs[0], { type: 'userMention', userId: 'U1', label: '@John' });
    assert.equal(segs[1]?.type, 'text');
  });

  it('extracts a channel mention span with a # prefix', () => {
    const segs = getActivityPreviewSegmentsFromHtml(
      'see <span data-channel-mention data-channel-id="C1">general</span>',
    );
    const channel = segs.find(s => s.type === 'channelMention');
    assert.deepEqual(channel, { type: 'channelMention', channelId: 'C1', label: '#general' });
  });

  it('promotes bare @here / @channel tokens in plain text to special mentions', () => {
    const segs = getActivityPreviewSegmentsFromHtml('hey @here now');
    const special = segs.find(s => s.type === 'specialMention');
    assert.ok(special);
    assert.equal(special.type === 'specialMention' && special.special, 'here');
  });

  it('decodes basic HTML entities in plain text', () => {
    const segs = getActivityPreviewSegmentsFromHtml('a &amp; b &lt;c&gt;');
    assert.deepEqual(segs, [{ type: 'text', text: 'a & b <c>' }]);
  });
});
