import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  MentionChannelOption,
  MentionUserOption,
} from '@/src/components/input-composer/utils/mentions';
import {
  MENTIONS_CARD_GAP,
  MENTIONS_CARD_MAX_ROWS,
  MENTIONS_CARD_MAX_SHARE,
  MENTIONS_CARD_PADDING,
  MENTIONS_CARD_ROW_HEIGHT,
  MENTIONS_CARD_SIDE_INSET,
} from '@/src/features/conversation/constants';
import {
  mentionAccessibilityLabel,
  mentionLeading,
  mentionSubtitle,
  mentionTitle,
  mentionsCardAnnouncement,
  mentionsCardEmptyLabel,
  mentionsCardListHeight,
  mentionsCardPlacement,
  sameWindowRect,
  splitTitleMatch,
} from '@/src/features/conversation/model/mentions-card';

const USER: MentionUserOption = { id: 'u1', name: 'Jane Doe', type: 'user', email: 'jane@x.io' };
const GROUP: MentionUserOption = {
  id: 'g1',
  name: 'design-team',
  alias: 'design',
  type: 'group',
  description: 'Designers',
};
const EVERYONE: MentionUserOption = {
  id: 'channel',
  name: 'channel',
  type: 'special',
  mentionType: 'channel',
  description: 'Notify everyone in this channel',
};
const HERE: MentionUserOption = { id: 'here', name: 'here', type: 'special', mentionType: 'here' };
const CHANNEL: MentionChannelOption = { id: 'c1', name: 'general', type: 'channel' };
const PRIVATE: MentionChannelOption = { id: 'c2', name: 'ops', type: 'channel', isPrivate: true };

describe('mentionLeading', () => {
  it('gives people their face and everything else an icon', () => {
    assert.equal(mentionLeading(USER), 'avatar');
    assert.equal(mentionLeading(GROUP), 'group');
    assert.equal(mentionLeading(EVERYONE), 'everyone');
    assert.equal(mentionLeading(HERE), 'here');
    assert.equal(mentionLeading(CHANNEL), 'channel');
    assert.equal(mentionLeading(PRIVATE), 'privateChannel');
  });
});

describe('mentionTitle', () => {
  it('words each kind as the classic list does', () => {
    assert.equal(mentionTitle(USER), 'Jane Doe');
    assert.equal(mentionTitle(GROUP), '@design');
    assert.equal(mentionTitle({ ...GROUP, alias: '' }), '@design-team');
    assert.equal(mentionTitle(EVERYONE), '@channel');
    assert.equal(mentionTitle(CHANNEL), '#general');
  });
});

describe('mentionSubtitle', () => {
  it('is the email for a person and the description for a group or special', () => {
    assert.equal(mentionSubtitle(USER), 'jane@x.io');
    assert.equal(mentionSubtitle(GROUP), 'Designers');
    assert.equal(mentionSubtitle(EVERYONE), 'Notify everyone in this channel');
  });

  it('is absent when there is nothing to say', () => {
    assert.equal(mentionSubtitle(HERE), null);
    assert.equal(mentionSubtitle({ ...USER, email: '' }), null);
    assert.equal(mentionSubtitle(CHANNEL), null);
  });
});

describe('mentionAccessibilityLabel', () => {
  it('reads the name, then the subtitle when there is one', () => {
    assert.equal(mentionAccessibilityLabel(USER), 'Jane Doe, jane@x.io');
    assert.equal(mentionAccessibilityLabel(CHANNEL), '#general');
  });
});

describe('splitTitleMatch', () => {
  it('cuts around the first case-insensitive match, keeping the title’s own case', () => {
    assert.deepEqual(splitTitleMatch('Jane Doe', 'doe'), {
      before: 'Jane ',
      match: 'Doe',
      after: '',
    });
    assert.deepEqual(splitTitleMatch('@design', 'DES'), {
      before: '@',
      match: 'des',
      after: 'ign',
    });
  });

  it('leaves the title whole for an empty or unmatched query', () => {
    const whole = { before: 'Jane Doe', match: '', after: '' };
    assert.deepEqual(splitTitleMatch('Jane Doe', ''), whole);
    assert.deepEqual(splitTitleMatch('Jane Doe', '   '), whole);
    assert.deepEqual(splitTitleMatch('Jane Doe', 'zed'), whole);
  });

  it('ignores the spaces around the query', () => {
    assert.equal(splitTitleMatch('Jane Doe', ' jan ').match, 'Jan');
  });
});

describe('mentionsCardAnnouncement', () => {
  it('counts the results', () => {
    assert.equal(mentionsCardAnnouncement(1, false), '1 suggestion');
    assert.equal(mentionsCardAnnouncement(3, false), '3 suggestions');
    assert.equal(mentionsCardAnnouncement(2, true), '2 channels');
  });

  it('says the empty label when nothing matches', () => {
    assert.equal(mentionsCardAnnouncement(0, false), mentionsCardEmptyLabel(false));
    assert.equal(mentionsCardEmptyLabel(false), 'No matches');
    assert.equal(mentionsCardEmptyLabel(true), 'No channels');
  });
});

describe('mentionsCardListHeight', () => {
  const ROOMY = 1000;

  it('fits a few rows exactly', () => {
    assert.equal(mentionsCardListHeight(2, ROOMY), 2 * MENTIONS_CARD_ROW_HEIGHT);
  });

  it('gives the empty state one row', () => {
    assert.equal(mentionsCardListHeight(0, ROOMY), MENTIONS_CARD_ROW_HEIGHT);
  });

  it('stops at four and a half rows', () => {
    assert.equal(
      mentionsCardListHeight(10, ROOMY),
      MENTIONS_CARD_MAX_ROWS * MENTIONS_CARD_ROW_HEIGHT,
    );
  });

  it('keeps within the card’s height, less its padding', () => {
    assert.equal(mentionsCardListHeight(10, 180), 180 - MENTIONS_CARD_PADDING * 2);
  });

  it('never drops below one row', () => {
    assert.equal(mentionsCardListHeight(10, 20), MENTIONS_CARD_ROW_HEIGHT);
  });
});

describe('mentionsCardPlacement', () => {
  const bar = { x: 10, y: 600, width: 355, height: 58 };

  it('floats the gap above the bar, inside its side padding', () => {
    const layer = { x: 0, y: 0, width: 375, height: 812 };
    const placement = mentionsCardPlacement(bar, layer, 300);
    assert.equal(placement.left, 10 + MENTIONS_CARD_SIDE_INSET);
    assert.equal(placement.width, 355 - MENTIONS_CARD_SIDE_INSET * 2);
    assert.equal(placement.bottomEdge, 600 - MENTIONS_CARD_GAP);
    assert.equal(placement.maxHeight, (812 - 300) * MENTIONS_CARD_MAX_SHARE);
  });

  it('reads the bar against a layer that is not at the window origin', () => {
    const layer = { x: 5, y: 40, width: 365, height: 772 };
    const placement = mentionsCardPlacement(bar, layer, 0);
    assert.equal(placement.left, 5 + MENTIONS_CARD_SIDE_INSET);
    assert.equal(placement.bottomEdge, 560 - MENTIONS_CARD_GAP);
  });
});

describe('sameWindowRect', () => {
  it('compares every side', () => {
    const rect = { x: 1, y: 2, width: 3, height: 4 };
    assert.equal(sameWindowRect(rect, { ...rect }), true);
    assert.equal(sameWindowRect(rect, { ...rect, height: 5 }), false);
  });
});
