import { memo, useCallback, useMemo } from 'react';
import { Text, View, Pressable, Alert, StyleSheet, type ViewStyle } from 'react-native';

import { haptics } from '@/src/utils/haptics';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCSSVariable } from 'uniwind';
import { cn } from '@/src/utils/cn';
import type { CallDisplayData } from '@/src/types/calls';
import { useCurrentCallExternalId, useIsInCall } from '@/src/hooks/useRoomMachine';
import { useProfilePictureUri } from '@/src/hooks/useProfilePictureUri';
import { isScheduledCallJoinable } from '@/src/components/call-log/callHistoryItem.utils';
import { useBubbleAccent } from '@/src/theme/useBubbleAccent';
import { buildSearchHighlightSegments, type HighlightSegment } from '@/src/utils/searchHighlight';
import {
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Users,
  Hash,
  Lock,
  ScrollTextIcon,
} from 'lucide-react-native';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';

interface CallLogItemProps {
  call: CallDisplayData;
  onPress?: (call: CallDisplayData) => void;
  onAvatarPress?: (call: CallDisplayData) => void;
  deferRemoteAvatarLoad?: boolean;
  /** Vespa title with optional `<hi>` tags for search highlights. */
  highlightTitle?: string;
  /** Free-text query for client-side title highlighting. */
  searchQuery?: string;
}

// Navigate to join existing call — must be called only after isInCall guard
const handleJoinCall = (call: CallDisplayData): void => {
  router.push({
    pathname: '/native-call',
    params: {
      channelId: call.externalId,
      callType: call.callType,
      initiateCall: 'false',
    },
  });
};

// Re-initiate a call — must be called only after isInCall guard
const handleCallback = (call: CallDisplayData): void => {
  const channelId = call.channelId || call.externalId;
  router.push({
    pathname: '/native-call',
    params: {
      channelId: channelId,
      callType: call.callType,
      initiateCall: 'true',
    },
  });
};

// Navigate to the call's summary/transcript thread
const handleViewTranscript = (call: CallDisplayData): void => {
  const meta = call.metadata as Record<string, unknown> | null;
  const threadId = meta?.['conversationId'] as string | undefined;
  const systemMessageId = meta?.['systemMessageId'] as string | undefined;
  if (!threadId) return;

  const channelId = call.channelId;
  if (!channelId) return;

  const intent = createChatOpenIntent(
    {
      channelId,
      threadId,
      ...(systemMessageId ? { messageId: systemMessageId } : {}),
      openStartedAtMs: Date.now(),
    },
    'call',
  );
  if (intent) executeChatOpenIntent(router, intent);
};

type ParticipantAvatar = { id: string; name: string; picture: string | null };

const AVATAR_SIZE = 40;
const AVATAR_RADIUS = 10;
const AVATAR_IMAGE_STYLE = StyleSheet.create({
  fill: {
    height: '100%',
    width: '100%',
  },
});

type AvatarTileProps = {
  user: ParticipantAvatar;
  className?: string;
  style?: ViewStyle;
  initialClassName?: string;
  deferRemoteAvatarLoad?: boolean;
};

// Single avatar tile. Fills its parent (the parent owns the size and rounded class).
const AvatarTile = memo(
  ({
    user,
    className,
    style,
    initialClassName,
    deferRemoteAvatarLoad = false,
  }: AvatarTileProps): React.ReactNode => {
    const picturePath =
      deferRemoteAvatarLoad && user.picture && !/^https?:\/\//i.test(user.picture)
        ? undefined
        : (user.picture ?? undefined);
    const uri = useProfilePictureUri(user.id, picturePath);
    const imageSource = useMemo(() => (uri ? { uri } : null), [uri]);
    const showImage = Boolean(imageSource);

    return (
      <View
        className={cn('overflow-hidden bg-accent items-center justify-center', className)}
        style={style}
      >
        {showImage ? (
          <Image
            source={imageSource}
            style={AVATAR_IMAGE_STYLE.fill}
            contentFit='cover'
            cachePolicy='memory-disk'
            recyclingKey={uri}
          />
        ) : (
          <Text className={cn('font-semibold text-foreground', initialClassName)}>
            {(user.name?.charAt(0) || '?').toUpperCase()}
          </Text>
        )}
      </View>
    );
  },
);
AvatarTile.displayName = 'CallLogAvatarTile';

/**
 * Group Avatar — squarish-rounded 40×40 box. For multi-participant calls the
 * main avatar sits on top with the next participant's avatar slightly rotated
 * behind it, like a stack of cards peeking around the corner. The total
 * participant count is shown via the pill in CallLogItem.
 */
const GroupAvatar = memo(
  ({
    avatars,
    isActive,
    isChannel,
    isChannelPrivate,
    tertiary,
    foregroundColor,
    deferRemoteAvatarLoad = false,
  }: {
    avatars: ParticipantAvatar[];
    isActive: boolean;
    isChannel?: boolean;
    isChannelPrivate?: boolean;
    tertiary: string;
    foregroundColor: string;
    deferRemoteAvatarLoad?: boolean;
  }): React.ReactNode => {
    const activeClass = isActive ? 'animate-pulse' : '';

    // Channel call — icon tile keeps its rounded-square shape (not an avatar).
    if (isChannel) {
      const iconColor = isChannelPrivate ? foregroundColor : tertiary;
      return (
        <View
          className={cn(
            'w-10 h-10 rounded-xl bg-card items-center justify-center border border-border',
            activeClass,
          )}
        >
          {isChannelPrivate ? (
            <Lock size={20} color={iconColor} />
          ) : (
            <Hash size={20} color={iconColor} />
          )}
        </View>
      );
    }

    if (avatars.length === 0) {
      return (
        <View
          className={cn(
            'w-10 h-10 bg-muted items-center justify-center border border-border',
            activeClass,
          )}
          style={{ borderRadius: AVATAR_RADIUS }}
        >
          <Users size={18} color={foregroundColor} />
        </View>
      );
    }

    const first = avatars[0];
    const second = avatars[1];

    // 1 participant — single squarish-rounded avatar filling the 40×40 box.
    if (!second && first) {
      return (
        <View className={cn(activeClass)} style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}>
          <AvatarTile
            user={first}
            className='w-10 h-10'
            style={{ borderRadius: AVATAR_RADIUS }}
            initialClassName='text-sm'
            deferRemoteAvatarLoad={deferRemoteAvatarLoad}
          />
        </View>
      );
    }

    // 2+ participants — main avatar on top, second avatar slightly rotated behind it.
    return (
      <View
        className={cn('relative', activeClass)}
        style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
      >
        {/* Back card — slightly rotated and offset so a corner peeks out */}
        {second ? (
          <AvatarTile
            user={second}
            className='absolute w-10 h-10'
            style={{
              borderRadius: AVATAR_RADIUS,
              transform: [{ translateX: -3 }, { translateY: -3 }, { rotate: '-10deg' }],
            }}
            initialClassName='text-sm'
            deferRemoteAvatarLoad={deferRemoteAvatarLoad}
          />
        ) : null}
        {/* Front card — main avatar on top, with a card-color border to separate it from the back */}
        {first ? (
          <AvatarTile
            user={first}
            className='absolute w-10 h-10 border border-card'
            style={{ borderRadius: AVATAR_RADIUS }}
            initialClassName='text-sm'
            deferRemoteAvatarLoad={deferRemoteAvatarLoad}
          />
        ) : null}
      </View>
    );
  },
);
GroupAvatar.displayName = 'CallLogGroupAvatar';

const SEARCH_HIGHLIGHT_CLASS = 'bg-yellow-300 text-yellow-950';

const HighlightedTitle = ({
  segments,
  isMissed,
}: {
  segments: HighlightSegment[];
  isMissed: boolean;
}): React.ReactNode => (
  <Text
    className={cn(
      'text-[16px] font-semibold text-primary-text flex-1 mr-2',
      isMissed ? 'text-status-danger' : 'text-foreground',
    )}
    numberOfLines={2}
  >
    {segments.map((segment, index) => (
      <Text
        key={`${segment.text}-${index}`}
        {...(segment.highlighted ? { className: SEARCH_HIGHLIGHT_CLASS } : {})}
      >
        {segment.text}
      </Text>
    ))}
  </Text>
);

const CallLogItem = memo(
  ({
    call,
    onPress,
    onAvatarPress,
    deferRemoteAvatarLoad = false,
    highlightTitle,
    searchQuery,
  }: CallLogItemProps) => {
    const isMissed = call.isMissed;
    const isOutgoing = call.isOutgoing;
    const isActive = call.isActive;
    const isScheduled = call.isScheduled;
    const isGroupCall = call.participantCount > 1;
    const isChannelCall = call.isChannelCall;
    const isChannelPrivate = call.channelVisibility === 'PRIVATE';

    // Mirrors dashboard: don't show join button if user is already in this call on this device
    const currentCallExternalId = useCurrentCallExternalId();
    const isUserInThisDevice = currentCallExternalId === call.externalId;
    const isInCall = useIsInCall();

    // For scheduled calls: joinable only once start time has passed
    const isJoinable = isScheduledCallJoinable(call);

    // Only show transcript button when call has ended and a thread exists
    const meta = call.metadata as Record<string, unknown> | null;
    const hasTranscriptThread = !isActive && !isScheduled && Boolean(meta?.['conversationId']);

    // Get colors from CSS variables for icons
    const { accentBg } = useBubbleAccent();
    const destructiveColor = useCSSVariable('--color-tertiary') as string;
    const foregroundColor = useCSSVariable('--color-secondary-foreground') as string;
    const backgroundColor = useCSSVariable('--color-accent-foreground') as string;
    const errorIconColor = useCSSVariable('--color-status-danger') as string;

    // Inline handlers with isInCall guard
    const handleJoin = useCallback((): void => {
      if (isInCall && !isUserInThisDevice) {
        Alert.alert('Already in a call', 'Please leave your current call first.');
        return;
      }
      handleJoinCall(call);
    }, [call, isInCall, isUserInThisDevice]);
    const handleCb = useCallback((): void => {
      if (isInCall) {
        Alert.alert('Already in a call', 'Please leave your current call first.');
        return;
      }
      handleCallback(call);
    }, [call, isInCall]);
    const handleTranscript = useCallback((): void => handleViewTranscript(call), [call]);
    const handleRowPress = useCallback((): void => onPress?.(call), [call, onPress]);
    const handleAvatarPress = useCallback((): void => onAvatarPress?.(call), [call, onAvatarPress]);

    const titleSegments = useMemo(() => {
      if (!highlightTitle && !searchQuery?.trim()) return null;
      return buildSearchHighlightSegments(highlightTitle ?? call.displayTitle, searchQuery ?? '');
    }, [call.displayTitle, highlightTitle, searchQuery]);

    return (
      <Pressable
        onPress={(): void => {
          void haptics.buttonTap();
          handleRowPress();
        }}
        className={cn(
          'flex-row items-start min-h-16 pb-6 px-3 bg-tabs-screen active:bg-secondary/30',
          isActive && 'border-l-[3px] border-status-success bg-status-success/5',
        )}
      >
        {/* Group Avatar with participant-count badge */}
        <Pressable
          onPress={handleAvatarPress}
          onPressIn={(): void => {
            void haptics.buttonTap();
          }}
          className='mr-4 relative'
        >
          <GroupAvatar
            avatars={call.participantAvatars}
            isActive={isActive}
            isChannel={isChannelCall}
            isChannelPrivate={isChannelPrivate}
            tertiary={destructiveColor}
            foregroundColor={foregroundColor}
            deferRemoteAvatarLoad={deferRemoteAvatarLoad}
          />
          {isGroupCall && (
            <View className='absolute -bottom-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-card border border-border items-center justify-center'>
              <Text className='text-[10px] font-semibold text-foreground'>
                {call.participantCount > 99 ? '99+' : call.participantCount}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Info Section */}
        <View className='flex-1 justify-center gap-1'>
          {titleSegments ? (
            <HighlightedTitle segments={titleSegments} isMissed={isMissed} />
          ) : (
            <Text
              className={cn(
                'text-[16px] font-semibold text-primary-text flex-1 mr-2',
                isMissed ? 'text-status-danger' : 'text-foreground',
              )}
              numberOfLines={2}
            >
              {call.displayTitle}
            </Text>
          )}
          <View className='flex-row items-center gap-1'>
            {isMissed ? (
              <PhoneIncoming size={14} fill={errorIconColor} color={errorIconColor} />
            ) : isOutgoing ? (
              <PhoneOutgoing fill={destructiveColor} size={14} color={destructiveColor} />
            ) : (
              <PhoneIncoming fill={destructiveColor} size={14} color={destructiveColor} />
            )}
            {call.timeAgo || call.statusText ? (
              <Text
                className={cn(
                  'font-regular text-tertiary text-[16px] tracking-[-0.28px] leading-[1.35] truncate flex-1',
                )}
                numberOfLines={1}
              >
                {call.timeAgo ? `  ${call.timeAgo}` : ''}
                {call.statusText ? `  ·  ${call.statusText}` : ''}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Transcript Button - only shown for ended calls with a thread */}
        {hasTranscriptThread && (
          <Pressable
            onPress={handleTranscript}
            onPressIn={(): void => {
              void haptics.buttonTap();
            }}
            className='w-9 h-9 rounded-full items-center justify-center ml-1.5 active:bg-secondary/80 border border-border'
          >
            <ScrollTextIcon size={16} color={foregroundColor} />
          </Pressable>
        )}

        {/* Join / Restart button — hidden if user is already in this call on this device */}
        {!isUserInThisDevice && (
          <Pressable
            onPress={isActive || isScheduled ? handleJoin : handleCb}
            className={cn(
              'items-center justify-center ml-2',
              isActive || (isScheduled && isJoinable)
                ? 'active:opacity-90 h-9 rounded-full px-3 flex-row gap-1.5'
                : isScheduled
                  ? 'bg-secondary/80 h-9 rounded-full px-3 flex-row gap-1.5'
                  : 'w-9 h-9 rounded-full border border-border active:bg-secondary/80',
            )}
            style={
              isActive || (isScheduled && isJoinable) ? { backgroundColor: accentBg } : undefined
            }
          >
            <Phone
              size={18}
              color={isActive || (isScheduled && isJoinable) ? backgroundColor : foregroundColor}
            />
            {(isActive || isScheduled) && (
              <Text
                className={cn(
                  'text-sm font-semibold ml-1',
                  isActive || (isScheduled && isJoinable)
                    ? 'text-accent-foreground'
                    : 'text-foreground',
                )}
              >
                {call.hasJoined ? 'Switch' : 'Join'}
              </Text>
            )}
          </Pressable>
        )}
      </Pressable>
    );
  },
);

CallLogItem.displayName = 'CallLogItem';

export { CallLogItem };
