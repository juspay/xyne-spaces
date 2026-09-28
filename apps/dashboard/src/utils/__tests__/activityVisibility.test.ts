import { describe, expect, it } from 'vitest';
import { ActivityClassification } from '@xyne/shared';
import { isAllVisibleActivity } from '../activityVisibility';

describe('isAllVisibleActivity', () => {
  it('counts live reactions (added_v2) — cancelled ones are deleted server-side', () => {
    expect(
      isAllVisibleActivity({
        actorAction: 'added_v2',
        actionSource: 'message',
        classification: ActivityClassification.FYI,
      }),
    ).toBe(true);
  });

  it('counts ticket tag removals (actorAction "removed")', () => {
    expect(isAllVisibleActivity({ actorAction: 'removed', actionSource: 'ticket' })).toBe(true);
  });

  it('counts mentions and replies with no classification', () => {
    expect(isAllVisibleActivity({ actorAction: 'mentioned_user', actionSource: 'message' })).toBe(
      true,
    );
    expect(
      isAllVisibleActivity({ actorAction: 'replied_v2', actionSource: 'message', classification: null }),
    ).toBe(true);
  });

  it('excludes missed calls', () => {
    expect(isAllVisibleActivity({ actorAction: 'missed_call', actionSource: 'call' })).toBe(false);
  });

  it('excludes SKIP-classified activities', () => {
    expect(
      isAllVisibleActivity({
        actorAction: 'mentioned_user',
        actionSource: 'message',
        classification: ActivityClassification.SKIP,
      }),
    ).toBe(false);
  });

  it('only counts DMs classified ACTIONABLE or FYI', () => {
    const dm = { actorAction: 'direct_message', actionSource: 'message' };
    expect(isAllVisibleActivity(dm)).toBe(false);
    expect(isAllVisibleActivity({ ...dm, classification: ActivityClassification.PENDING })).toBe(false);
    expect(isAllVisibleActivity({ ...dm, classification: ActivityClassification.ACTIONABLE })).toBe(
      true,
    );
    expect(isAllVisibleActivity({ ...dm, classification: ActivityClassification.FYI })).toBe(true);
  });
});
