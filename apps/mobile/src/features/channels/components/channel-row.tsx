import { useValue } from '@legendapp/state/react';
import { AtSign, Lock } from 'lucide-react-native';
import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import { StarIcon } from '@/src/features/dms/icons';
import { formatDmTimestamp } from '@/src/features/dms/model/timestamp';
import { todayStart$ } from '@/src/features/dms/state/day-clock';
import { ContextMenu } from '@/src/ui/context-menu';
import { HashIcon } from '@/src/ui/icons';
import Avatar from '@/src/components/ui/avatar';
import { cn } from '@/src/utils/cn';
import { formatCountLabel } from '@/src/utils/countLabel';
import { haptics } from '@/src/utils/haptics';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';

import {
  CHANNEL_BADGE_GAP,
  CHANNEL_BADGE_PADDING_X,
  CHANNEL_BADGE_SIZE,
  CHANNEL_BADGE_TEXT_SIZE,
  CHANNEL_ICON_GAP,
  CHANNEL_ICON_GLYPH,
  CHANNEL_ICON_SLOT,
  CHANNEL_META_ICON_SIZE,
  CHANNEL_META_TOP,
  CHANNEL_NAME_SIZE,
  CHANNEL_ROW_HEIGHT,
  CHANNEL_ROW_PADDING_X,
  CHANNEL_TIMESTAMP_SIZE,
} from '../constants';
import { channelRow$ } from '../state/rows-store';
import { ChannelRowMenu } from './channel-row-menu';

/**
 * The glyph in its slot. Subscribed to visibility alone, so a channel
 * receiving messages all day never re-renders its icon.
 */
function IconSlot({ id }: { id: string }): ReactElement {
  const isPrivate = useValue(() => channelRow$(id).isPrivate.get());
  const avatarKey = useValue(() => (channelRow$(id).avatarUserIds.get() ?? []).join(','));
  const muted = useCSSVariable('--color-spaces-muted') as string;
  const Glyph = isPrivate ? Lock : HashIcon;
  const avatarUserIds = useMemo(() => (avatarKey ? avatarKey.split(',') : []), [avatarKey]);

  // A DM filed into a section shows the person, as the DMs list does.
  if (avatarUserIds.length > 0) {
    return <Avatar userIds={avatarUserIds} size={CHANNEL_ICON_SLOT} />;
  }

  return (
    <View
      className='items-center justify-center rounded-xl bg-spaces-surface'
      style={{ width: CHANNEL_ICON_SLOT, height: CHANNEL_ICON_SLOT }}
    >
      <Glyph size={CHANNEL_ICON_GLYPH} color={muted} strokeWidth={2} />
    </View>
  );
}

function Name({ id }: { id: string }): ReactElement {
  const name = useValue(() => channelRow$(id).name.get());
  const hasUnread = useValue(() => channelRow$(id).hasUnread.get());

  // Unread reads at full strength and bold; everything else is faded, so a
  // channel with new messages stands out whether or not it has a badge.
  return (
    <Text
      numberOfLines={1}
      style={{ fontSize: CHANNEL_NAME_SIZE }}
      className={cn(
        hasUnread === true
          ? 'font-semibold text-spaces-foreground'
          : 'font-medium text-spaces-muted',
      )}
    >
      {name ?? ''}
    </Text>
  );
}

/**
 * Same label and same rollover as the DMs list: it reads the shared formatter
 * and the shared day clock rather than keeping its own, so the two screens
 * cannot disagree about what "Yesterday" is.
 */
function Timestamp({ id }: { id: string }): ReactElement {
  const activityAt = useValue(() => channelRow$(id).lastActivityAtMs.get());
  const hasUnread = useValue(() => channelRow$(id).hasUnread.get());
  const todayStart = useValue(todayStart$);
  const isUnread = hasUnread === true;

  return (
    <Text
      style={{ fontSize: CHANNEL_TIMESTAMP_SIZE }}
      className={cn(isUnread ? 'font-semibold text-spaces-accent' : 'text-spaces-muted')}
    >
      {formatDmTimestamp(activityAt ?? 0, todayStart)}
    </Text>
  );
}

function Starred({ id }: { id: string }): ReactElement | null {
  const isStarred = useValue(() => channelRow$(id).isStarred.get());
  if (isStarred !== true) return null;
  return <StarIcon width={CHANNEL_META_ICON_SIZE} height={CHANNEL_META_ICON_SIZE} />;
}

function Mention({ id }: { id: string }): ReactElement | null {
  const isMentioned = useValue(() => channelRow$(id).isMentioned.get());
  const accent = useCSSVariable('--color-spaces-accent') as string;
  if (isMentioned !== true) return null;
  return <AtSign size={CHANNEL_META_ICON_SIZE} color={accent} strokeWidth={2.4} />;
}

function UnreadBadge({ id }: { id: string }): ReactElement | null {
  const count = useValue(() => channelRow$(id).unreadCount.get());
  if (!count) return null;

  return (
    <View
      className='items-center justify-center rounded-full bg-spaces-accent'
      style={{
        minWidth: CHANNEL_BADGE_SIZE,
        height: CHANNEL_BADGE_SIZE,
        paddingHorizontal: CHANNEL_BADGE_PADDING_X,
      }}
    >
      <Text
        style={{ fontSize: CHANNEL_BADGE_TEXT_SIZE }}
        className='font-semibold text-spaces-accent-foreground'
      >
        {formatCountLabel(count)}
      </Text>
    </View>
  );
}

/**
 * The right-hand column: timestamp, and below it whatever indicators apply.
 *
 * With no indicators the timestamp is centred in the row rather than hung from
 * the top, where it would sit above empty space and look misaligned with the
 * name beside it.
 */
function Meta({ id }: { id: string }): ReactElement {
  const hasIndicators = useValue(() => {
    const row = channelRow$(id);
    return (
      row.isStarred.get() === true ||
      row.isMentioned.get() === true ||
      (row.unreadCount.get() ?? 0) > 0
    );
  });

  return (
    <View
      className={cn('items-end self-stretch', hasIndicators ? undefined : 'justify-center')}
      style={{ paddingLeft: 8, paddingTop: hasIndicators ? CHANNEL_META_TOP : 0 }}
    >
      <Timestamp id={id} />
      {hasIndicators ? (
        <View className='flex-row items-center gap-1.5' style={{ marginTop: CHANNEL_BADGE_GAP }}>
          <Starred id={id} />
          <Mention id={id} />
          <UnreadBadge id={id} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Subscribes to nothing itself — every field is read by the slot that draws
 * it, so an update lands on that slot and the row renders once per id.
 *
 * The press handler `peek()`s, so opening a chat does not make the row depend
 * on the values it passes along.
 */
export const ChannelRow = memo(function ChannelRow({ id }: { id: string }): ReactElement {
  const router = useRouter();
  const row$ = useMemo(() => channelRow$(id), [id]);

  const handlePress = useCallback(() => {
    void haptics.buttonTap();
    const row = row$.peek();
    openBaseChatRoute(router, id, {
      surface: 'channels',
      unreadCount: row?.messageUnreadCount ?? 0,
      unreadLastViewedAt: row?.lastViewedAt,
      unreadLastViewedConversationId: row?.lastViewedConversationId,
    });
  }, [id, router, row$]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger onPress={handlePress} style={{ height: CHANNEL_ROW_HEIGHT }}>
        <View
          className='flex-1 flex-row items-center'
          style={{ paddingHorizontal: CHANNEL_ROW_PADDING_X }}
        >
          <IconSlot id={id} />
          <View className='flex-1 min-w-0' style={{ marginLeft: CHANNEL_ICON_GAP }}>
            <Name id={id} />
          </View>
          <Meta id={id} />
        </View>
      </ContextMenu.Trigger>
      <ChannelRowMenu id={id} />
    </ContextMenu.Root>
  );
});
