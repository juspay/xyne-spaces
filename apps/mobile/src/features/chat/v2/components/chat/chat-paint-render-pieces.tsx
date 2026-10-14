import { Image } from 'expo-image';
import { memo, useCallback, type ReactElement, type ReactNode } from 'react';
import {
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useUniwind } from 'uniwind';
import {
  ChevronRight,
  Download,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Play,
  Smile,
  Ticket,
  TriangleAlert,
  Video,
} from 'lucide-react-native';

import Avatar from '@/src/components/ui/avatar';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';
import { cn } from '@/src/utils/cn';
import {
  ATTACHMENT_GRID_GAP,
  ATTACHMENT_GRID_HEIGHT,
  FILE_ATTACHMENT_CARD_HEIGHT,
  formatAttachmentDuration,
} from '@/src/features/chat/v2/components/conversation-composer/attachment-layout';
import { getSenderAvatarFallbackUsers } from '@/src/features/chat/v2/paint/chatPaintAvatarFallback';
import { CHAT_PAINT_PARENT_PREVIEW_HEIGHT_PX } from '@/src/features/chat/v2/paint/chatPaintSizing';
import {
  invalidateMediaPreview,
  useMediaPreviewUri,
} from '@/src/features/chat/v2/media/mediaPreviewCache';
import { ReactionEmojiDisplay } from '@/src/components/chat/message/reactions/reaction-emoji-display';
import { openAttachmentsViewer } from '@/src/components/attachments-viewer/utils/openAttachmentsViewer';
import { getAttachmentMediaKind } from '@/src/components/attachments-viewer/utils/file-viewer';
import { getFileTypeConfig } from '@/src/components/chat/file-attachment-card';
import { formatFileSize } from '@/src/components/chat/message/message-attachments.utils';
import { useMtlsEmojiUris } from '@/src/hooks/useMtlsEmoji';
import { COMPOSER_INLINE_EMOJI_RENDER_SIZE } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownStyle';

import { useChatRenderTokens } from './message-row';
import { useReactionsSheet } from './reactions-sheet-host';

const TICKET_ID_BADGE_LIGHT_TEXT = '#6f4700';
const TICKET_ID_BADGE_DARK_TEXT = '#f6d46b';

const colorLooksLight = (color: string): boolean => {
  const value = color.toLowerCase();
  return value.includes('255') || value.includes('fff') || value.includes('white');
};

const PaintMediaIcon = ({
  kind,
  color,
}: {
  kind: 'image' | 'video' | 'file' | 'mixed';
  color: string;
}): ReactElement => {
  switch (kind) {
    case 'video':
      return <Video size={14} color={color} />;
    case 'image':
      return <ImageIcon size={14} color={color} />;
    default:
      return <Paperclip size={14} color={color} />;
  }
};

type PaintMediaAttachment = NonNullable<ChatPaintRow['mediaPlaceholder']>['attachments'][number];
type PaintMediaKind = 'image' | 'video' | 'file' | 'mixed';

const getAttachmentPreviewKind = (attachment: PaintMediaAttachment): 'image' | 'video' | null =>
  getAttachmentMediaKind(attachment.mimetype, attachment.originalFilename);

const PaintMediaCell = memo(function PaintMediaCell({
  attachment,
  fallbackUri,
  overflowCount,
}: {
  attachment: PaintMediaAttachment;
  fallbackUri?: string | null | undefined;
  overflowCount?: number | undefined;
}): ReactElement {
  const { mutedForeground } = useChatRenderTokens();
  const previewKind = getAttachmentPreviewKind(attachment);
  const previewUri = useMediaPreviewUri(attachment.id, previewKind);
  const uri = previewUri ?? fallbackUri;
  const iconKind: PaintMediaKind =
    previewKind === 'image' ? 'image' : previewKind === 'video' ? 'video' : 'file';

  return (
    <View className='flex-1 overflow-hidden rounded bg-muted'>
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          cachePolicy='memory-disk'
          contentFit='contain'
          recyclingKey={attachment.id}
          onError={() => {
            if (previewUri) {
              invalidateMediaPreview(attachment.id, previewKind, previewUri);
            }
          }}
        />
      ) : (
        <View className='h-full w-full items-center justify-center'>
          <PaintMediaIcon kind={iconKind} color={mutedForeground} />
        </View>
      )}
      {previewKind === 'video' ? (
        <View className='absolute inset-0 items-center justify-center'>
          <View className='h-9 w-9 items-center justify-center rounded-full bg-black/50'>
            <Play size={16} color='#fff' fill='#fff' />
          </View>
        </View>
      ) : null}
      {overflowCount !== undefined && overflowCount > 0 ? (
        <View className='absolute inset-0 items-center justify-center bg-black/50'>
          <Text className='text-xl font-semibold text-white'>+{overflowCount}</Text>
        </View>
      ) : null}
    </View>
  );
});

const PaintMediaGrid = memo(function PaintMediaGrid({
  media,
  thumbnailUri,
}: {
  media: NonNullable<ChatPaintRow['mediaPlaceholder']>;
  thumbnailUri: string | null | undefined;
}): ReactElement {
  const { mutedForeground } = useChatRenderTokens();
  const visible = media.attachments.slice(0, 4);
  const overflow = Math.max(0, media.attachments.length - 4);
  const first = visible[0];
  const second = visible[1];
  const third = visible[2];
  const fourth = visible[3];

  if (!first) {
    return (
      <View className='h-full w-full items-center justify-center overflow-hidden rounded bg-muted'>
        <PaintMediaIcon kind={media.mediaKind as PaintMediaKind} color={mutedForeground} />
      </View>
    );
  }

  if (visible.length === 1) {
    return <PaintMediaCell attachment={first} fallbackUri={thumbnailUri} />;
  }

  if (visible.length === 2 && second) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
        <PaintMediaCell
          attachment={first}
          fallbackUri={first.id === media.previewAttachmentId ? thumbnailUri : undefined}
        />
        <PaintMediaCell
          attachment={second}
          fallbackUri={second.id === media.previewAttachmentId ? thumbnailUri : undefined}
        />
      </View>
    );
  }

  if (visible.length === 3 && second && third) {
    return (
      <View style={{ flex: 1, gap: ATTACHMENT_GRID_GAP }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
          <PaintMediaCell
            attachment={first}
            fallbackUri={first.id === media.previewAttachmentId ? thumbnailUri : undefined}
          />
          <PaintMediaCell
            attachment={second}
            fallbackUri={second.id === media.previewAttachmentId ? thumbnailUri : undefined}
          />
        </View>
        <View style={{ flex: 1 }}>
          <PaintMediaCell
            attachment={third}
            fallbackUri={third.id === media.previewAttachmentId ? thumbnailUri : undefined}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, gap: ATTACHMENT_GRID_GAP }}>
      <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
        <PaintMediaCell
          attachment={first}
          fallbackUri={first.id === media.previewAttachmentId ? thumbnailUri : undefined}
        />
        {second ? (
          <PaintMediaCell
            attachment={second}
            fallbackUri={second.id === media.previewAttachmentId ? thumbnailUri : undefined}
          />
        ) : null}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', gap: ATTACHMENT_GRID_GAP }}>
        {third ? (
          <PaintMediaCell
            attachment={third}
            fallbackUri={third.id === media.previewAttachmentId ? thumbnailUri : undefined}
          />
        ) : null}
        {fourth ? (
          <PaintMediaCell
            attachment={fourth}
            fallbackUri={fourth.id === media.previewAttachmentId ? thumbnailUri : undefined}
            overflowCount={overflow}
          />
        ) : null}
      </View>
    </View>
  );
});

const PaintMediaPlaceholder = memo(function PaintMediaPlaceholder({
  media,
}: {
  media: NonNullable<ChatPaintRow['mediaPlaceholder']>;
}): ReactElement {
  const { mutedForeground } = useChatRenderTokens();
  const router = useRouter();
  const isMediaGrid =
    media.mediaKind === 'image' || media.mediaKind === 'video' || media.mediaKind === 'mixed';
  const name = media.firstAttachmentName ?? 'Attachment';
  const firstAttachment = media.attachments[0];
  const canOpenViewer = media.attachments.length > 0;
  const prefetchedPreviewUri = useMediaPreviewUri(
    media.previewAttachmentId,
    media.previewAttachmentKind,
  );
  const thumbnailUri = prefetchedPreviewUri ?? media.cachedThumbUri;
  const duration =
    media.mediaKind === 'video' &&
    typeof media.durationSeconds === 'number' &&
    media.durationSeconds > 0
      ? formatAttachmentDuration(media.durationSeconds)
      : null;
  const handleOpen = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (!canOpenViewer) return;
      const initialIndex = Math.max(
        0,
        media.attachments.findIndex(attachment => attachment.id === media.previewAttachmentId),
      );
      openAttachmentsViewer(router, {
        attachments: media.attachments,
        initialIndex,
        source: { kind: 'message', id: media.previewAttachmentId ?? media.attachments[0]!.id },
      });
    },
    [canOpenViewer, media.attachments, media.previewAttachmentId, router],
  );

  if (!isMediaGrid) {
    // Same type resolution as the hydrated FileAttachmentCard, so the lite paint
    // row and the rich row show the identical icon / colour / label for a file.
    const fileTypeConfig = getFileTypeConfig(firstAttachment?.mimetype ?? '', name);
    const FileTypeIcon = fileTypeConfig.icon;
    const fileSizeLabel =
      typeof firstAttachment?.size === 'number' && firstAttachment.size > 0
        ? formatFileSize(firstAttachment.size)
        : null;
    const fileMetaLabel =
      media.attachmentCount > 1
        ? `${fileTypeConfig.label} • ${media.attachmentCount} files`
        : [fileTypeConfig.label, fileSizeLabel].filter(Boolean).join(' • ');

    return (
      <Pressable
        onPress={handleOpen}
        disabled={!canOpenViewer}
        className='mb-2.5 flex-row items-center'
        style={({ pressed }) => [
          { width: '100%', height: FILE_ATTACHMENT_CARD_HEIGHT },
          pressed && canOpenViewer ? { opacity: 0.85 } : null,
        ]}
      >
        <View
          className='flex-row items-center rounded-[10px] border border-border bg-tertiary-bg px-3 py-2.5'
          style={{ width: '100%', gap: 12 }}
        >
          <View
            className='items-center justify-center rounded-[10px]'
            style={{ width: 52, height: 52, backgroundColor: fileTypeConfig.color }}
          >
            <FileTypeIcon size={28} color='#fff' strokeWidth={2.2} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text className='text-base font-semibold text-foreground' numberOfLines={1}>
              {name}
            </Text>
            <Text className='mt-1 text-[13px] text-tertiary' numberOfLines={1}>
              {fileMetaLabel}
            </Text>
          </View>
          <View className='items-center justify-center' style={{ width: 32, height: 32 }}>
            <Download size={20} color={mutedForeground} strokeWidth={2} />
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={handleOpen}
      disabled={!canOpenViewer}
      className='mb-2.5'
      style={({ pressed }) => [
        { height: ATTACHMENT_GRID_HEIGHT, width: '100%' },
        pressed && canOpenViewer ? { opacity: 0.9 } : null,
      ]}
    >
      <View className='h-full w-full overflow-hidden rounded bg-muted'>
        <PaintMediaGrid media={media} thumbnailUri={thumbnailUri} />
        {duration ? (
          <View className='absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5'>
            <Text className='text-[10px] font-medium text-white'>{duration}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const TicketPriorityIndicator = ({
  priority,
  color,
}: {
  priority: string | null;
  color: string;
}): ReactElement => {
  const normalized = priority?.toUpperCase() ?? 'LOW';
  if (normalized === 'CRITICAL') {
    return <TriangleAlert size={14} color={color} strokeWidth={2} />;
  }
  const activeBars = normalized === 'HIGH' ? 3 : normalized === 'MEDIUM' ? 2 : 1;
  return (
    <View className='h-[14px] flex-row items-end gap-[2px]'>
      {[6, 10, 14].map((height, index) => (
        <View
          key={height}
          className='w-[3px] rounded-[1.5px]'
          style={{
            backgroundColor: color,
            height,
            opacity: index < activeBars ? 1 : 0.25,
          }}
        />
      ))}
    </View>
  );
};

const ticketIdLabel = (ticketId: string): string => ticketId.trim() || 'TICKET';

const TicketAssigneeRow = ({
  assignee,
}: {
  assignee: NonNullable<ChatPaintRow['ticketPreview']>['assignee'];
}): ReactElement | null => {
  if (!assignee?.senderId && !assignee?.displayName) return null;
  return (
    <>
      <View className='h-[0.5px] w-full bg-ticket-overview-divider' />
      <View className='flex-row items-center gap-1.5'>
        <Avatar
          userIds={assignee?.senderId ? [assignee.senderId] : []}
          fallbackUsers={getSenderAvatarFallbackUsers(assignee)}
          size={20}
        />
        <Text
          className='min-w-0 shrink text-sm font-medium leading-5 text-ticket-priority-critical'
          numberOfLines={1}
        >
          {assignee?.displayName ?? 'Assignee'}
        </Text>
      </View>
    </>
  );
};

/**
 * Card container for the paint-path ticket preview. Becomes pressable only when
 * the host supplies `onPress` (e.g. the parent ticket row inside ticket
 * details), so the card is a smaller tap target than the surrounding bubble.
 * The long-press handler is forwarded too, otherwise this nested Pressable
 * would swallow the bubble's long-press → message actions gesture.
 */
const PaintTicketCardShell = ({
  className,
  style,
  onPress,
  onLongPress,
  children,
}: {
  className: string;
  style: StyleProp<ViewStyle>;
  onPress?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
  children: ReactNode;
}): ReactElement => {
  if (!onPress) {
    return (
      <View className={className} style={style}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      className={className}
      style={({ pressed }) => [style, pressed ? { opacity: 0.7 } : null]}
      onPress={onPress}
      {...(onLongPress ? { onLongPress } : {})}
      delayLongPress={300}
    >
      {children}
    </Pressable>
  );
};

const PaintTicketPreviewCard = memo(function PaintTicketPreviewCard({
  row,
  isCurrentUser,
  onPress,
  onLongPress,
}: {
  row: ChatPaintRow;
  isCurrentUser: boolean;
  onPress?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
}): ReactElement | null {
  const {
    embeddedBgUser,
    embeddedMutedUser,
    embeddedTitleUser,
    rootAccentUser,
    ticketPriorityLowColor,
  } = useChatRenderTokens();
  const { theme } = useUniwind();
  const ticket = row.ticketPreview;
  if (!ticket) return null;
  const cardBg = isCurrentUser
    ? 'bg-conversation-composer-forwarded-bg-user'
    : 'bg-conversation-composer-forwarded-bg-other';
  const currentUserUsesLightText =
    colorLooksLight(embeddedTitleUser) || colorLooksLight(rootAccentUser);
  const currentUserBadgeTextColor = currentUserUsesLightText
    ? 'rgba(255, 255, 255, 0.94)'
    : 'rgba(17, 24, 39, 0.86)';
  const currentUserBadgeBg = currentUserUsesLightText
    ? 'rgba(255, 255, 255, 0.16)'
    : 'rgba(17, 24, 39, 0.10)';
  const currentUserBadgeBorder = currentUserUsesLightText
    ? 'rgba(255, 255, 255, 0.22)'
    : 'rgba(17, 24, 39, 0.14)';
  const currentUserBadgeIconBg = currentUserUsesLightText
    ? 'rgba(255, 255, 255, 0.12)'
    : 'rgba(17, 24, 39, 0.08)';
  const otherBadgeTextColor =
    theme === 'dark' ? TICKET_ID_BADGE_DARK_TEXT : TICKET_ID_BADGE_LIGHT_TEXT;
  const ticketBadgeTextColor = isCurrentUser ? currentUserBadgeTextColor : otherBadgeTextColor;
  const ticketBadgeIconBg = isCurrentUser
    ? currentUserBadgeIconBg
    : theme === 'dark'
      ? 'rgba(246, 212, 107, 0.16)'
      : 'rgba(111, 71, 0, 0.10)';

  return (
    <PaintTicketCardShell
      className={cn(
        'mb-2.5 flex w-full flex-col gap-2 self-stretch overflow-hidden rounded-[8px] px-1.5 py-2.5',
        isCurrentUser ? '' : cardBg,
      )}
      style={isCurrentUser ? { backgroundColor: embeddedBgUser } : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View className='flex-row items-center justify-between gap-2'>
        <View
          className={cn(
            'max-w-[50%] shrink flex-row items-center gap-1.5 rounded-full border px-2 py-1',
            isCurrentUser
              ? ''
              : 'border-[#e8c56c] bg-[#fff4d6] dark:border-[#7d5b13] dark:bg-[#3a2a0b]',
          )}
          style={
            isCurrentUser
              ? { backgroundColor: currentUserBadgeBg, borderColor: currentUserBadgeBorder }
              : undefined
          }
        >
          <View
            className='h-4 w-4 shrink-0 items-center justify-center rounded-full'
            style={{ backgroundColor: ticketBadgeIconBg }}
          >
            <Ticket size={10} color={ticketBadgeTextColor} strokeWidth={2.4} />
          </View>
          <Text
            className='min-w-0 shrink text-[10px] font-semibold'
            style={{ color: ticketBadgeTextColor }}
            numberOfLines={1}
          >
            {ticketIdLabel(ticket.ticketId)}
          </Text>
        </View>
        <View className='min-w-0 shrink flex-row items-center justify-end gap-1.5'>
          <TicketPriorityIndicator priority={ticket.priority} color={ticketPriorityLowColor} />
          <View className='min-w-0 shrink flex-row items-center gap-1 rounded-full bg-ticket-label-blue-bg px-1.5 py-0.5'>
            <View className='h-1 w-1 shrink-0 rounded-full bg-ticket-label-blue-text' />
            <Text
              className='min-w-0 shrink text-[12px] font-medium text-ticket-label-blue-text'
              numberOfLines={1}
            >
              {ticket.statusLabel}
            </Text>
          </View>
        </View>
      </View>

      <View className='flex flex-col gap-2 w-full'>
        <View className='flex flex-col gap-1 w-full'>
          <Text
            className={cn(
              'text-base font-medium leading-5',
              isCurrentUser ? '' : 'text-ticket-overview-title-text',
            )}
            style={isCurrentUser ? { color: embeddedTitleUser } : undefined}
            numberOfLines={2}
          >
            {ticket.title}
          </Text>
          {ticket.description ? (
            <Text
              className={cn(
                'text-[14px] font-medium leading-5 opacity-60',
                isCurrentUser ? '' : 'text-ticket-overview-meta-text',
              )}
              style={isCurrentUser ? { color: embeddedMutedUser } : undefined}
              numberOfLines={1}
            >
              {ticket.description}
            </Text>
          ) : null}
        </View>

        <TicketAssigneeRow assignee={ticket.assignee} />
      </View>
    </PaintTicketCardShell>
  );
});

const PaintRecordingPreviewCard = memo(function PaintRecordingPreviewCard({
  row,
  isCurrentUser,
}: {
  row: ChatPaintRow;
  isCurrentUser: boolean;
}): ReactElement | null {
  const router = useRouter();
  const { embeddedBgUser, embeddedTitleUser, embeddedMutedUser, ambientAccentColor } =
    useChatRenderTokens();
  const recording = row.recordingPreview;
  const openRecording = useCallback((): void => {
    if (!recording) return;
    router.push({
      pathname: '/recording/[recordingId]',
      params: { recordingId: recording.callId },
    });
  }, [router, recording]);

  if (!recording) return null;

  return (
    <PaintTicketCardShell
      className={cn(
        'mb-2.5 flex-row items-center gap-2.5 self-stretch rounded-lg px-2.5 py-2',
        isCurrentUser ? '' : 'bg-conversation-composer-forwarded-bg-other',
      )}
      style={isCurrentUser ? { backgroundColor: embeddedBgUser } : undefined}
      onPress={openRecording}
    >
      <View
        className='h-8 w-8 shrink-0 items-center justify-center rounded-full'
        style={{ backgroundColor: `${ambientAccentColor}26` }}
      >
        <Mic size={16} color={ambientAccentColor} strokeWidth={2.2} />
      </View>
      <View className='min-w-0 flex-1 flex-col'>
        <Text
          className={cn('text-sm font-medium', isCurrentUser ? '' : 'text-foreground')}
          style={isCurrentUser ? { color: embeddedTitleUser } : undefined}
          numberOfLines={1}
        >
          {recording.title || 'Recording shared'}
        </Text>
        <Text
          className={cn('text-xs', isCurrentUser ? '' : 'text-tertiary')}
          style={isCurrentUser ? { color: embeddedMutedUser } : undefined}
        >
          {formatAttachmentDuration(recording.durationMs / 1000)}
        </Text>
      </View>
    </PaintTicketCardShell>
  );
});

const PaintParentPreview = memo(function PaintParentPreview({
  row,
  isCurrentUser,
}: {
  row: ChatPaintRow;
  isCurrentUser: boolean;
}): ReactElement | null {
  const router = useRouter();
  const { embeddedBgUser, embeddedMutedUser, embeddedTitleUser } = useChatRenderTokens();
  const preview = row.parentPreview;
  const text = preview?.text ?? row.parentPreviewText;
  const targetMessageId = preview?.messageId;
  const emojiUris = useMtlsEmojiUris(preview?.customEmojiIds ?? []);
  const canOpenThread = !!row.channelId && !!row.parentConversationId;
  const openThread = useCallback((): void => {
    if (!row.channelId || !row.parentConversationId) return;
    router.push({
      pathname: '/chat/[channelId]/[threadId]',
      params: {
        channelId: row.channelId,
        threadId: row.parentConversationId,
        from: 'channel_thread',
        openStartedAtMs: String(Date.now()),
        ...(targetMessageId ? { messageId: targetMessageId } : {}),
      },
    });
  }, [router, row.channelId, row.parentConversationId, targetMessageId]);

  if (!text) return null;

  return (
    <Pressable
      onPress={openThread}
      disabled={!canOpenThread}
      accessibilityRole={canOpenThread ? 'button' : undefined}
      accessibilityLabel={`Replied to thread, ${text}`}
      className={cn(
        'mb-2 overflow-hidden rounded-md px-2 py-1.5 active:opacity-90',
        isCurrentUser ? '' : 'bg-conversation-composer-forwarded-bg-other',
      )}
      style={[
        { height: preview?.reservedHeightPx ?? CHAT_PAINT_PARENT_PREVIEW_HEIGHT_PX },
        isCurrentUser ? { backgroundColor: embeddedBgUser } : null,
      ]}
    >
      <View className='w-full flex-col gap-1'>
        <Text
          className={cn('font-medium text-xs', isCurrentUser ? '' : 'text-foreground')}
          style={isCurrentUser ? { color: embeddedMutedUser } : undefined}
          numberOfLines={1}
        >
          Replied to thread:{' '}
        </Text>
        {preview?.segments.some(segment => segment.kind === 'emoji') ? (
          <View
            className='flex-row flex-wrap items-center'
            style={{ height: 18, overflow: 'hidden' }}
          >
            {preview.segments.map((segment, index) =>
              segment.kind === 'emoji' ? (
                <Image
                  key={`${segment.emojiId}:${index}`}
                  source={segment.uri ?? emojiUris[segment.emojiId] ?? null}
                  style={{
                    width: COMPOSER_INLINE_EMOJI_RENDER_SIZE,
                    height: COMPOSER_INLINE_EMOJI_RENDER_SIZE,
                  }}
                  contentFit='contain'
                  recyclingKey={`${row.conversationId}:${segment.emojiId}`}
                />
              ) : (
                <Text
                  key={`${segment.kind}:${index}`}
                  className={cn('font-medium text-xs', isCurrentUser ? '' : 'text-tertiary')}
                  style={isCurrentUser ? { color: embeddedTitleUser } : undefined}
                >
                  {segment.text}
                </Text>
              ),
            )}
          </View>
        ) : (
          <Text
            className={cn('font-medium text-xs', isCurrentUser ? '' : 'text-tertiary')}
            style={isCurrentUser ? { color: embeddedTitleUser } : undefined}
            numberOfLines={2}
          >
            {text}
          </Text>
        )}
      </View>
    </Pressable>
  );
});

const PaintReactionSummary = memo(function PaintReactionSummary({
  conversationId,
  messageId,
  groups = [],
  reactions,
  fallbackCount,
}: {
  conversationId: string;
  messageId?: string | undefined;
  groups?: NonNullable<ChatPaintRow['reactionPreview']>['groups'] | undefined;
  reactions?: NonNullable<ChatPaintRow['reactionPreview']>['reactions'] | undefined;
  fallbackCount: number;
}): ReactElement | null {
  const { openReactions } = useReactionsSheet();
  const stopPress = useCallback((event: GestureResponderEvent): void => {
    event.stopPropagation();
  }, []);
  const handleOpen = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      if (!messageId) return;
      openReactions({
        conversationId,
        messageId,
        ...(reactions ? { fallbackReactions: reactions } : {}),
      });
    },
    [openReactions, conversationId, messageId, reactions],
  );
  const count = fallbackCount;
  if (count <= 0) return null;
  return (
    <View className='h-6 items-end justify-start pr-2'>
      <Pressable
        accessibilityRole='button'
        accessibilityLabel={`${count} ${count === 1 ? 'reaction' : 'reactions'}`}
        hitSlop={6}
        onPress={handleOpen}
        onPressIn={stopPress}
        className='flex-row items-center gap-1.5 rounded-full px-1.5 py-0.5 light:bg-[#fafafa] dark:bg-[#1d1f1f]'
      >
        {groups.length > 0 ? (
          groups
            .slice(0, 4)
            .map(group => (
              <ReactionEmojiDisplay key={group.emojiName} emojiName={group.emojiName} size={14} />
            ))
        ) : (
          <Smile size={12} color='#646464' />
        )}
        {count > 1 ? (
          <Text className='text-xs light:text-[#646464] dark:text-[rgba(255,255,255,0.6)]'>
            {count}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
});

const PaintReplyTray = memo(function PaintReplyTray({
  row,
}: {
  row: ChatPaintRow;
}): ReactElement | null {
  const { actionPrimaryColor, rootAccentUser } = useChatRenderTokens();
  const replyPreview = row.replyPreview;
  const count = replyPreview?.count ?? row.replyCount;
  const latestReplierIds = replyPreview?.latestReplierIds ?? row.replyPreviewUserIds ?? [];
  const isCurrentUser = row.rowKind === 'CURRENT_USER' || row.senderPaintModel.isCurrentUser;
  const accentColor = isCurrentUser ? rootAccentUser : actionPrimaryColor;

  if (count <= 0) return null;

  const visibleCount = Math.min(3, latestReplierIds.length || count);

  return (
    <View className='shrink-0 flex-row items-center gap-1.5'>
      {visibleCount > 0 ? (
        <View className='flex-row items-center'>
          {Array.from({ length: visibleCount }, (_, index) => {
            const userId = latestReplierIds[index];
            return (
              <View
                key={userId ?? `reserved-${index}`}
                style={{
                  marginLeft: index === 0 ? 0 : -4,
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                }}
              >
                {userId ? (
                  <Avatar userIds={[userId]} size={18} />
                ) : (
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 9,
                      backgroundColor: accentColor,
                      opacity: 0.45,
                    }}
                  />
                )}
              </View>
            );
          })}
        </View>
      ) : null}
      <Text
        className='shrink-0 text-sm font-medium'
        style={{ color: accentColor }}
        numberOfLines={1}
      >
        {count} {count === 1 ? 'reply' : 'replies'}
      </Text>
      <View className='shrink-0 items-center justify-center'>
        <ChevronRight size={16} color={accentColor} />
      </View>
    </View>
  );
});

export {
  PaintMediaPlaceholder,
  PaintTicketPreviewCard,
  PaintRecordingPreviewCard,
  PaintParentPreview,
  PaintReactionSummary,
  PaintReplyTray,
};
