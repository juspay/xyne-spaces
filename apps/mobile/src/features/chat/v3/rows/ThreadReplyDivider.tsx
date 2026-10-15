import { type ReactElement } from 'react';
import { Text, View } from 'react-native';

const DIVIDER_GUTTER = 40;
const LABEL_MIN_WIDTH = 64;
const DIVIDER_PAD = 8;

export function ThreadReplyDivider({ count }: { count: number }): ReactElement {
  return (
    <View
      className='flex-row items-center pr-1'
      style={{
        marginLeft: DIVIDER_GUTTER,
        paddingTop: DIVIDER_PAD,
        paddingBottom: DIVIDER_PAD,
      }}
    >
      <Text
        className='text-xs text-secondary-foreground'
        numberOfLines={1}
        style={{ flexShrink: 0, lineHeight: 18, minWidth: LABEL_MIN_WIDTH }}
      >
        {count} {count === 1 ? 'reply' : 'replies'}
      </Text>
      <View className='h-px flex-1 bg-border opacity-70' style={{ marginLeft: 8 }} />
    </View>
  );
}
