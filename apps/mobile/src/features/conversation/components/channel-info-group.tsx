import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  CHANNEL_INFO_CARD_RADIUS,
  CHANNEL_INFO_GROUP_GAP,
  CHANNEL_INFO_GROUP_INSET_X,
  CHANNEL_INFO_GROUP_TITLE_GAP,
} from '../constants';

type ChannelInfoGroupProps = {
  title: string;
  /** The rows; falsy children (a row the user can't use) are skipped, hairlines go between the rest. */
  children: ReactNode;
};

/** Figma "Channel info" group: a 14 title over a card of rows split by hairlines. */
export function ChannelInfoGroup({ title, children }: ChannelInfoGroupProps): ReactElement | null {
  const rows = Children.toArray(children).filter(isValidElement);
  if (rows.length === 0) return null;

  return (
    <View style={styles.group}>
      <Text
        accessibilityRole='header'
        numberOfLines={1}
        className='text-[14px] font-medium leading-[18px] tracking-[-0.14px] text-spaces-muted'
      >
        {title}
      </Text>
      <View className='overflow-hidden bg-spaces-surface' style={styles.card}>
        {rows.map((row, index) => (
          <Fragment key={row.key ?? index}>
            {index === 0 ? null : <View className='h-px bg-spaces-outline' />}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    paddingTop: CHANNEL_INFO_GROUP_GAP,
    paddingHorizontal: CHANNEL_INFO_GROUP_INSET_X,
    rowGap: CHANNEL_INFO_GROUP_TITLE_GAP,
  },
  card: { borderRadius: CHANNEL_INFO_CARD_RADIUS },
});
