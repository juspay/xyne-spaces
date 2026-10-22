import { useValue } from '@legendapp/state/react';
import { memo, useMemo, type ReactElement } from 'react';
import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useCSSVariable, useUniwind } from 'uniwind';
import { User } from '@xyne/shared';
import { MessageComposer, type MessageItem } from '@/src/components/message-composer';
import {
  ConversationComposer,
  type ConversationItem,
} from '@/src/components/conversation-composer';
import {
  htmlToMD,
  normalizeActivityPreviewMarkdown,
} from '@/src/components/conversation-composer/utils/htmlToMD';
import { buildComposerMarkdownStyle } from '@/src/components/conversation-composer/utils/markdownStyle';
import { RichInlineText } from '@/src/components/conversation-composer/rich-inline-text';
import { MessageAttachmentsGrid } from '@/src/components/chat/all-threads-list/message-attachments-grid';
import { appliedActivityPreferences$ } from '@/src/features/activity/state/preferences-store';
import type { MessageAttachment } from '@/src/hooks/useThreadConversationPreview';
import type { ActivityWithRelated } from '@/src/types/activity';
import { useActivityRenderContext } from './activity-v2/activity-render-context';

type Props = {
  message: NonNullable<ActivityWithRelated['message']>;
  currentUser: User | undefined;
  maxLines?: number;
  isUnread?: boolean;
};

const CONTENT_HEIGHT_BUFFER = 8;
const LINE_HEIGHT = 20;
const FADE_HEIGHT = 10;

const CompactPreviewSkeleton = (): ReactElement => (
  <View className='gap-1.5 pt-0.5' pointerEvents='none'>
    <View className='h-3.5 rounded-md bg-foreground/8' />
    <View className='h-3.5 w-2/3 rounded-md bg-foreground/8' />
  </View>
);

const MessagePreview = ({
  message,
  currentUser,
  maxLines = 2,
  isUnread = false,
}: Props): ReactElement => {
  const activityCardBg = useCSSVariable('--color-activity-v2-card-bg') as string;
  const activityCardUnreadBg = useCSSVariable('--color-activity-v2-card-unread-bg') as string;
  const foreground = useCSSVariable('--color-activity-description') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const { theme } = useUniwind();
  const { compactPreviews: compactPreview } = useActivityRenderContext();
  const conversation = message.conversation;
  const isChannelRoot =
    conversation !== undefined && message.messageId === conversation.initialMessageId;
  const maxContentHeight = LINE_HEIGHT * maxLines + CONTENT_HEIGHT_BUFFER;
  const fadeColor = isUnread ? activityCardUnreadBg : activityCardBg;
  const previewMarkdown = useMemo(
    () => normalizeActivityPreviewMarkdown(htmlToMD(message.content ?? '')),
    [message.content],
  );
  const markdownStyle = useMemo(
    () =>
      buildComposerMarkdownStyle({
        foreground,
        foregroundMuted: foreground,
        cardBg,
        brand,
        linkColor: theme === 'light' ? '#1B8755' : '#21C063',
        variant: 'activity',
      }),
    [brand, cardBg, foreground, theme],
  );

  if (compactPreview) {
    if (!previewMarkdown) {
      return (
        <View style={{ maxHeight: maxContentHeight, overflow: 'hidden' }}>
          <CompactPreviewSkeleton />
        </View>
      );
    }

    return (
      <View style={{ maxHeight: maxContentHeight, overflow: 'hidden' }} pointerEvents='none'>
        <RichInlineText
          markdown={previewMarkdown}
          markdownStyle={markdownStyle}
          numberOfLines={maxLines}
          selectable={false}
          {...(currentUser?.id ? { currentUserId: currentUser.id } : {})}
          isOwnMessage={Boolean(currentUser?.id) && currentUser?.id === message.senderId}
        />
      </View>
    );
  }

  return (
    <View
      style={{ maxHeight: maxContentHeight, overflow: 'hidden', position: 'relative' }}
      pointerEvents='none'
    >
      <View>
        {isChannelRoot && conversation ? (
          <ConversationComposer.Root
            item={conversation as unknown as ConversationItem}
            currentUser={currentUser}
            contentVariant='activity'
          >
            <ConversationComposer.Content />
          </ConversationComposer.Root>
        ) : (
          <MessageComposer.Root
            item={message as unknown as MessageItem}
            currentUser={currentUser}
            contentVariant='activity'
          >
            <MessageComposer.Content />
          </MessageComposer.Root>
        )}
      </View>
      <LinearGradient
        colors={[`${fadeColor}00`, `${fadeColor}70`, fadeColor]}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: FADE_HEIGHT,
        }}
        pointerEvents='none'
      />
    </View>
  );
};

const NO_ATTACHMENTS: readonly MessageAttachment[] = [];

/**
 * The message's attachments, in the grid the Threads screen and the Spaces
 * Activity screen use — drawn only in the Detailed view.
 */
const MessageAttachments = ({
  message,
}: {
  message: NonNullable<ActivityWithRelated['message']>;
}): ReactElement | null => {
  const raw = message.attachments;
  const attachments = useMemo<readonly MessageAttachment[]>(
    () =>
      raw && raw.length > 0
        ? raw.map(a => ({
            id: a.id,
            mimetype: a.mimetype ?? 'application/octet-stream',
            ...(a.originalFilename ? { originalFilename: a.originalFilename } : {}),
            ...(a.size !== null && a.size !== undefined ? { size: a.size } : {}),
            ...(a.metadata ? { metadata: a.metadata as { duration?: number } } : {}),
          }))
        : NO_ATTACHMENTS,
    [raw],
  );

  const conversationId = message.conversation?.conversationId;
  if (attachments.length === 0 || conversationId === undefined) return null;
  return <MessageAttachmentsGrid attachments={attachments} conversationId={conversationId} />;
};

const ActivityV2MessageContentInner = (props: Props): ReactElement => {
  // Condensed leaves attachments out, as on the Spaces Activity screen.
  const showsAttachments = useValue(appliedActivityPreferences$.viewMode) === 'detailed';

  return (
    <>
      <MessagePreview {...props} />
      {/* Outside the preview, which takes no touches, so a tap opens the viewer. */}
      {showsAttachments ? <MessageAttachments message={props.message} /> : null}
    </>
  );
};

export const ActivityV2MessageContent = memo(ActivityV2MessageContentInner, (prev, next) => {
  return (
    prev.message.messageId === next.message.messageId &&
    prev.currentUser?.id === next.currentUser?.id &&
    prev.maxLines === next.maxLines &&
    prev.isUnread === next.isUnread
  );
});
