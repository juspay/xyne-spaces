import { type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { DatePillProps } from '@/src/components/chat/date-pill';

import {
  DIVIDER_HEIGHT,
  DIVIDER_PADDING_BOTTOM,
  DIVIDER_PADDING_TOP,
  REPLY_DIVIDER_HEIGHT,
  REPLY_DIVIDER_PADDING_X,
  THREAD_LIST_INSET,
} from '../constants';
import { replyCountLabel } from '../model/thread-strip';

const DIVIDER_STYLE = {
  height: DIVIDER_HEIGHT,
  paddingTop: DIVIDER_PADDING_TOP,
  paddingBottom: DIVIDER_PADDING_BOTTOM,
} as const;

/** "New": where unread messages start. */
export function UnreadDivider(): ReactElement {
  return (
    <View className='items-center' style={DIVIDER_STYLE}>
      <Text className='text-[14px] font-medium leading-[18px] text-spaces-accent'>New</Text>
    </View>
  );
}

/** The day a run of messages was sent. */
export function DateRow({ dateText, onLayout }: DatePillProps): ReactElement {
  return (
    <View
      collapsable={false}
      className='items-center'
      style={DIVIDER_STYLE}
      onLayout={event => onLayout?.(event.nativeEvent.layout)}
    >
      <Text className='text-[14px] font-medium leading-[18px] text-spaces-subtle'>{dateText}</Text>
    </View>
  );
}

/** "N replies" under the thread's root message, with a hairline running to the edge. */
export function ReplyDivider({ replyCount }: { replyCount: number }): ReactElement {
  return (
    <View
      className='flex-row items-center'
      style={{
        height: REPLY_DIVIDER_HEIGHT,
        marginHorizontal: REPLY_DIVIDER_PADDING_X - THREAD_LIST_INSET,
        columnGap: 8,
      }}
    >
      <Text className='text-[14px] leading-[18px] text-spaces-subtle'>
        {replyCountLabel(replyCount)}
      </Text>
      <View className='flex-1 bg-spaces-outline' style={{ height: StyleSheet.hairlineWidth }} />
    </View>
  );
}
