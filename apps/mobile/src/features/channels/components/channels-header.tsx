import { type ReactElement } from 'react';

import { SpacesHeader } from '@/src/components/spaces-header';
import { UserProfile } from '@/src/features/dms/components/dms-header';

export function ChannelsHeader(): ReactElement {
  return <SpacesHeader title='Channels' trailing={<UserProfile />} />;
}
