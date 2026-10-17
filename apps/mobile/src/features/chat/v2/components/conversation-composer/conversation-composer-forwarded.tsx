import { memo, useMemo, type ReactElement } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { ConversationComposerMarkdownBody } from './conversation-composer-markdown-body';
import { FlowJsonMessageParts } from './flow-json-message';
import { useCSSVariable } from 'uniwind';
import { CornerUpRight, Hash, Lock, MessageSquare } from 'lucide-react-native';
import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';

import { useConversationComposer } from './conversation-composer-context';
import { htmlToMD } from './utils/htmlToMD';
import { buildComposerMarkdownStyle } from './utils/markdownStyle';
import { useUserColor } from './utils/getUserColor';
import { DebugBoundary } from './utils/debug-boundary';
import { useChannel } from '@/src/hooks/useChannels';
import { cn } from '@/src/utils/cn';
import { useChatRenderTokens } from '@/src/features/chat/v2/components/chat/message-row';
import { useForwardedMessageNavigation } from '@/src/hooks/useForwardedMessageNavigation';
import { flowDefinitionToMarkdown, parseFlowJsonParts } from '@/src/utils/flowJsonMarkdown';
import { useMentionPress } from './utils/useMentionPress';
import { useFlowNormalizationOptions } from './utils/useFlowNormalizationOptions';

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
  const { summary, forwarded, currentUser, kind } = useConversationComposer();
  const openForwardedSource = useForwardedMessageNavigation();
  const handleMentionPress = useMentionPress();
  const {
    embeddedBgUser,
    embeddedMutedUser,
    embeddedTitleUser,
    linkColor,
    linkColorUser,
    rootAccentUser,
    rootMetaUser,
  } = useChatRenderTokens();
  const isOwnBubble = kind === 'CURRENT_USER';

  const foregroundRaw = useCSSVariable('--color-foreground') as string;
  const foregroundMutedRaw = useCSSVariable('--color-muted') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const forwardedBgOther = useCSSVariable(
    '--color-conversation-composer-forwarded-bg-other',
  ) as string;
  const foreground = isOwnBubble ? embeddedTitleUser : foregroundRaw;
  const foregroundMuted = isOwnBubble ? embeddedMutedUser : foregroundMutedRaw;
  const resolvedLinkColor = isOwnBubble ? linkColorUser : linkColor;
  const flowNormalizationOptions = useFlowNormalizationOptions();
  const flowParts = useMemo(
    () => parseFlowJsonParts(forwarded?.content ?? ''),
    [forwarded?.content],
  );
  const hasFlowJson = flowParts.some(part => part.type === 'flow');
  const markdown = useMemo(
    () =>
      hasFlowJson
        ? flowParts
            .map(part =>
              part.type === 'flow'
                ? flowDefinitionToMarkdown(part.definition, flowNormalizationOptions)
                : htmlToMD(part.html),
            )
            .filter(Boolean)
            .join('\n\n')
        : htmlToMD(forwarded?.content ?? ''),
    [flowParts, forwarded?.content, hasFlowJson, flowNormalizationOptions],
  );

  const originalSenderColor = useUserColor(forwarded?.originalSenderId ?? '');
  const originalChannel = useChannel(forwarded?.originalChannelId ?? '');

  const markdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground,
        foregroundMuted,
        cardBg,
        brand,
        linkColor: resolvedLinkColor,
        variant: 'quoted',
      }),
    [foreground, foregroundMuted, cardBg, brand, resolvedLinkColor],
  );

  if (!forwarded) return null;
  if (summary?.visibleTo && summary.visibleTo !== currentUser?.id) return null;

  const nameColor = isOwnBubble
    ? rootAccentUser
    : forwarded.originalSenderId
      ? originalSenderColor
      : foreground;
  const timestamp = forwarded.originalCreatedAt ? formatTime(forwarded.originalCreatedAt) : null;
  const backgroundColor = isOwnBubble ? embeddedBgUser : forwardedBgOther;
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
              className={cn('shrink-0 text-[10px]', isOwnBubble ? '' : 'text-secondary-foreground')}
              style={[{ flexShrink: 0 }, isOwnBubble ? { color: rootMetaUser } : null]}
              numberOfLines={1}
            >
              {timestamp}
            </Text>
          ) : null}
        </View>
        {markdown.trim() ? (
          hasFlowJson ? (
            <FlowJsonMessageParts
              parts={flowParts}
              markdownStyle={markdownStyle}
              containerStyle={{ maxWidth: '100%' }}
              onLinkPress={url => {
                void handleMentionPress(url);
              }}
              {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
              isOwnMessage={forwardedIsOwnMessage}
              selectable={false}
            />
          ) : (
            <ConversationComposerMarkdownBody
              markdown={markdown}
              markdownStyle={markdownStyle}
              containerStyle={{ maxWidth: '100%' }}
              onLinkPress={({ url }) => {
                void handleMentionPress(url);
              }}
              {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
              isOwnMessage={forwardedIsOwnMessage}
              selectable={false}
            />
          )
        ) : null}
        {showPostedIn ? (
          <View
            className='mt-2 flex-row items-center gap-1.5 self-stretch'
            style={{ maxWidth: '100%' }}
          >
            <CornerUpRight size={12} color={resolvedLinkColor} />
            <Text className='text-xs' style={{ color: resolvedLinkColor }}>
              Posted in
            </Text>
            {isDM || isGroupDM ? (
              <MessageSquare size={12} color={resolvedLinkColor} />
            ) : isPrivate ? (
              <Lock size={12} color={resolvedLinkColor} />
            ) : (
              <Hash size={12} color={resolvedLinkColor} />
            )}
            <Text
              className={cn('text-xs', !(isDM || isGroupDM) && 'font-medium')}
              style={{ color: resolvedLinkColor, flexShrink: 1, minWidth: 0 }}
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
Forwarded.displayName = 'ConversationComposer.Forwarded';

export { Forwarded };
