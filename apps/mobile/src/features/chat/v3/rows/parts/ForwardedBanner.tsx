import { type ReactElement } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { ChannelScopeType, ChannelVisibility, type ForwardedMessageData } from '@xyne/shared';
import { CornerUpRight, Hash, Lock, MessageSquare } from 'lucide-react-native';

import { useChannel } from '@/src/hooks/useChannels';
import { useForwardedMessageNavigation } from '@/src/hooks/useForwardedMessageNavigation';

import type { ForwardedPreview, MessageRowModel } from '../../model/chatRow.types';
import { useChatRenderTokens } from '../../theme/ChatRenderProvider';
import { useSenderColor } from '../useSenderColor';
import { ForwardedMessageBody } from './ForwardedMessageBody';

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

export function ForwardedBanner({
  forwarded,
  mine,
  model,
}: {
  forwarded: ForwardedPreview;
  mine: boolean;
  model: MessageRowModel;
}): ReactElement {
  const tokens = useChatRenderTokens();
  const nameColor = useSenderColor(forwarded.colorIndex);
  const originalChannel = useChannel(forwarded.originalChannelId ?? '');
  const openForwardedSource = useForwardedMessageNavigation();
  const accent = forwarded.originalSenderId ? nameColor : tokens.foreground;
  const timestamp = forwarded.originalCreatedAt ? formatTime(forwarded.originalCreatedAt) : null;
  const linkColor = mine ? tokens.linkColorUser : tokens.linkColor;
  const isDM = originalChannel?.scopeType === ChannelScopeType.DM;
  const isGroupDM = originalChannel?.scopeType === ChannelScopeType.GROUP_DM;
  const isPrivate = originalChannel?.visibility === ChannelVisibility.PRIVATE;
  const showPostedIn = Boolean(
    originalChannel && forwarded.originalChannelId && forwarded.originalConversationId,
  );
  const postedInName = isDM
    ? 'Direct Message'
    : isGroupDM
      ? 'Group Message'
      : (originalChannel?.name ?? 'Unknown Channel');

  const handlePress = (event: GestureResponderEvent): void => {
    event.stopPropagation();
    if (!showPostedIn) return;
    const payload: ForwardedMessageData = {
      originalMessageId: forwarded.originalMessageId ?? '',
      originalSenderId: forwarded.originalSenderId ?? '',
      originalSenderName: forwarded.fromName,
      originalCreatedAt: forwarded.originalCreatedAt ?? 0,
      originalChannelId: forwarded.originalChannelId,
      originalConversationId: forwarded.originalConversationId ?? '',
      optionalText: null,
      content: '',
    };
    void openForwardedSource(payload);
  };

  return (
    <Pressable
      accessibilityRole={showPostedIn ? 'button' : undefined}
      accessibilityLabel={showPostedIn ? `Forwarded message posted in ${postedInName}` : undefined}
      disabled={!showPostedIn}
      onPress={handlePress}
      className='mb-2 gap-1 rounded-md py-1.5 pl-2 pr-2'
      style={{
        borderLeftWidth: 3,
        borderLeftColor: accent,
        backgroundColor: mine ? tokens.forwardedBgUser : tokens.forwardedBgOther,
      }}
    >
      <View className='w-full flex-row items-center gap-2 overflow-hidden'>
        <Text
          className='min-w-0 shrink text-sm font-semibold'
          style={{ color: accent, flexShrink: 1, minWidth: 0 }}
          numberOfLines={1}
          ellipsizeMode='tail'
        >
          {forwarded.fromName || 'Unknown User'}
        </Text>
        {timestamp ? (
          <Text
            className={`shrink-0 text-[10px] ${mine ? '' : 'text-secondary-foreground'}`}
            style={[{ flexShrink: 0 }, mine ? { color: tokens.rootMetaUser } : null]}
            numberOfLines={1}
          >
            {timestamp}
          </Text>
        ) : null}
      </View>
      {forwarded.originalMarkdown.trim() ? (
        <ForwardedMessageBody forwarded={forwarded} model={model} mine={mine} />
      ) : null}
      {showPostedIn ? (
        <View className='mt-2 flex-row items-center gap-1.5 self-stretch'>
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
            className={`text-xs ${isDM || isGroupDM ? '' : 'font-medium'}`}
            style={{ color: linkColor, flexShrink: 1, minWidth: 0 }}
            numberOfLines={1}
            ellipsizeMode='tail'
          >
            {postedInName}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
