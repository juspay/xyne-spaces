import Avatar from '@/src/components/ui/avatar';
import { PresenceDot } from '@/src/components/ui/presence-dot';
import type { DmListItemData } from '@/src/types/dm-list-item';
import { cn } from '@/src/utils/cn';
import { ChannelScopeType } from '@xyne/shared';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import type { ReactElement, ReactNode } from 'react';
import { memo } from 'react';
import { Text, View } from 'react-native';
import { ChatListItemProvider, useDmListItemContext } from './dm-list-item-context';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { ListRowPressable } from '@/src/components/ui/list-row-pressable';
import { UnreadCountBadge } from '@/src/components/ui/unread-count-badge';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';

const AVATAR_SIZE = 48;
const THUMB_SIZE = 21;

export type DmListItemRootProps = {
  data: DmListItemData;
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
};
type DmListItemProfileProps = {
  size?: number;
};

function DmListItemRoot({
  data,
  children,
  onPress,
  onLongPress,
  delayLongPress,
}: DmListItemRootProps): ReactElement {
  return (
    <ListRowPressable
      className='w-full'
      delayLongPress={delayLongPress}
      onLongPress={onLongPress}
      onPress={onPress}
    >
      <ChatListItemProvider value={data}>{children}</ChatListItemProvider>
    </ListRowPressable>
  );
}

const Profile = memo(function DmListItemProfile({ size = AVATAR_SIZE }: DmListItemProfileProps) {
  const { participantIdentities, participantUserIds, scopeType } = useDmListItemContext();
  const presenceUserId = scopeType === ChannelScopeType.DM ? participantUserIds[0] : undefined;

  return (
    <View className='relative shrink-0'>
      <Avatar
        userIds={participantUserIds}
        size={size}
        rounded={false}
        {...(participantIdentities ? { fallbackUsers: participantIdentities } : {})}
      />
      {presenceUserId ? <PresenceDot userId={presenceUserId} /> : null}
    </View>
  );
});

const Name = memo(function DmListItemName() {
  const { title, unreadCount } = useDmListItemContext();

  if (!title) {
    return (
      <View accessibilityLabel='Loading contact' className='h-4 w-28 rounded-md bg-foreground/10' />
    );
  }

  return (
    <View className='flex-row items-center gap-1 min-w-0'>
      <Text
        className={cn(
          'text-base font-medium text-primary-text',
          unreadCount && 'font-bold text-primary-text',
        )}
        numberOfLines={1}
        ellipsizeMode='tail'
      >
        {title}
      </Text>
    </View>
  );
});

const PreviewMessage = memo(function DmListItemPreviewMessage() {
  const { lastMessage, unreadCount } = useDmListItemContext();

  if (lastMessage.variant === 'system') {
    return (
      <Text className='text-[15px] leading-5 text-brand' numberOfLines={1} ellipsizeMode='tail'>
        {lastMessage.text}
      </Text>
    );
  }

  if (lastMessage.variant === 'attachment') {
    const label =
      lastMessage.text ?? (lastMessage.attachmentKind === 'photo' ? 'Photo' : 'Attachment');

    return (
      <View className='flex-row items-center min-w-0 gap-2'>
        {lastMessage.thumbnailUri ? (
          <Image
            cachePolicy='memory-disk'
            className='rounded-md bg-neutral-800'
            contentFit='cover'
            source={{ uri: lastMessage.thumbnailUri }}
            style={{ width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 4 }}
          />
        ) : (
          <View
            className='rounded-md bg-neutral-800 items-center justify-center'
            style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
          >
            <Ionicons color='#8E8E93' name='document-text-outline' size={18} />
          </View>
        )}
        <Text className='text-[15px] text-[#8E8E93] shrink' numberOfLines={1} ellipsizeMode='tail'>
          {label}
        </Text>
      </View>
    );
  }

  const sizeClass = lastMessage.isEmojiOnly
    ? 'text-[20px] leading-6'
    : cn(
        'text-[15px] mr-2',
        unreadCount && unreadCount > 0
          ? 'text-chat-unread-preview-msg-text font-semibold'
          : 'text-chat-preview-msg-text font-medium',
      );

  return (
    <Text className={cn('text-[#8E8E93] shrink', sizeClass)} numberOfLines={1} ellipsizeMode='tail'>
      {lastMessage.text}
    </Text>
  );
});

const Timestamp = memo(function DmListItemTimestamp() {
  const { unreadCount, timestampLabel } = useDmListItemContext();
  // The unread timestamp sits directly above the unread badge, so it follows the
  // same accent. `accentText` rather than `accentBg`: this is text on the screen
  // background, held to the stricter text contrast floor.
  const { accentText } = useBubbleAccent();
  const hasUnread = typeof unreadCount === 'number' && unreadCount > 0;

  return (
    <Text
      className={cn(
        'text-[12px] tabular-nums shrink-0',
        hasUnread ? 'font-medium' : 'text-chat-time-text',
      )}
      {...(hasUnread ? { style: { color: accentText } } : {})}
      numberOfLines={1}
    >
      {timestampLabel}
    </Text>
  );
});

const UnreadCount = memo(function DmListItemUnreadCount() {
  const { unreadCount } = useDmListItemContext();

  if (typeof unreadCount !== 'number' || unreadCount <= 0) {
    return null;
  }

  return <UnreadCountBadge count={unreadCount} />;
});

const Starred = memo(function DmListItemStar() {
  const { isStarred } = useDmListItemContext();

  if (!isStarred) {
    return null;
  }

  return (
    <Text accessibilityLabel='Starred conversation'>
      <Ionicons name='star' size={17} color='#EAB308' />
    </Text>
  );
});

const StatusEmoji = memo(function DmListItemStatusEmoji() {
  const { statusEmoji } = useDmListItemContext();

  if (!statusEmoji) {
    return null;
  }

  return <ReactionEmojiDisplay emojiName={statusEmoji} size={18} />;
});

export const DmListItem = Object.assign(DmListItemRoot, {
  Profile,
  Name,
  PreviewMessage,
  Timestamp,
  UnreadCount,
  Starred,
  StatusEmoji,
});
