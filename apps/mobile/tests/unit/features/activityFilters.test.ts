import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ActivityClassification } from '@xyne/shared';

import {
  getActivityTypes,
  getClassificationFilter,
  isAllVisibleActivity,
  isGroupMentionActivity,
  isMentionActivity,
  isReactionActivity,
  isReplyActivity,
  isTicketActivity,
  matchesActivityTab,
  matchesClassification,
} from '@/src/features/activity/domain/activityFilters';
import type { ActivityLike } from '@/src/features/activity/domain/activityTypes';

const activity = (overrides: ActivityLike = {}): ActivityLike => ({ ...overrides });

describe('single-action predicates', () => {
  it('isMentionActivity matches only mentioned_user', () => {
    assert.equal(isMentionActivity(activity({ actorAction: 'mentioned_user' })), true);
    assert.equal(isMentionActivity(activity({ actorAction: 'replied' })), false);
    assert.equal(isMentionActivity(null), false);
  });

  it('isReplyActivity matches replied and replied_v2', () => {
    assert.equal(isReplyActivity(activity({ actorAction: 'replied' })), true);
    assert.equal(isReplyActivity(activity({ actorAction: 'replied_v2' })), true);
    assert.equal(isReplyActivity(activity({ actorAction: 'added' })), false);
  });

  it('isReactionActivity matches the add/remove reaction actions', () => {
    for (const action of ['added', 'added_v2', 'removed', 'removed_v2']) {
      assert.equal(isReactionActivity(activity({ actorAction: action })), true, action);
    }
    assert.equal(isReactionActivity(activity({ actorAction: 'replied' })), false);
  });

  it('isGroupMentionActivity matches only group_mention', () => {
    assert.equal(isGroupMentionActivity(activity({ actorAction: 'group_mention' })), true);
    assert.equal(isGroupMentionActivity(activity({ actorAction: 'mentioned_user' })), false);
  });
});

describe('isTicketActivity', () => {
  it('matches ticket-lifecycle actions', () => {
    for (const action of ['eta_warning', 'eta_breach', 'stage_eta_breach']) {
      assert.equal(isTicketActivity(activity({ actorAction: action })), true, action);
    }
  });

  it('matches any activity carrying a ticketId', () => {
    assert.equal(isTicketActivity(activity({ actorAction: 'replied', ticketId: 't1' })), true);
  });

  it('does not match a non-ticket action with no ticketId', () => {
    assert.equal(isTicketActivity(activity({ actorAction: 'replied', ticketId: null })), false);
  });
});

describe('matchesClassification', () => {
  it('defaults a missing classification to PENDING', () => {
    assert.equal(matchesClassification(activity({}), ActivityClassification.PENDING), true);
    assert.equal(matchesClassification(activity({}), ActivityClassification.ACTIONABLE), false);
  });

  it('compares an explicit classification', () => {
    assert.equal(
      matchesClassification(
        activity({ classification: ActivityClassification.FYI }),
        ActivityClassification.FYI,
      ),
      true,
    );
  });

  it('returns false for a null activity', () => {
    assert.equal(matchesClassification(null, ActivityClassification.PENDING), false);
  });
});

describe('isAllVisibleActivity', () => {
  it('hides missed calls', () => {
    assert.equal(
      isAllVisibleActivity(activity({ actionSource: 'call', actorAction: 'missed_call' })),
      false,
    );
  });

  it('hides SKIP-classified activities', () => {
    assert.equal(
      isAllVisibleActivity(
        activity({ actorAction: 'replied', classification: ActivityClassification.SKIP }),
      ),
      false,
    );
  });

  it('shows a direct message only when actionable or fyi', () => {
    assert.equal(
      isAllVisibleActivity(
        activity({
          actorAction: 'direct_message',
          classification: ActivityClassification.ACTIONABLE,
        }),
      ),
      true,
    );
    assert.equal(
      isAllVisibleActivity(
        activity({
          actorAction: 'direct_message',
          classification: ActivityClassification.FYI,
        }),
      ),
      true,
    );
    assert.equal(
      isAllVisibleActivity(
        activity({
          actorAction: 'direct_message',
          classification: ActivityClassification.PENDING,
        }),
      ),
      false,
    );
  });

  it('shows ordinary activities and rejects nullish input', () => {
    assert.equal(isAllVisibleActivity(activity({ actorAction: 'replied' })), true);
    assert.equal(isAllVisibleActivity(null), false);
    assert.equal(isAllVisibleActivity(undefined), false);
  });
});

describe('matchesActivityTab', () => {
  it('routes each tab to its predicate', () => {
    assert.equal(matchesActivityTab(activity({ actorAction: 'replied' }), 'all'), true);
    assert.equal(
      matchesActivityTab(activity({ actorAction: 'mentioned_user' }), 'your_mentions'),
      true,
    );
    assert.equal(matchesActivityTab(activity({ actorAction: 'replied' }), 'replies'), true);
    assert.equal(matchesActivityTab(activity({ ticketId: 't1' }), 'tickets'), true);
    assert.equal(
      matchesActivityTab(
        activity({ classification: ActivityClassification.ACTIONABLE }),
        'actionable',
      ),
      true,
    );
    assert.equal(
      matchesActivityTab(activity({ classification: ActivityClassification.FYI }), 'fyi'),
      true,
    );
  });

  it('returns false when the activity does not match the tab', () => {
    assert.equal(matchesActivityTab(activity({ actorAction: 'replied' }), 'your_mentions'), false);
  });
});

describe('getActivityTypes', () => {
  it('maps action-based tabs to their source action strings', () => {
    assert.deepEqual(getActivityTypes('your_mentions'), ['mentioned_user']);
    assert.deepEqual(getActivityTypes('replies'), ['replied', 'replied_v2']);
    assert.deepEqual(getActivityTypes('reactions'), ['added', 'added_v2', 'removed', 'removed_v2']);
    assert.deepEqual(getActivityTypes('group_mentions'), ['group_mention']);
  });

  it('includes ticket lifecycle actions for the tickets tab', () => {
    const types = getActivityTypes('tickets');
    assert.ok(types.includes('eta_warning'));
    assert.ok(types.includes('ticket_assigned'));
    assert.ok(types.includes('workflow_question'));
  });

  it('returns an empty list for classification/all tabs', () => {
    assert.deepEqual(getActivityTypes('all'), []);
    assert.deepEqual(getActivityTypes('actionable'), []);
    assert.deepEqual(getActivityTypes('fyi'), []);
  });
});

describe('getClassificationFilter', () => {
  it('maps the classification tabs and leaves others undefined', () => {
    assert.deepEqual(getClassificationFilter('actionable'), [ActivityClassification.ACTIONABLE]);
    assert.deepEqual(getClassificationFilter('fyi'), [ActivityClassification.FYI]);
    assert.equal(getClassificationFilter('all'), undefined);
    assert.equal(getClassificationFilter('replies'), undefined);
  });
});
