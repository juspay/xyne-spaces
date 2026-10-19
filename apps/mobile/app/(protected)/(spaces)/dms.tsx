import { type ReactElement } from 'react';

import DmScreen from '@/src/screens/tabs/dms-screen';

import { SpacesTabScreen } from './_tab-screen';

/**
 * Route shell. The screen is shared with the classic shell; only the chrome
 * around it is per-shell, because the classic shell renders its header above
 * the pager and this one does not have a pager.
 */
export default function Screen(): ReactElement {
  return (
    <SpacesTabScreen tab='dms'>
      <DmScreen />
    </SpacesTabScreen>
  );
}
