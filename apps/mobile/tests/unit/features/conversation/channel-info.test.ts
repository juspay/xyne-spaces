import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ChannelScopeType, NotificationLevel } from '@xyne/shared';

import {
  canPickSection,
  channelInfoActions,
  channelInfoContentRows,
  channelInfoSubtitle,
  createdLine,
  isChannelMuted,
  memberCountLabel,
  membersSummary,
  sectionLabel,
} from '@/src/features/conversation/model/channel-info';

describe('channelInfoSubtitle', () => {
  it('says what the room is and how many are in it', () => {
    assert.equal(channelInfoSubtitle('channel', false, 34), 'Channel · 34 members');
    assert.equal(channelInfoSubtitle('channel', true, 1), 'Private channel · 1 member');
    assert.equal(channelInfoSubtitle('group', false, 3), 'Group · 3 members');
  });

  it('drops the count before the members load, and has none for a person', () => {
    assert.equal(channelInfoSubtitle('channel', false, 0), 'Channel');
    assert.equal(channelInfoSubtitle('dm', false, 2), 'Direct message');
  });
});

describe('memberCountLabel', () => {
  it('uses the singular for one', () => {
    assert.equal(memberCountLabel(1), '1 member');
    assert.equal(memberCountLabel(5), '5 members');
  });
});

describe('membersSummary', () => {
  it('names two by first name, then counts the rest', () => {
    assert.equal(
      membersSummary(['Kunal Shah', 'Arjun Kapoor', 'Vina Rao'], 34),
      'Kunal, Arjun and 32 others',
    );
    assert.equal(membersSummary(['Kunal Shah', 'Arjun Kapoor'], 3), 'Kunal, Arjun and 1 other');
  });

  it('joins with "and" when everyone is named', () => {
    assert.equal(membersSummary(['Kunal Shah', 'Arjun Kapoor'], 2), 'Kunal and Arjun');
    assert.equal(membersSummary(['Kunal Shah'], 1), 'Kunal');
  });

  it('falls back to the count while names load', () => {
    assert.equal(membersSummary(['', '  '], 12), '12 members');
    assert.equal(membersSummary([], 1), '1 member');
  });
});

describe('createdLine', () => {
  // Built inside each test, as its other dates are: other test files pin TZ when they load.
  const now = (): Date => new Date(2026, 10, 24);

  it('gives the day, month and creator', () => {
    assert.equal(
      createdLine(new Date(2026, 1, 4).getTime(), 'Arjun Kapoor', now()),
      'Created 4 Feb by Arjun Kapoor',
    );
  });

  it('adds the year when it is not this one, and drops an unknown creator', () => {
    assert.equal(createdLine(new Date(2024, 11, 31).getTime(), null, now()), 'Created 31 Dec 2024');
    assert.equal(createdLine(new Date(2026, 0, 1).getTime(), '  ', now()), 'Created 1 Jan');
  });

  it('has nothing to say without a date', () => {
    assert.equal(createdLine(undefined, 'Arjun', now()), null);
    assert.equal(createdLine(0, 'Arjun', now()), null);
  });
});

describe('channelInfoActions', () => {
  it('keeps Figma order and gates Mute and Add', () => {
    assert.deepEqual(channelInfoActions({ canAddPeople: true, canMute: true }), [
      'search',
      'call',
      'mute',
      'add',
    ]);
    assert.deepEqual(channelInfoActions({ canAddPeople: false, canMute: false }), [
      'search',
      'call',
    ]);
  });
});

describe('channelInfoContentRows', () => {
  it('shows Tickets only where the gate allows', () => {
    assert.deepEqual(channelInfoContentRows(true), [
      'files',
      'tickets',
      'pinned',
      'canvas',
      'links',
    ]);
    assert.deepEqual(channelInfoContentRows(false), ['files', 'pinned', 'canvas', 'links']);
  });
});

describe('canPickSection', () => {
  it('is for members of real channels only', () => {
    assert.equal(canPickSection(ChannelScopeType.DEFAULT, true), true);
    assert.equal(canPickSection(ChannelScopeType.DEFAULT, false), false);
    assert.equal(canPickSection(ChannelScopeType.GROUP_DM, true), false);
    assert.equal(canPickSection(ChannelScopeType.DM, true), false);
  });
});

describe('sectionLabel', () => {
  const sections = [{ id: 's1', name: 'Checkout v2' }];

  it('names the section, or None', () => {
    assert.equal(sectionLabel(sections, 's1'), 'Checkout v2');
    assert.equal(sectionLabel(sections, null), 'None');
    assert.equal(sectionLabel(sections, 'gone'), 'None');
  });
});

describe('isChannelMuted', () => {
  it('is muted only when both deliveries are off', () => {
    assert.equal(
      isChannelMuted({
        desktopNotificationLevel: NotificationLevel.NONE,
        mobileNotificationLevel: NotificationLevel.NONE,
      }),
      true,
    );
    assert.equal(
      isChannelMuted({
        desktopNotificationLevel: NotificationLevel.NONE,
        mobileNotificationLevel: null,
      }),
      false,
    );
    assert.equal(isChannelMuted(null), false);
  });
});
