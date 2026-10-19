import { type ReactElement } from 'react';

import ChannelsScreen from '@/src/screens/tabs/channels-screen';

import { SpacesTabScreen } from './_tab-screen';

/**
 * Route shell. The screen is shared with the classic shell; only the chrome
 * around it is per-shell, because the classic shell renders its header above
 * the pager and this one does not have a pager.
 */
export default function Screen(): ReactElement {
  return (
    <SpacesTabScreen tab='channels'>
      <ChannelsScreen />
    </SpacesTabScreen>
  );
}
