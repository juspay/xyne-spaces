import { memo, type ReactElement } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { ChatListNoticeProps } from '@/src/features/chat/v2/components/chat/chat-renderers';
import { haptics } from '@/src/utils/haptics';

import {
  ROOM_NOTICE_ACTION_GAP,
  ROOM_NOTICE_ACTION_HEIGHT,
  ROOM_NOTICE_ACTION_PADDING_X,
  ROOM_NOTICE_GAP,
} from '../constants';

/**
 * A room-wide notice in the room's type: a Title line, a
 * Body/Small line under it, and a surface "Try again" pill when the list can
 * retry. The list's overlay centres it and keeps it off the sides.
 */
export const RoomNotice = memo(function RoomNotice({
  title,
  detail,
  onRetry,
}: ChatListNoticeProps): ReactElement {
  return (
    <View
      className='items-center'
      style={{ rowGap: ROOM_NOTICE_GAP }}
      accessibilityLiveRegion='polite'
    >
      <Text
        accessibilityRole='header'
        className='text-center text-[16px] font-medium leading-5 tracking-[-0.24px] text-spaces-foreground'
      >
        {title}
      </Text>
      {detail ? (
        <Text className='text-center text-[14px] leading-5 tracking-[-0.14px] text-spaces-muted'>
          {detail}
        </Text>
      ) : null}
      {onRetry ? (
        <Pressable
          accessibilityRole='button'
          onPressIn={() => void haptics.buttonTap()}
          onPress={onRetry}
          className='items-center justify-center rounded-full bg-spaces-surface active:opacity-60'
          style={{
            marginTop: ROOM_NOTICE_ACTION_GAP - ROOM_NOTICE_GAP,
            height: ROOM_NOTICE_ACTION_HEIGHT,
            paddingHorizontal: ROOM_NOTICE_ACTION_PADDING_X,
          }}
        >
          <Text className='text-[14px] font-medium leading-5 text-spaces-foreground'>
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});
