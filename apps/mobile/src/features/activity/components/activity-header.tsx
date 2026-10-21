import { type ReactElement } from 'react';

import { SpacesHeader } from '@/src/components/spaces-header';
import { UserProfile } from '@/src/features/dms/components/dms-header';

export function ActivityHeader(): ReactElement {
  return <SpacesHeader title='Activity' trailing={<UserProfile />} />;
}
