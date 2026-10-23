import { type ReactElement } from 'react';

import { ActivityScreen as NewActivityScreen } from '@/src/features/activity';
import { useFlag } from '@/src/flags';
import ActivityScreen from '@/src/screens/tabs/activity-screen';

import { SpacesTabScreen } from './_tab-screen';

/**
 * Route shell.
 *
 * The classic screen renders its list only and takes its header from the
 * chrome, so it keeps the `SpacesTabScreen` wrapper. The new one owns its
 * layout and needs none.
 */
export default function Screen(): ReactElement {
  if (useFlag('ui.activity')) {
    return <NewActivityScreen />;
  }

  return (
    <SpacesTabScreen tab='activity'>
      <ActivityScreen />
    </SpacesTabScreen>
  );
}
