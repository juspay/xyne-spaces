import { useValue } from '@legendapp/state/react';
import { type ReactElement } from 'react';

import { Tray } from '@/src/ui/tray';

import {
  activityTray$,
  closeActivityTray,
  setActivityTrayView,
  type ActivityTrayView,
} from '../state/filter-tray-store';
import { ActivityFiltersView } from './activity-filters-view';
import { ActivityPeopleView } from './activity-people-view';

const FILTERS_VIEW: ActivityTrayView = 'filters';
const PEOPLE_VIEW: ActivityTrayView = 'people';

/**
 * The one tray the Activity screen owns: every control the feed has on its
 * first view, and the searchable list of people or agents one step in. Choosing
 * someone morphs back to the controls in the same card.
 */
export function ActivityFilterTray(): ReactElement {
  const isOpen = useValue(activityTray$.isOpen);
  const view = useValue(activityTray$.view);

  return (
    <Tray.Root
      open={isOpen}
      onOpenChange={open => {
        if (!open) closeActivityTray();
      }}
      view={view}
      onViewChange={next => setActivityTrayView(next as ActivityTrayView)}
      defaultView={FILTERS_VIEW}
    >
      <Tray.Content>
        <Tray.Body>
          <Tray.View name={FILTERS_VIEW} style={{ flexShrink: 1 }}>
            <ActivityFiltersView />
          </Tray.View>
          <Tray.View name={PEOPLE_VIEW} style={{ flexShrink: 1 }}>
            <ActivityPeopleView />
          </Tray.View>
        </Tray.Body>
      </Tray.Content>
    </Tray.Root>
  );
}
