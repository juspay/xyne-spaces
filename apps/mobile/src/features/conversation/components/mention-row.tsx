import { Hand, Hash, Lock, Megaphone, Users, type LucideIcon } from 'lucide-react-native';
import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Avatar from '@/src/components/ui/avatar';
import type { MentionListItem } from '@/src/components/input-composer/utils/mentions';

import {
  MENTIONS_CARD_ICON_SIZE,
  MENTIONS_CARD_LEADING_SIZE,
  MENTIONS_CARD_ROW_GAP,
  MENTIONS_CARD_ROW_HEIGHT,
  MENTIONS_CARD_ROW_PADDING_X,
  MENTIONS_CARD_ROW_RADIUS,
} from '../constants';
import {
  mentionAccessibilityLabel,
  mentionLeading,
  mentionSubtitle,
  mentionTitle,
  splitTitleMatch,
  type MentionLeading,
} from '../model/mentions-card';

const LEADING_ICONS: Readonly<Record<Exclude<MentionLeading, 'avatar'>, LucideIcon>> = {
  group: Users,
  everyone: Megaphone,
  here: Hand,
  channel: Hash,
  privateChannel: Lock,
};

type MentionRowProps = {
  item: MentionListItem;
  /** What follows the trigger; its match in the title shows in the mention blue. */
  query: string;
  /** Text/Default, for a leading icon. */
  iconColor: string;
  onPick: (item: MentionListItem) => void;
};

function MentionFace({ userId }: { userId: string }): ReactElement {
  const userIds = useMemo(() => [userId], [userId]);
  return <Avatar userIds={userIds} size={MENTIONS_CARD_LEADING_SIZE} />;
}

/**
 * A mentions card row: a person's face, or an icon in a circle for a group,
 * @channel, @here or a channel; the title with the typed part in the mention
 * blue, over the email or description.
 */
export const MentionRow = memo(function MentionRow({
  item,
  query,
  iconColor,
  onPick,
}: MentionRowProps): ReactElement {
  const leading = mentionLeading(item);
  const title = splitTitleMatch(mentionTitle(item), query);
  const subtitle = mentionSubtitle(item);
  const handlePress = useCallback((): void => onPick(item), [item, onPick]);

  return (
    <Pressable
      accessibilityRole='button'
      accessibilityLabel={mentionAccessibilityLabel(item)}
      onPress={handlePress}
      className='flex-row items-center active:bg-spaces-surface'
      style={styles.row}
    >
      {leading === 'avatar' ? (
        <MentionFace userId={item.id} />
      ) : (
        <LeadingIcon icon={LEADING_ICONS[leading]} color={iconColor} />
      )}
      <View className='min-w-0 flex-1'>
        <Text
          numberOfLines={1}
          className='text-[16px] font-medium leading-[22px] text-spaces-foreground'
        >
          {title.before}
          {title.match.length > 0 ? (
            <Text className='text-spaces-mention'>{title.match}</Text>
          ) : null}
          {title.after}
        </Text>
        {subtitle === null ? null : (
          <Text numberOfLines={1} className='text-[14px] leading-[20px] text-spaces-muted'>
            {subtitle}
          </Text>
        )}
      </View>
    </Pressable>
  );
});

function LeadingIcon({ icon, color }: { icon: LucideIcon; color: string }): ReactElement {
  const Icon = icon;
  return (
    <View
      className='items-center justify-center rounded-full bg-spaces-surface'
      style={styles.leading}
    >
      <Icon size={MENTIONS_CARD_ICON_SIZE} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: MENTIONS_CARD_ROW_HEIGHT,
    paddingHorizontal: MENTIONS_CARD_ROW_PADDING_X,
    columnGap: MENTIONS_CARD_ROW_GAP,
    borderRadius: MENTIONS_CARD_ROW_RADIUS,
  },
  leading: { width: MENTIONS_CARD_LEADING_SIZE, height: MENTIONS_CARD_LEADING_SIZE },
});
