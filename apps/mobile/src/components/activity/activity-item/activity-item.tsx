import React, { useMemo } from 'react';
import { Text, View, Pressable, Linking } from 'react-native';
import { formatDistanceToNowStrict, format, isToday } from 'date-fns';
import { router } from 'expo-router';
import { EnrichedMarkdownText } from 'react-native-enriched-markdown';
import { useCSSVariable } from 'uniwind';
import Avatar from '@/src/components/ui/avatar';
import { cn } from '@/src/utils/cn';
import { ActivityItemProps } from './activity-item.types';
import {
  getActivityDescription,
  getActivityIconType,
  getActivityActionText,
  truncateChannelNameForActivity,
  getActivityPreviewSegmentsFromHtml,
} from './activity-item.utils';
import { activityItemMarkdownStyle } from './activity-item.styles';
import { useChannelById, useChannelDisplayName } from '@/src/hooks/useChannels';
import { useUser } from '@/src/hooks/useUsers';
import { useAuth } from '@/src/contexts/AuthContext';
import { useZero } from '@/src/hooks/useZero';
import { mutators } from '@/src/zero/mutators';
import {
  htmlToMD,
  MENTION_USER_SCHEME,
  MENTION_CHANNEL_SCHEME,
} from '@/src/components/chat/message/htmlToMD';
import { parseReactionsMd, getMostRecentEmoji, parseTicketMd } from '@xyne/shared';
import { MentionIcon, TicketBadgeIcon, TurnUpLeftIcon } from '@/src/components/icons';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { navigateToMessage } from '@/src/components/activity/activity-v2-nav';
import { shouldOpenActivityThread } from '@/src/components/activity/activity-v2-navigation-logic';
import { isSafeExternalUrl } from '@/src/utils/webViewSecurity';
import {
  createChatOpenIntent,
  executeChatOpenIntent,
} from '@/src/features/chat/navigation/chatOpenIntent';

const openMentionedChannel = (channelId: string): void => {
  const intent = createChatOpenIntent({ channelId, openStartedAtMs: Date.now() }, 'activity');
  if (intent) executeChatOpenIntent(router, intent);
};

const ActivityItem = ({ activity }: ActivityItemProps) => {
  const zero = useZero();
  const { user } = useAuth();
  const actorUser = useUser(activity.actorId);
  const channel = useChannelById(activity.channelId ?? '');

  const isUnread = !activity.isRead;

  const foreground = useCSSVariable('--color-foreground') as string;
  const muted = useCSSVariable('--color-secondary-foreground') as string;
  const tertiary = useCSSVariable('--color-tertiary') as string;
  const border = useCSSVariable('--color-border') as string;
  const accent = useCSSVariable('--color-accent') as string;
  const input = useCSSVariable('--color-input') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const card = useCSSVariable('--color-card') as string;

  const mentionYouBg = useCSSVariable('--color-yellow-100') as string;
  const mentionYouText = useCSSVariable('--color-yellow-700') as string;
  const mentionOtherBg = useCSSVariable('--color-blue-100') as string;
  const mentionOtherText = useCSSVariable('--color-blue-700') as string;
  const mentionSpecialBg = useCSSVariable('--color-red-100') as string;

  const markdownTheme = useMemo(
    () => ({
      foreground,
      muted,
      tertiary,
      border,
      accent,
      input,
      brand,
      codeForeground: foreground,
      strong: foreground,
      em: foreground,
      link: '#058ced',
    }),
    [foreground, muted, tertiary, border, accent, input, brand],
  );

  const timeDisplay = useMemo(() => {
    const date = new Date(activity.createdAt);
    if (isToday(date)) {
      return format(date, 'hh:mm a'); // e.g., "02:40 PM"
    }
    return formatDistanceToNowStrict(date, { addSuffix: false });
  }, [activity.createdAt]);

  const handlePress = () => {
    if (!activity.isRead) {
      void zero.mutate(mutators.activities.markAsRead({ activityId: activity.id }));
    }

    const message = activity.message;
    const conversation = message?.conversation;
    const ticketFromConversationMd = parseTicketMd(conversation?.ticket_md ?? null);
    const ticketId =
      activity.ticketId ??
      activity.ticket?.id ??
      conversation?.ticketId ??
      ticketFromConversationMd?.id ??
      null;

    const isThreadReply = shouldOpenActivityThread({
      actorAction: activity.actorAction,
      ...(conversation?.conversationId ? { conversationId: conversation.conversationId } : {}),
      ...(conversation?.initialMessageId
        ? { initialMessageId: conversation.initialMessageId }
        : {}),
      ...(activity.isThreadActivity !== undefined
        ? { isThreadActivity: activity.isThreadActivity }
        : {}),
      ...(message?.messageId ? { messageId: message.messageId } : {}),
    });

    if (ticketId && isThreadReply) {
      router.push({
        pathname: '/ticket/[ticketId]',
        params: {
          ticketId,
          selectedTab: 'thread',
          ...((conversation?.channelId ?? activity.channelId)
            ? { channelId: conversation?.channelId ?? activity.channelId }
            : {}),
          ...((conversation?.conversationId ?? activity.conversationId)
            ? { threadId: conversation?.conversationId ?? activity.conversationId }
            : {}),
          ...(message?.messageId ? { messageId: message.messageId } : {}),
        },
      });
      return;
    }

    if (ticketId && activity.ticket) {
      router.push({
        pathname: '/ticket/[ticketId]',
        params: {
          ticketId,
          selectedTab: 'activity',
        },
      });
      return;
    }

    const channelId = activity.channelId;
    if (!channelId) return;

    navigateToMessage({
      channelId,
      ...(conversation?.conversationId ? { conversationId: conversation.conversationId } : {}),
      ...(message?.messageId ? { messageId: message.messageId } : {}),
      isThreadReply,
      ...(typeof conversation?.createdAt === 'number'
        ? { conversationCreatedAt: conversation.createdAt }
        : {}),
    });
  };

  const iconType = getActivityIconType(activity);
  const description = getActivityDescription(activity);
  const contentHtml = activity.message?.content ?? null;
  const channelName = useChannelDisplayName(channel, user?.user_id as string);
  const actorName = actorUser?.name || actorUser?.email || '';
  const actionText = getActivityActionText(activity, user?.user_id);

  // Debug logging for missing action text
  if (!actionText && actorName) {
    console.log('[ActivityItem] Missing action text:', {
      actorAction: activity.actorAction,
      actorName,
      channelName,
      activityId: activity.id,
    });
  }
  // Get reaction emoji - handle both v1 (activity.reaction) and v2 (message.reactions_md) formats
  const reactionEmoji = useMemo(() => {
    const isV2 = activity.actorAction === 'added_v2' || activity.actorAction === 'removed_v2';

    if (isV2 && activity.message?.reactions_md) {
      const reactionsData = parseReactionsMd(activity.message.reactions_md);
      return getMostRecentEmoji(reactionsData);
    }

    // Fallback to v1 format
    return activity.reaction?.emojiName;
  }, [activity]);

  const badgeIconColor = foreground;

  const renderBadgeIcon = () => {
    switch (iconType) {
      case 'mention':
        return <MentionIcon width={20} height={20} color={badgeIconColor} />;
      case 'reply':
        return <TurnUpLeftIcon width={12} height={12} color={badgeIconColor} />;
      case 'reaction':
        return (
          <View className='items-center justify-center'>
            <ReactionEmojiDisplay emojiName={reactionEmoji ?? ''} size={14} />
          </View>
        );
      case 'ticket':
        return <TicketBadgeIcon width={10} height={10} color={badgeIconColor} />;
      case 'warning':
        return <Text className='text-[9px]'>⚠️</Text>;
      case 'message':
        return <Text className='text-[9px]'>✉️</Text>;
      default:
        return <Text className='text-[9px]'>•</Text>;
    }
  };

  const markdown = useMemo(() => {
    if (!contentHtml) return '';
    return htmlToMD(contentHtml);
  }, [contentHtml]);

  const previewSegments = useMemo(() => {
    return getActivityPreviewSegmentsFromHtml(contentHtml);
  }, [contentHtml]);

  const hasHighlightableMentions = useMemo(() => {
    return previewSegments.some(s => s.type !== 'text');
  }, [previewSegments]);

  const truncateMarkdown = (md: string, maxLines: number = 3): string => {
    const lines = md.split('\n');

    if (lines.length <= maxLines) return md;
    return lines.slice(0, maxLines).join('\n') + '...';
  };

  const unreadBackground = accent?.toLowerCase?.() === border?.toLowerCase?.() ? input : accent;
  const cardBackground = isUnread ? unreadBackground : card;
  const actorColor = foreground;
  const actionColor = muted;
  const timeColor = tertiary;

  return (
    <Pressable
      onPress={handlePress}
      className={cn('px-3 py-3 border-transparent', isUnread ? 'bg-foreground/5' : 'bg-card')}
      style={{
        backgroundColor: cardBackground,
        // borderBottomColor: border,
        // borderBottomWidth: StyleSheet.hairlineWidth,
      }}
    >
      <View className='flex-row items-start gap-3'>
        {/* Avatar with badge */}
        <View className='items-center'>
          <View className='relative'>
            {actorName ? (
              <View className='border border-transparent rounded-lg overflow-hidden'>
                <Avatar
                  userIds={activity.actorId ? [activity.actorId] : []}
                  size={40}
                  rounded={false}
                />
              </View>
            ) : (
              <View
                className='w-10 h-10 rounded-lg items-center justify-center border border-transparent'
                style={{ backgroundColor: accent }}
              >
                <Text style={{ color: foreground }}>@</Text>
              </View>
            )}
            {/* Activity type badge */}
            <View
              className={cn(
                'absolute -bottom-1 -right-1 w-[22px] h-[22px] rounded-full items-center justify-center',
                'bg-card border border-border',
              )}
            >
              {renderBadgeIcon()}
            </View>
          </View>
        </View>

        {/* Content */}
        <View className='flex-1 gap-2'>
          {/* Header: Actor name + action + channel */}
          <View className='flex-row items-start'>
            <View className='flex-1'>
              <Text
                className='flex-1 text-[18px] font-bold text-primary-text leading-[22px]'
                numberOfLines={2}
              >
                <Text style={{ color: actorColor }}>{actorName}</Text>
              </Text>
              <Text className='mt-1 text-sm font-medium'>
                <Text style={{ color: actionColor }}>{actionText.trim()}</Text>
                {channelName && <Text style={{ color: actionColor }}> in </Text>}
                {channelName && (
                  <Text style={{ color: actorColor }}>
                    {truncateChannelNameForActivity(channelName)}
                  </Text>
                )}
              </Text>
            </View>
            {/* Timestamp below avatar */}
            <Text className='shrink-0 text-[15px]' style={{ color: timeColor }}>
              {timeDisplay}
            </Text>
          </View>

          {/* Message preview - max 2 lines */}
          {markdown.trim() ? (
            <View className='mt-2' style={{ maxHeight: 54, overflow: 'hidden' }}>
              {hasHighlightableMentions ? (
                <Text
                  className='text-[16px] leading-[24px]'
                  numberOfLines={2}
                  ellipsizeMode='tail'
                  style={{ color: isUnread ? foreground : muted }}
                >
                  {previewSegments.map((seg, idx) => {
                    const next = previewSegments[idx + 1];
                    const nextText = next?.type === 'text' ? next.text : '';
                    const shouldSpaceAfterMention =
                      next !== null &&
                      next !== undefined &&
                      // Always space before another mention chip.
                      (next.type !== 'text' ||
                        // Space before normal words, but not before punctuation.
                        !/^[,.;:!?)/\]]/.test(nextText));

                    if (seg.type === 'text') {
                      return <Text key={`t-${idx}`}>{seg.text}</Text>;
                    }

                    if (seg.type === 'specialMention') {
                      return (
                        <React.Fragment key={`s-${idx}`}>
                          <Text
                            style={{
                              backgroundColor: mentionSpecialBg,
                              color: mentionOtherText, // Change to mentionOtherText for blue text
                              fontWeight: '600',
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: border,
                              overflow: 'hidden',
                            }}
                          >
                            {seg.label}
                          </Text>
                          {shouldSpaceAfterMention ? <Text> </Text> : null}
                        </React.Fragment>
                      );
                    }

                    if (seg.type === 'channelMention') {
                      return (
                        <React.Fragment key={`c-${idx}`}>
                          <Text
                            onPress={() => {
                              openMentionedChannel(seg.channelId);
                            }}
                            style={{
                              backgroundColor: mentionSpecialBg,
                              color: mentionOtherText, // Change to mentionOtherText for blue text
                              fontWeight: '600',
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 999,
                              borderWidth: 1,
                              borderColor: border,
                              overflow: 'hidden',
                            }}
                          >
                            {seg.label}
                          </Text>
                          {shouldSpaceAfterMention ? <Text> </Text> : null}
                        </React.Fragment>
                      );
                    }

                    const isYou =
                      seg.type === 'userMention' &&
                      Boolean(user?.user_id) &&
                      seg.userId === user?.user_id;

                    const bg = isYou ? mentionYouBg : mentionOtherBg;
                    const color = isYou ? mentionYouText : mentionOtherText;

                    return (
                      <React.Fragment key={`m-${idx}`}>
                        <Text
                          style={{
                            backgroundColor: bg,
                            color,
                            fontWeight: '600',
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: border,
                            overflow: 'hidden',
                          }}
                        >
                          {seg.label}
                        </Text>
                        {shouldSpaceAfterMention ? <Text> </Text> : null}
                      </React.Fragment>
                    );
                  })}
                </Text>
              ) : (
                <EnrichedMarkdownText
                  markdown={truncateMarkdown(markdown, 2)}
                  markdownStyle={activityItemMarkdownStyle({ isUnread, theme: markdownTheme })}
                  containerStyle={{ maxWidth: '100%' }}
                  md4cFlags={{ underline: true, latexMath: false }}
                  selectable={false}
                  onLinkPress={({ url }) => {
                    if (url.startsWith(MENTION_USER_SCHEME)) {
                      return;
                    }
                    if (url.startsWith(MENTION_CHANNEL_SCHEME)) {
                      const channelIdFromLink = decodeURIComponent(
                        url.slice(MENTION_CHANNEL_SCHEME.length),
                      );
                      openMentionedChannel(channelIdFromLink);
                      return;
                    }
                    if (isSafeExternalUrl(url)) {
                      void Linking.openURL(url).catch(() => undefined);
                    }
                  }}
                />
              )}
            </View>
          ) : description ? (
            <Text
              className={cn(
                'text-[16px] leading-5 mt-0.5',
                isUnread ? 'text-foreground' : 'text-secondary-foreground',
              )}
              numberOfLines={2}
            >
              {description}
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

export default ActivityItem;
