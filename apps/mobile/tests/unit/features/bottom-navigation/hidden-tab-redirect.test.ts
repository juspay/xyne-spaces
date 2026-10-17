import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { shouldLeaveHiddenTab } from '@/src/features/bottom-navigation/model/hidden-tab-redirect';

const base = {
  activeId: 'activity',
  routeName: 'activity',
  visible: ['channels', 'dms', 'calls'] as readonly string[],
  previousVisible: ['channels', 'dms', 'calls'] as readonly string[] | null,
  initialTab: 'dms',
};

describe('shouldLeaveHiddenTab', () => {
  it('leaves a tab that was just hidden under the user', () => {
    assert.equal(
      shouldLeaveHiddenTab({ ...base, previousVisible: ['channels', 'dms', 'activity'] }),
      true,
    );
  });

  it('stays on a hidden tab the user navigated to deliberately', () => {
    // The chat header links to Activity, the call screens link to Calls, and
    // search results link to their own tabs. Redirecting here made those links
    // silently do nothing.
    assert.equal(shouldLeaveHiddenTab(base), false);
  });

  it('stays put while the tab is still offered', () => {
    assert.equal(shouldLeaveHiddenTab({ ...base, activeId: 'dms', routeName: 'dms' }), false);
  });

  it('leaves on a cold start that landed on a hidden initial tab', () => {
    // Nothing chose this: the navigator opens here whether or not it is shown.
    assert.equal(
      shouldLeaveHiddenTab({
        ...base,
        activeId: 'dms',
        routeName: 'dms',
        visible: ['channels', 'calls'],
        previousVisible: null,
      }),
      true,
    );
  });

  it('honours a cold-start deep link to some other hidden tab', () => {
    assert.equal(shouldLeaveHiddenTab({ ...base, previousVisible: null }), false);
  });

  it('does nothing before a route is known', () => {
    assert.equal(shouldLeaveHiddenTab({ ...base, routeName: '', activeId: '' }), false);
  });
});
