import {
  ReactElement,
  memo,
  MouseEvent,
  KeyboardEvent,
  useContext,
  useMemo,
  useState,
} from 'react';
import { getSmartSnippet } from '../RenderMessageWithHTML/searchSnippetRender';
import { useNavigate } from 'react-router-dom';
import { Home, Loader2 } from 'lucide-react';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import ReplyLayoutV2 from '../ReplyLayout/ReplyLayoutV2';
import { useChannel } from '../../../hooks/useChannels';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { SearchResultsContext } from './SearchResultsContext';
import { cn } from '../../../utils/classNames';

const WORD_LIMIT = 30;

interface SearchResultMessageCardProps {
  channelId: string;
  conversationId: string;
  matchedMessageId: string | null;
  isSelected?: boolean;
  searchSnippet?: string;
}

export const SearchResultMessageCard = memo(function SearchResultMessageCard({
  channelId,
  conversationId,
  matchedMessageId,
  isSelected = false,
  searchSnippet,
}: SearchResultMessageCardProps): ReactElement | null {
  const { onSelectThread, onSelectUser, onSelectChannelContext } = useContext(SearchResultsContext);
  const channel = useChannel(channelId);
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(false);

  const [messages, messagesDetails] = useCachedQuery(
    queries.conversationMessagesV2({ conversationId: conversationId || ' ' }),
    { enabled: !!conversationId },
  );
  const [conversation] = useCachedQuery(
    queries.getConversationByIdWithChannel({
      conversationId: conversationId || ' ',
      channelId: channelId || ' ',
      isMember: true,
    }),
    { enabled: !!conversationId && !!channelId },
  );

  const processedSnippet = useMemo(
    () => (searchSnippet ? getSmartSnippet(searchSnippet, 40) : null),
    [searchSnippet],
  );

  const isMessagesLoaded = messagesDetails.type === 'complete' || messagesDetails.type === 'error';
  const initialMessageId = conversation?.initialMessageId;
  const targetMessage = messages?.find(m => m.messageId === (matchedMessageId ?? initialMessageId));
  const isMatchRoot = !!initialMessageId && targetMessage?.messageId === initialMessageId;
  const replyCount = conversation?.replyCount ?? 0;
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
  // The span survives sanitization because 'span' + 'data-*' are in the allowlist.
  const contentWithShowMore =
    canExpand && !isExpanded && previewContent
      ? `${previewContent}<span data-search-show-more="true" style="cursor:pointer;font-size:0.75rem;margin-left:2px;" class="text-muted-foreground hover:underline"> Show more</span>`
      : previewContent;

  // Always use the snippet/preview when available (preserves search highlights),
  // expanding only swaps back to the full raw content.
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

  const handleCardClick = (e: MouseEvent<HTMLDivElement>): void => {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.closest('[data-search-show-more]')) {
      setIsExpanded(true);
      return;
    }
    const blocked =
      e.target instanceof HTMLElement ? e.target.closest('a, [data-prevent-thread]') : null;
    if (blocked && blocked !== e.currentTarget) return;
    if (replyCount > 0) {
      onSelectThread?.({ channelId, conversationId, matchedMessageId });
    } else {
      onSelectChannelContext?.(
        channelId,
        conversationId,
        conversation?.createdAt,
        matchedMessageId,
      );
    }
  };

  const handleCardKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    if (replyCount > 0) {
      onSelectThread?.({ channelId, conversationId, matchedMessageId });
    } else {
      onSelectChannelContext?.(
        channelId,
        conversationId,
        conversation?.createdAt,
        matchedMessageId,
      );
    }
  };

  const handleOpenThread = (e?: MouseEvent): void => {
    e?.stopPropagation();
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
        {!isMessagesLoaded ? (
          <div className='flex justify-center py-6'>
            <Loader2 className='animate-spin text-muted-foreground' size={20} />
          </div>
        ) : !targetMessage ? (
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
              {...(conversation && { conversation })}
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
            {/* Replies rendered after Show more, with original ReplyLayoutV2 UI */}
            {showReplies && (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, local-rules/require-tracking-on-click
              <div data-prevent-thread onClick={e => e.stopPropagation()}>
                <ReplyLayoutV2
                  replies={{
                    replyCount,
                    ...(conversation?.lastActivityAt !== undefined && {
                      lastActivityAt: conversation.lastActivityAt,
                    }),
                    onOpenThread: handleOpenThread,
                    ...(conversation && { conversation }),
                  }}
                  isThreadOpen={false}
                  showViewNewerReplies={false}
                  messageId={targetMessage.messageId}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
