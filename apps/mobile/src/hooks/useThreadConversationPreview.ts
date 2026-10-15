import { useMemo } from 'react';
import { queries } from '@xyne/shared/zero/queries';
import { useChannel, useChannelDisplayName } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import {
  htmlToMD,
  normalizeActivityPreviewMarkdown,
} from '@/src/components/conversation-composer/utils/htmlToMD';
import { useCachedQuery } from './useCachedQuery';

type UserLike = { id: string; name: string; displayName?: string | null };

export type MessageAttachment = {
  id: string;
  mimetype: string;
  originalFilename?: string;
  size?: number;
  metadata?: { duration?: number } | null;
  /** Optional already-available preview used before the authenticated fetch settles. */
  previewUri?: string | null;
};

export type MessagePreview = {
  messageId: string;
  senderId: string;
  senderName: string;
  text: string;
  formattedTime: string;
  attachments: MessageAttachment[];
};

export type ThreadConversationPreview = {
  headerTitle: string;
  scopeType: string;
  initialMessage: MessagePreview | null;
  lastReplies: MessagePreview[];
  moreRepliesCount: number;
  channelId: string;
  conversationId: string;
  isLoading: boolean;
};

const MAX_SHOWN_REPLIES = 3;
const TAIL_REPLIES_TO_SHOW = 2;

function ordinal(n: number): string {
  const v = n % 100;
  const suffix = ['th', 'st', 'nd', 'rd'];
  return n + (suffix[(v - 20) % 10] ?? suffix[v] ?? suffix[0]!);
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const day = date.getDate();
  const time = date
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, '');
  return `${month} ${ordinal(day)} at ${time}`;
}

function resolveUserName(userId: string, usersById: Map<string, UserLike>): string {
  const u = usersById.get(userId);
  return u?.displayName ?? u?.name ?? 'Unknown';
}

function buildMessagePreview(
  msg:
    | {
        messageId: string;
        senderId: string;
        content: string;
        createdAt: number;
        attachments?: ReadonlyArray<{
          readonly id: string;
          readonly mimetype?: string | null;
          readonly originalFilename?: string | null;
          readonly size?: number | null;
          readonly metadata?: unknown;
        }> | null;
      }
    | null
    | undefined,
  usersById: Map<string, UserLike>,
): MessagePreview | null {
  if (!msg) return null;
  const text = normalizeActivityPreviewMarkdown(htmlToMD(msg.content ?? ''));
  const attachments: MessageAttachment[] = (msg.attachments ?? []).map(a => ({
    id: a.id,
    mimetype: a.mimetype ?? 'application/octet-stream',
    ...(a.originalFilename ? { originalFilename: a.originalFilename } : {}),
    ...(a.size !== null && a.size !== undefined ? { size: a.size } : {}),
    ...(a.metadata ? { metadata: a.metadata as { duration?: number } } : {}),
  }));

  return {
    messageId: msg.messageId,
    senderId: msg.senderId,
    senderName: resolveUserName(msg.senderId, usersById),
    text,
    formattedTime: formatTime(msg.createdAt),
    attachments,
  };
}

export function useThreadConversationPreview(
  conversationId: string,
  channelId: string | undefined,
  currentUserId: string,
): ThreadConversationPreview {
  // Channel comes from the state machine — no extra query needed
  const channel = useChannel(channelId ?? '');
  // useChannelDisplayName handles DEFAULT (#name), DM (other user's name), GROUP_DM (comma list)
  const headerTitle = useChannelDisplayName(channel, currentUserId);

  const users = useUsers();
  const usersById = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  const [conversation] = useCachedQuery(
    queries.threadConversationV2({
      conversationId,
      channelId,
      isMember: true,
    }),
    { enabled: !!conversationId },
  );

  return useMemo(() => {
    const empty: ThreadConversationPreview = {
      headerTitle,
      scopeType: channel?.scopeType ?? 'DEFAULT',
      initialMessage: null,
      lastReplies: [],
      moreRepliesCount: 0,
      channelId: channelId ?? '',
      conversationId,
      isLoading: !conversation,
    };

    if (!conversation) return empty;

    const allMessages = conversation.messages ?? [];
    const replyCount = conversation.replyCount ?? 0;

    const rootMsg = allMessages[0];
    const replies = allMessages.slice(1);

    const showAll = replyCount <= MAX_SHOWN_REPLIES;
    const shownReplies = showAll ? replies : replies.slice(-TAIL_REPLIES_TO_SHOW);
    const moreRepliesCount = showAll ? 0 : Math.max(0, replyCount - TAIL_REPLIES_TO_SHOW);

    return {
      headerTitle,
      scopeType: channel?.scopeType ?? 'DEFAULT',
      initialMessage: buildMessagePreview(rootMsg, usersById),
      lastReplies: shownReplies
        .map(m => buildMessagePreview(m, usersById))
        .filter((m): m is MessagePreview => m !== null),
      moreRepliesCount,
      channelId: channelId ?? '',
      conversationId,
      isLoading: false,
    };
  }, [conversation, headerTitle, channel, usersById, channelId, conversationId]);
}
