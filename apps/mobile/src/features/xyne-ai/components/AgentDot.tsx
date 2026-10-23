import type { ReactElement } from 'react';
import { View } from 'react-native';

import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

/** The agent's colour; Ask AI has none, so it follows the user's accent. */
export const AgentDot = ({ color }: { color: string | undefined }): ReactElement => {
  const { accentBg } = useBubbleAccent();
  return <View className='size-2.5 rounded-full' style={{ backgroundColor: color ?? accentBg }} />;
};
