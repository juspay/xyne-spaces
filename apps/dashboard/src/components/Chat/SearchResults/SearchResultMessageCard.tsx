import {
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  memo,
  useContext,
  useMemo,
  useState,
} from 'react';
import { getSmartSnippet } from '../RenderMessageWithHTML/searchSnippetRender';
import { useNavigate } from 'react-router-dom';
import { Home } from 'lucide-react';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import { useChannel } from '../../../hooks/useChannels';
import { SearchResultsContext } from './SearchResultsContext';
import { cn } from '../../../utils/classNames';
import { AttachmentEntityType, MessageType, type MessageAttachment } from '@xyne/shared';
import { useQuery } from '@tanstack/react-query';
import { searchService } from '../../../services/searchService';
import type {
  ConversationWithTicket,
  MessageWithOptionalNudgeCounts,
} from '../../ui/MessageBubble/MessageBubble.types';

const WORD_LIMIT = 30;

interface SearchResultMessageCardProps {
  channelId: string;
  conversationId: string;
  matchedMessageId: string | null;
  displayMessageId?: string;
  isSelected?: boolean;
  searchSnippet?: string;
  onCardClick?: () => void;
  // Message + thread fields from the Vespa search payload. The card builds the
  // message object from these — no Zero message/conversation queries. For ticket
  // results, `ticketMd` carries the serialized ticket card so a conversation is
  // fabricated too, letting ChatBubble render the embedded ticket widget.
  searchThread: {
    isRootMessage: boolean;
    replyCount: number;
    senderId: string;
    msgType: MessageType;
    createdAt: number;
    ticketMd?: string;
    threadSenders?: string[];
    attachmentIds?: string[];
  };
}

export const SearchResultMessageCard = memo(function SearchResultMessageCard({
  channelId,
  conversationId,
  matchedMessageId,
  displayMessageId,
  isSelected = false,
  searchSnippet,
  onCardClick,
  searchThread,
}: SearchResultMessageCardProps): ReactElement | null {
  const { onSelectThread, onSelectUser, onSelectChannelContext } = useContext(SearchResultsContext);
  const channel = useChannel(channelId);
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);
  const renderedMessageId = displayMessageId ?? matchedMessageId;

  const attachmentIds = useMemo(
    () => [...new Set(searchThread.attachmentIds ?? [])].sort(),
    [searchThread.attachmentIds],
  );
  const attachmentIdsKey = attachmentIds.join(',');
  const { data: attachmentResults } = useQuery({
    queryKey: ['search-result-attachments', attachmentIdsKey],
    enabled: attachmentIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: () =>
      searchService.vespaSearch({
        query: '',
        apps: 'file',
        fileId: attachmentIdsKey,
        filterOnly: true,
        groupBy: '',
        limit: attachmentIds.length,
      }),
  });

  const attachments = useMemo((): MessageAttachment[] => {
    const resultsById = new Map(
      (attachmentResults?.results ?? []).map(result => [
        result.searchContext?.attachmentId,
        result,
      ]),
    );

    return attachmentIds.flatMap(attachmentId => {
      const result = resultsById.get(attachmentId);
      const context = result?.searchContext;
      if (!result || !context?.fileName || !context.mimeType) return [];

      const uploadedByUserId = result.avatar || searchThread.senderId;
      return [
        {
          id: attachmentId,
          entityType: searchThread.ticketMd
            ? AttachmentEntityType.TICKET
            : AttachmentEntityType.CHAT,
          entityId: renderedMessageId ?? conversationId,
          workspaceId: '',
          storageProvider: '',
          originalFilename: context.fileName,
          mimetype: context.mimeType,
          size: context.fileSize ?? 0,
          width: null,
          height: null,
          uploadedByUserId,
          createdAt: searchThread.createdAt,
          url: context.originalUrl || context.internalUrl || '',
          createdBy: uploadedByUserId,
          metadata: null,
          conversationId,
          thumbnailUrl: null,
          isDeleted: false,
          uploadStatus: null,
        },
      ];
    });
  }, [
    attachmentIds,
    attachmentResults?.results,
    conversationId,
    renderedMessageId,
    searchThread.createdAt,
    searchThread.senderId,
    searchThread.ticketMd,
  ]);

  // The message is built entirely from the search payload — no Zero fetch.
  // Optional Message fields not in search are left at safe defaults.
  const targetMessage: MessageWithOptionalNudgeCounts | null = renderedMessageId
    ? {
        messageId: renderedMessageId,
        conversationId,
        // Search results carry no classification; chips don't render on this card.
        messageActs: null,
        senderId: searchThread.senderId,
        content: searchSnippet ?? '',
        msgType: searchThread.msgType,
        createdAt: searchThread.createdAt,
        hasAttachment: attachments.length > 0,
        attachments,
        edited: false,
        isDeleted: false,
        showInChannel: true,
        isSent: true,
        childConversationId: null,
        workspaceId: channel?.workspaceId ?? '',
        visibleTo: null,
        metadata: null,
        nudgeCount: null,
        reactions_md: null,
        link_preview_md: null,
      }
    : null;

  // Ticket results fabricate a conversation carrying the ticket_md so ChatBubble's
  // embedded ticket widget renders (it needs ticket_md + initialMessageId ===
  // messageId). Conversation results pass no conversation.
  const fabricatedConversation: ConversationWithTicket | undefined =
    searchThread.ticketMd && renderedMessageId
      ? {
          conversationId,
          channelId,
          createdBy: searchThread.senderId,
          initialMessageId: renderedMessageId,
          lastActivityAt: searchThread.createdAt,
          replyCount: searchThread.replyCount,
          pinned: false,
          createdAt: searchThread.createdAt,
          threadType: null,
          ticket_md: searchThread.ticketMd,
          workspaceId: channel?.workspaceId ?? '',
          parentMessageId: null,
          ticketId: null,
          metadata: null,
          callId: null,
          replies_md: null,
          initial_message_md: null,
          parent_message_md: null,
          sub_tickets_md: null,
          doNotPostToChannel: null,
        }
      : undefined;

  const processedSnippet = useMemo(
    () => (searchSnippet ? getSmartSnippet(searchSnippet, 40) : null),
    [searchSnippet],
  );

  const isMatchRoot = searchThread.isRootMessage;
  const replyCount = searchThread.replyCount;
  const showReplies = isMatchRoot && replyCount > 0;

  // Determine if text content needs truncation
  const fullWordCount = targetMessage
    ? (targetMessage.content ?? '')
        .replace(/<[^>]*>/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
    : 0;
  const isLongContent = !processedSnippet && fullWordCount > WORD_LIMIT;
  const canExpand = processedSnippet ? fullWordCount > 40 : isLongContent;

  // Content to show: search snippet (already truncated) OR a word-limited preview OR full content
  const previewContent = useMemo(() => {
    if (processedSnippet) return processedSnippet;
    if (!targetMessage || !isLongContent) return null;
    return getSmartSnippet(targetMessage.content, WORD_LIMIT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processedSnippet, targetMessage?.content, isLongContent]);

  if (!channelId || !conversationId) return null;

  // Inject "... Show more" inline into the HTML so it appears on the same line as the last word.
  const contentWithShowMore =
    canExpand && !isExpanded && previewContent
      ? `${previewContent}<span data-search-show-more="true" style="cursor:pointer;font-size:0.75rem;margin-left:2px;" class="text-muted-foreground hover:underline"> Show more</span>`
      : previewContent;

  const displayMessage =
    previewContent && targetMessage && !isExpanded
      ? { ...targetMessage, content: contentWithShowMore ?? previewContent }
      : targetMessage;

  const navigateToMessage = (): void => {
    if (!targetMessage) return;
    void navigate(
      isMatchRoot
        ? `/chat/dir/${channelId}#origin=${conversationId}`
        : `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${targetMessage.messageId}`,
    );
  };

  const openPanel = (): void => {
    if (replyCount > 0) {
      onSelectThread?.({ channelId, conversationId, matchedMessageId });
    } else {
      onSelectChannelContext?.(channelId, conversationId, undefined, matchedMessageId);
    }
  };

  const handleCardClick = (e: MouseEvent<HTMLDivElement>): void => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('[data-search-show-more]')) {
      setIsExpanded(true);
      return;
    }
    const blocked =
      e.target instanceof HTMLElement ? e.target.closest('a, [data-prevent-thread]') : null;
    if (blocked && blocked !== e.currentTarget) return;
    if (onCardClick) {
      onCardClick();
      return;
    }
    openPanel();
  };

  const handleCardKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    if (onCardClick) {
      onCardClick();
      return;
    }
    openPanel();
  };

  const handleOpenThread = (): void => {
    onSelectThread?.({ channelId, conversationId });
  };

  return (
    <div
      role='button'
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      className={cn(
        'group border border-border/60 rounded-xl overflow-hidden bg-card hover:bg-accent/40 transition-colors cursor-pointer',
        isSelected ? 'bg-accent/40' : '',
      )}
      data-track-category='SEARCH_RESULTS'
      data-track-name='OPEN_SEARCH_MESSAGE'
    >
      <div className='relative py-1'>
        <button
          data-prevent-thread
          onClick={e => {
            e.stopPropagation();
            navigateToMessage();
          }}
          className='absolute top-1 right-2 z-20 opacity-0 group-hover:opacity-100 p-1.5 rounded-md bg-card border border-border shadow-sm text-muted-foreground hover:bg-muted transition-opacity'
          title='Open in home'
          aria-label='Open in home'
          data-track-category='SEARCH_RESULTS'
          data-track-name='JUMP_TO_MESSAGE'
        >
          <Home size={14} />
        </button>
        {!targetMessage ? (
          <div className='px-4 py-3 text-sm text-muted-foreground'>Message no longer available</div>
        ) : (
          <>
            <ChatBubble
              message={displayMessage ?? targetMessage}
              channelId={channelId}
              showAvatar
              context='channel'
              channelScopeType={channel?.scopeType}
              searchItemView
              {...(onSelectUser && { onUserClick: onSelectUser })}
              {...(fabricatedConversation && { conversation: fabricatedConversation })}
              {...(canExpand &&
                isExpanded && {
                  afterTextContent: (
                    <button
                      data-prevent-thread
                      onClick={e => {
                        e.stopPropagation();
                        setIsExpanded(false);
                      }}
                      className='block text-muted-foreground hover:underline mt-1'
                      style={{ fontSize: '0.75rem' }}
                      data-track-category='SEARCH_RESULTS'
                      data-track-name='COLLAPSE_MESSAGE'
                    >
                      Show less
                    </button>
                  ),
                })}
            />
            {/* Reply preview: repliers' avatars (from Vespa threadSenders) + count.
                The conversation isn't fetched, so avatars come from the surfaced
                participant ids. */}
            {showReplies &&
              (() => {
                const repliers = searchThread.threadSenders ?? [];
                return (
                  <button
                    data-prevent-thread
                    onClick={e => {
                      e.stopPropagation();
                      handleOpenThread();
                    }}
                    className='mt-1 ml-14 flex items-center gap-1.5 group/replies'
                    data-track-category='SEARCH_RESULTS'
                    data-track-name='OPEN_THREAD_FROM_COUNT'
                  >
                    {repliers.length > 0 && <AvatarGroup userIds={repliers} size='sm' count={3} />}
                    <span className='text-xs font-medium text-muted-foreground group-hover/replies:text-foreground group-hover/replies:underline'>
                      {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                    </span>
                  </button>
                );
              })()}
          </>
        )}
      </div>
    </div>
  );
});
