import { createContext, memo, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { View } from 'react-native';
import { useCSSVariable, useUniwind } from 'uniwind';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { MessageAttachmentsGrid } from '@/src/components/chat/all-threads-list/message-attachments-grid';
import { RichInlineText } from '@/src/components/conversation-composer/rich-inline-text';
import {
  htmlToMD,
  normalizeActivityPreviewMarkdown,
} from '@/src/components/conversation-composer/utils/htmlToMD';
import { buildComposerMarkdownStyle } from '@/src/components/conversation-composer/utils/markdownStyle';
import { useSelf } from '@/src/hooks/useUsers';

import { ACTIVITY_BODY_LINES, ACTIVITY_PREVIEW_CACHE_SIZE } from '../constants';
import type { ActivityAttachment } from '../model/row';

type BodyEnvironment = {
  markdownStyle: MarkdownStyle;
  currentUserId: string | undefined;
};

const BodyEnvironmentContext = createContext<BodyEnvironment | null>(null);

/**
 * Resolves what every message body shares, once for the list.
 *
 * The classic card called `useCSSVariable` five times and rebuilt the markdown
 * style per row. Style and identity do not depend on the row, so they are
 * built here and read through context — a theme switch rebuilds one object,
 * not one per mounted row.
 */
export function ActivityBodyEnvironment({ children }: { children: ReactNode }): ReactElement {
  const foreground = useCSSVariable('--color-spaces-foreground') as string;
  const cardBg = useCSSVariable('--color-card') as string;
  const brand = useCSSVariable('--color-brand') as string;
  const { theme } = useUniwind();
  const currentUser = useSelf();
  const currentUserId = currentUser?.id;

  const value = useMemo<BodyEnvironment>(
    () => ({
      markdownStyle: buildComposerMarkdownStyle({
        foreground,
        foregroundMuted: foreground,
        cardBg,
        brand,
        linkColor: theme === 'light' ? '#1B8755' : '#21C063',
        variant: 'activity',
      }),
      currentUserId,
    }),
    [brand, cardBg, currentUserId, foreground, theme],
  );

  return (
    <BodyEnvironmentContext.Provider value={value}>{children}</BodyEnvironmentContext.Provider>
  );
}

export function useActivityBodyEnvironment(): BodyEnvironment {
  const value = useContext(BodyEnvironmentContext);
  if (value === null) throw new Error('Activity body used outside <ActivityBodyEnvironment>');
  return value;
}

/**
 * Message HTML to preview markdown, remembered.
 *
 * The conversion walks the whole message and a recycled row asks again every
 * time the list scrolls it back into view. Bounded, oldest out, so a long
 * session does not keep every message it has ever drawn.
 */
const previewCache = new Map<string, string>();

function toPreviewMarkdown(content: string): string {
  const hit = previewCache.get(content);
  if (hit !== undefined) return hit;

  const markdown = normalizeActivityPreviewMarkdown(htmlToMD(content));
  if (previewCache.size >= ACTIVITY_PREVIEW_CACHE_SIZE) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(content, markdown);
  return markdown;
}

type MessageBodyProps = {
  content: string;
  senderId: string;
};

/**
 * The message, as the same inline rich text the classic compact preview uses —
 * mentions, links and emoji — clamped to two lines. Always the compact path:
 * the full composer tree the classic card falls back to is far heavier than a
 * list row should carry.
 *
 * Draws nothing for a message that is only attachments, rather than an empty
 * text view with a line's height.
 */
export const ActivityMessageBody = memo(function ActivityMessageBody({
  content,
  senderId,
}: MessageBodyProps): ReactElement | null {
  const { markdownStyle, currentUserId } = useActivityBodyEnvironment();
  const markdown = useMemo(() => toPreviewMarkdown(content), [content]);
  if (markdown.trim() === '') return null;

  return (
    <View pointerEvents='none'>
      <RichInlineText
        markdown={markdown}
        markdownStyle={markdownStyle}
        numberOfLines={ACTIVITY_BODY_LINES}
        selectable={false}
        {...(currentUserId ? { currentUserId } : {})}
        isOwnMessage={currentUserId !== undefined && currentUserId === senderId}
      />
    </View>
  );
});

type ActivityAttachmentsProps = {
  attachments: readonly ActivityAttachment[];
  conversationId: string;
};

/**
 * A message's attachments, in the grid the Threads screen uses: up to four
 * media tiles with an overflow count, files as cards beneath. Tapping one
 * opens the attachments viewer; tapping anywhere else still opens the activity.
 */
export const ActivityAttachments = memo(function ActivityAttachments({
  attachments,
  conversationId,
}: ActivityAttachmentsProps): ReactElement | null {
  if (attachments.length === 0) return null;
  return <MessageAttachmentsGrid attachments={attachments} conversationId={conversationId} />;
});
