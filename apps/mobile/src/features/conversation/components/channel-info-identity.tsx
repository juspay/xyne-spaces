import { Lock, Users } from 'lucide-react-native';
import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { AvatarFace } from '@/src/ui/avatar';
import { cn } from '@/src/utils/cn';
import { haptics } from '@/src/utils/haptics';

import {
  CHANNEL_INFO_NAME_GAP,
  CHANNEL_INFO_PRESENCE_RING,
  CHANNEL_INFO_PRESENCE_SIZE,
  CHANNEL_INFO_STATUS_EMOJI_SIZE,
  CHANNEL_INFO_TILE_GAP,
  CHANNEL_INFO_TILE_ICON_SIZE,
  CHANNEL_INFO_TILE_RADIUS,
  CHANNEL_INFO_TILE_SIZE,
} from '../constants';
import type { RoomKind } from '../model/room-title';

type ChannelInfoIdentityProps = {
  kind: RoomKind;
  name: string;
  subtitle: string;
  description: string | null;
  isPrivateChannel: boolean;
  dmUserId: string | null;
  isOnline: boolean;
  dmStatusEmoji: string | null;
  dmStatusContent: string | null;
  /** Text/Default, for the tile's icon. */
  color: string;
  onOpenAvatar: () => void;
};

/**
 * Figma "Who this is": the tile, the name, what it is and its description. A
 * channel's tile is its # (a lock when private) and a group's is people; a
 * person shows their face instead, which opens the photo as the classic
 * screen's did, and their status where a channel has its description.
 */
export function ChannelInfoIdentity({
  kind,
  name,
  subtitle,
  description,
  isPrivateChannel,
  dmUserId,
  isOnline,
  dmStatusEmoji,
  dmStatusContent,
  color,
  onOpenAvatar,
}: ChannelInfoIdentityProps): ReactElement {
  return (
    <View className='items-start' style={styles.block}>
      {kind === 'dm' && dmUserId ? (
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Preview profile photo'
          onPressIn={() => void haptics.buttonTap()}
          onPress={onOpenAvatar}
          className='active:opacity-80'
        >
          <AvatarFace userId={dmUserId} size={CHANNEL_INFO_TILE_SIZE} />
          <View
            accessibilityLabel={isOnline ? 'Online' : 'Offline'}
            className={cn(
              'absolute border-spaces-background',
              isOnline ? 'bg-green-500' : 'bg-[#9CA3AF]',
            )}
            style={styles.presence}
          />
        </Pressable>
      ) : (
        <View className='items-center justify-center bg-spaces-surface' style={styles.tile}>
          {kind === 'group' ? (
            <Users size={CHANNEL_INFO_TILE_ICON_SIZE} color={color} />
          ) : isPrivateChannel ? (
            <Lock size={CHANNEL_INFO_TILE_ICON_SIZE} color={color} />
          ) : (
            <Text className='text-[28px] font-semibold leading-[34px] tracking-[-0.924px] text-spaces-foreground'>
              #
            </Text>
          )}
        </View>
      )}
      <View style={styles.tileGap} />
      <Text
        accessibilityRole='header'
        numberOfLines={2}
        className='text-[16px] font-medium leading-5 tracking-[-0.24px] text-spaces-foreground'
      >
        {name}
      </Text>
      <Text numberOfLines={1} className='text-[12px] leading-4 text-spaces-subtle'>
        {subtitle}
      </Text>
      {description === null ? null : (
        <Text className='text-[16px] leading-[22px] tracking-[-0.176px] text-spaces-muted'>
          {description}
        </Text>
      )}
      {kind === 'dm' && dmStatusEmoji ? (
        <View className='flex-row items-center' style={styles.status}>
          <ReactionEmojiDisplay emojiName={dmStatusEmoji} size={CHANNEL_INFO_STATUS_EMOJI_SIZE} />
          {dmStatusContent ? (
            <Text className='shrink text-[16px] leading-[22px] tracking-[-0.176px] text-spaces-muted'>
              {dmStatusContent}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { rowGap: CHANNEL_INFO_NAME_GAP },
  tile: {
    width: CHANNEL_INFO_TILE_SIZE,
    height: CHANNEL_INFO_TILE_SIZE,
    borderRadius: CHANNEL_INFO_TILE_RADIUS,
  },
  // With the 4 gaps either side, the name starts 16 under the tile, as in Figma.
  tileGap: { height: CHANNEL_INFO_TILE_GAP },
  presence: {
    right: -CHANNEL_INFO_PRESENCE_RING,
    bottom: -CHANNEL_INFO_PRESENCE_RING,
    width: CHANNEL_INFO_PRESENCE_SIZE,
    height: CHANNEL_INFO_PRESENCE_SIZE,
    borderRadius: CHANNEL_INFO_PRESENCE_SIZE / 2,
    borderWidth: CHANNEL_INFO_PRESENCE_RING,
  },
  status: { columnGap: CHANNEL_INFO_NAME_GAP * 2 },
});
