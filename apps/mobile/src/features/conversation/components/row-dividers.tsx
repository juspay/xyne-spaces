import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

import type { DatePillProps } from '@/src/components/chat/date-pill';

import {
  DIVIDER_HEIGHT,
  DIVIDER_PADDING_Y,
  FLOATING_DATE_INSET_TOP,
  FLOATING_DATE_PADDING_X,
  FLOATING_DATE_PADDING_Y,
  ROW_SHADOW,
  REPLY_RULE_INSET_X,
  REPLY_RULE_MARGIN_Y,
  REPLY_RULE_THICKNESS,
  THREAD_LIST_INSET,
} from '../constants';

const DIVIDER_STYLE = {
  height: DIVIDER_HEIGHT,
  paddingVertical: DIVIDER_PADDING_Y,
} as const;

const FLOATING_DATE_ROW_STYLE = { paddingTop: FLOATING_DATE_INSET_TOP } as const;
const FLOATING_DATE_STYLE = {
  paddingHorizontal: FLOATING_DATE_PADDING_X,
  paddingVertical: FLOATING_DATE_PADDING_Y,
  boxShadow: ROW_SHADOW,
} as const;

const REPLY_RULE_STYLE = {
  height: REPLY_RULE_THICKNESS,
  marginVertical: REPLY_RULE_MARGIN_Y,
  marginHorizontal: REPLY_RULE_INSET_X - THREAD_LIST_INSET,
} as const;

/** "New": where unread messages start. */
export function UnreadDivider(): ReactElement {
  return (
    <View className='items-center' style={DIVIDER_STYLE}>
      <Text className='text-[14px] font-medium leading-[18px] text-spaces-accent'>New</Text>
    </View>
  );
}

function DateLabel({ dateText }: { dateText: string }): ReactElement {
  return (
    <Text className='text-[14px] font-medium leading-[18px] text-spaces-subtle'>{dateText}</Text>
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
      <DateLabel dateText={dateText} />
    </View>
  );
}

/**
 * The day of the messages at the top while the list scrolls: the date row's
 * words on a background pill, so they stay readable over the messages.
 */
export function FloatingDate({ dateText, onLayout }: DatePillProps): ReactElement {
  return (
    <View className='items-center' style={FLOATING_DATE_ROW_STYLE}>
      <View
        collapsable={false}
        className='rounded-full border border-spaces-outline bg-spaces-background'
        style={FLOATING_DATE_STYLE}
        onLayout={event => onLayout?.(event.nativeEvent.layout)}
      >
        <DateLabel dateText={dateText} />
      </View>
    </View>
  );
}

/** Figma "Rule": a plain inset hairline between the thread's root message and its replies. */
export function ReplyDivider(): ReactElement {
  return <View className='bg-spaces-outline' style={REPLY_RULE_STYLE} />;
}
