import { observable } from '@legendapp/state';

import { applyActivityPreferences } from './preferences-store';

export type ActivityTrayView = 'filters' | 'people';

type ActivityTrayState = {
  isOpen: boolean;
  view: ActivityTrayView;
};

/**
 * Whether the filter tray is up, and on which of its views.
 *
 * A store because the button that opens it and the tray it opens are siblings
 * the screen composes, and neither should own the other.
 */
export const activityTray$ = observable<ActivityTrayState>({ isOpen: false, view: 'filters' });

/** Always opens on the filters; the people list is a step inside. */
export function openActivityTray(): void {
  activityTray$.set({ isOpen: true, view: 'filters' });
}

/**
 * Closing hands the feed whatever the controls have not already: a control
 * dismissed mid-slide never settles, so its change would otherwise be left
 * waiting.
 */
export function closeActivityTray(): void {
  activityTray$.isOpen.set(false);
  applyActivityPreferences();
}

export function setActivityTrayView(view: ActivityTrayView): void {
  activityTray$.view.set(view);
}
