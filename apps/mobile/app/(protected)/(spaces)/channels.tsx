import { type ReactElement } from 'react';

import { ChannelsScreen as NewChannelsScreen } from '@/src/features/channels';
import { useFlag } from '@/src/flags';
import ChannelsScreen from '@/src/screens/tabs/channels-screen';

import { SpacesTabScreen } from './_tab-screen';

/**
 * Route shell. The classic screen is shared with the classic shell, so it keeps
 * the `SpacesTabScreen` wrapper for its header and focus context; the new one
 * owns its header and needs neither.
 */
export default function Screen(): ReactElement {
  if (useFlag('ui.channels')) {
    return <NewChannelsScreen />;
  }

  return (
    <SpacesTabScreen tab='channels'>
      <ChannelsScreen />
    </SpacesTabScreen>
  );
}
