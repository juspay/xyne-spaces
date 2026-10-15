import { memo, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { ConversationComposerMarkdownBody } from '@/src/components/conversation-composer/conversation-composer-markdown-body';
import { useCSSVariable, useUniwind } from 'uniwind';
import { CornerUpRight, Hash, Lock, MessageSquare } from 'lucide-react-native';
import {
  ChannelScopeType,
  ChannelVisibility,
  MessageType,
  isForwardedMessageXml,
  parseForwardedMessageXml,
  type ForwardedMessageData,
} from '@xyne/shared';

import { useMessageComposer } from './message-composer-context';
import { htmlToMD } from './utils/htmlToMD';
import { buildComposerMarkdownStyle } from './utils/markdownStyle';
import { useUserColor } from './utils/getUserColor';
import { DebugBoundary } from './utils/debug-boundary';
import { useChannel } from '@/src/hooks/useChannels';
import { cn } from '@/src/utils/cn';
import { useForwardedMessageNavigation } from '@/src/hooks/useForwardedMessageNavigation';

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

type ForwardedProps = {
  className?: string;
};

const Forwarded = memo(({ className }: ForwardedProps): ReactElement | null => {
  const { item, kind, currentUser } = useMessageComposer();
  const openForwardedSource = useForwardedMessageNavigation();

  const foreground = useCSSVariable('--color-foreground') as string;
  const foregroundMuted = useCSSVariable('--color-muted') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const forwardedBgUser = useCSSVariable(
    '--color-conversation-composer-forwarded-bg-user',
  ) as string;
  const forwardedBgOther = useCSSVariable(
    '--color-conversation-composer-forwarded-bg-other',
  ) as string;
  const { theme } = useUniwind();
  const linkColor = theme === 'dark' ? '#3CB16F' : '#288451';

  const forwarded = useMemo<ForwardedMessageData | null>(() => {
    if (item.msgType !== MessageType.FORWARDED) return null;
    const raw = item.content ?? '';
    if (!raw || !isForwardedMessageXml(raw)) return null;
    return parseForwardedMessageXml(raw);
  }, [item.msgType, item.content]);

  const markdown = useMemo(() => htmlToMD(forwarded?.content ?? ''), [forwarded?.content]);

  const originalSenderColor = useUserColor(forwarded?.originalSenderId ?? '');
  const originalChannel = useChannel(forwarded?.originalChannelId ?? '');

  const markdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground,
        foregroundMuted,
        cardBg,
        brand,
        linkColor,
        variant: 'quoted',
      }),
    [foreground, foregroundMuted, cardBg, brand, linkColor],
  );

  const previewMarkdown = markdown;

  if (!forwarded) return null;

  const nameColor = forwarded.originalSenderId ? originalSenderColor : foreground;
  const timestamp = forwarded.originalCreatedAt ? formatTime(forwarded.originalCreatedAt) : null;
  const backgroundColor = kind === 'CURRENT_USER' ? forwardedBgUser : forwardedBgOther;
  const forwardedIsOwnMessage = forwarded.originalSenderId === currentUser?.id;

  const isDM = originalChannel?.scopeType === ChannelScopeType.DM;
  const isGroupDM = originalChannel?.scopeType === ChannelScopeType.GROUP_DM;
  const isPrivate = originalChannel?.visibility === ChannelVisibility.PRIVATE;
  const showPostedIn =
    !!originalChannel && !!forwarded.originalChannelId && !!forwarded.originalConversationId;

  const postedInName = isDM
    ? 'Direct Message'
    : isGroupDM
      ? 'Group Message'
      : (originalChannel?.name ?? 'Unknown Channel');

  const handlePostedInPress = (event: GestureResponderEvent): void => {
    event.stopPropagation();
    if (!showPostedIn) return;
    void openForwardedSource(forwarded);
  };

  return (
    <DebugBoundary>
      <Pressable
        accessibilityRole={showPostedIn ? 'button' : undefined}
        accessibilityLabel={
          showPostedIn ? `Forwarded message posted in ${postedInName}` : undefined
        }
        disabled={!showPostedIn}
        onPress={handlePostedInPress}
        className={cn('pl-2 pr-2 py-1.5 gap-1 mb-2 rounded-md', className)}
        style={{ borderLeftWidth: 3, borderLeftColor: nameColor, backgroundColor }}
      >
        <View className='w-full flex-row items-center gap-2 overflow-hidden'>
          <Text
            className='min-w-0 shrink text-sm font-semibold'
            style={{ color: nameColor, flexShrink: 1, minWidth: 0 }}
            numberOfLines={1}
            ellipsizeMode='tail'
          >
            {forwarded.originalSenderName || 'Unknown User'}
          </Text>
          {timestamp ? (
            <Text
              className='shrink-0 text-[10px] text-secondary-foreground'
              style={{ flexShrink: 0 }}
              numberOfLines={1}
            >
              {timestamp}
            </Text>
          ) : null}
        </View>
        {markdown.trim() ? (
          <ConversationComposerMarkdownBody
            markdown={previewMarkdown}
            markdownStyle={markdownStyle}
            containerStyle={{ maxWidth: '100%' }}
            {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
            isOwnMessage={forwardedIsOwnMessage}
            selectable={false}
          />
        ) : null}
        {showPostedIn ? (
          <View
            className='mt-2 flex-row items-center gap-1.5 self-stretch'
            style={{ maxWidth: '100%' }}
          >
            <CornerUpRight size={12} color={linkColor} />
            <Text className='text-xs' style={{ color: linkColor }}>
              Posted in
            </Text>
            {isDM || isGroupDM ? (
              <MessageSquare size={12} color={linkColor} />
            ) : isPrivate ? (
              <Lock size={12} color={linkColor} />
            ) : (
              <Hash size={12} color={linkColor} />
            )}
            <Text
              className={cn('text-xs', !(isDM || isGroupDM) && 'font-medium')}
              style={{ color: linkColor, flexShrink: 1, minWidth: 0 }}
              numberOfLines={1}
              ellipsizeMode='tail'
            >
              {postedInName}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </DebugBoundary>
  );
});
Forwarded.displayName = 'MessageComposer.Forwarded';

export { Forwarded };
