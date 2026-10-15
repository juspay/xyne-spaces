import type { ReactElement, ReactNode } from 'react';
import { View } from 'react-native';

import { useSetting } from '@/src/machines/settingsMachine';

type DebugBoundaryProps = {
  children: ReactNode;
  forceShow?: boolean;
};

export const DebugBoundary = ({
  children,
  forceShow = false,
}: DebugBoundaryProps): ReactElement => {
  const enabled = useSetting('developers.showConversationComposerBoundaries');
  if (!enabled && !forceShow) {
    return <>{children}</>;
  }
  return <View style={{ borderColor: 'red', borderWidth: 1 }}>{children}</View>;
};
