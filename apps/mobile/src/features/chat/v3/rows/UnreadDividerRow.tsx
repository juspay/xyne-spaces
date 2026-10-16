import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { UNREAD_DIVIDER_HEIGHT } from '../model/measureRowHeight';
import { useChatRenderTokens } from '../theme/ChatRenderProvider';

const CONTAINER = { height: UNREAD_DIVIDER_HEIGHT, justifyContent: 'center' as const };

/** Same chrome as v2 `UnreadMessagesDivider`: ambient green, "New messages". */
export function UnreadDividerRow(): ReactElement {
  const { ambientAccentColor } = useChatRenderTokens();
  return (
    <View className='px-4' style={CONTAINER}>
      <View className='flex-row items-center gap-3'>
        <View className='h-px flex-1' style={{ backgroundColor: ambientAccentColor }} />
        <Text className='text-xs font-semibold uppercase' style={{ color: ambientAccentColor }}>
          New messages
        </Text>
        <View className='h-px flex-1' style={{ backgroundColor: ambientAccentColor }} />
      </View>
    </View>
  );
}
