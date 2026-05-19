import { ReactElement, memo, MouseEvent, KeyboardEvent, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import { useChannel } from '../../../hooks/useChannels';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { SearchResultsContext } from './SearchResultsContext';

interface SearchResultMessageCardProps {
  channelId: string;
  conversationId: string;
  matchedMessageId: string | null;
}

export const SearchResultMessageCard = memo(function SearchResultMessageCard({
  channelId,
  conversationId,
  matchedMessageId,
}: SearchResultMessageCardProps): ReactElement | null {
  const { onSelectThread, onSelectUser } = useContext(SearchResultsContext);
  const channel = useChannel(channelId);
  const navigate = useNavigate();

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

  if (!channelId || !conversationId) return null;

  const isMessagesLoaded = messagesDetails.type === 'complete' || messagesDetails.type === 'error';
  const initialMessageId = conversation?.initialMessageId;
  const targetMessage = messages?.find(m => m.messageId === (matchedMessageId ?? initialMessageId));
  const isMatchRoot = !!initialMessageId && targetMessage?.messageId === initialMessageId;
  const replyCount = conversation?.replyCount ?? 0;
  const showReplies = isMatchRoot && replyCount > 0;

  const navigateToMessage = (): void => {
    if (!targetMessage) return;
    void navigate(
      isMatchRoot
        ? `/chat/dir/${channelId}#origin=${conversationId}`
        : `/chat/dir/${channelId}/${conversationId}#origin=${conversationId}&messageId=${targetMessage.messageId}`,
    );
  };

  const handleCardClick = (e: MouseEvent<HTMLDivElement>): void => {
    const interactive =
      e.target instanceof HTMLElement
        ? e.target.closest('a, button, input, textarea, [role="button"], [data-prevent-thread]')
        : null;
    if (interactive && interactive !== e.currentTarget) return;
    navigateToMessage();
  };

  const handleCardKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    navigateToMessage();
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
      className='group border border-border rounded-xl overflow-hidden bg-card shadow-sm hover:bg-accent/50 transition-colors cursor-pointer'
      data-track-category='SEARCH_RESULTS'
      data-track-name='OPEN_SEARCH_MESSAGE'
    >
      <div className='py-2'>
        {!isMessagesLoaded ? (
          <div className='flex justify-center py-6'>
            <Loader2 className='animate-spin text-muted-foreground' size={20} />
          </div>
        ) : !targetMessage ? (
          <div className='px-4 py-3 text-sm text-muted-foreground'>Message no longer available</div>
        ) : (
          <ChatBubble
            message={targetMessage}
            channelId={channelId}
            showAvatar
            context='channel'
            channelScopeType={channel?.scopeType}
            searchItemView
            {...(onSelectUser && { onUserClick: onSelectUser })}
            {...(conversation && { conversation })}
            {...(showReplies && {
              replies: {
                replyCount,
                ...(conversation?.lastActivityAt !== undefined && {
                  lastActivityAt: conversation.lastActivityAt,
                }),
                onOpenThread: handleOpenThread,
                ...(conversation && { conversation }),
              },
            })}
          />
        )}
      </div>
    </div>
  );
});
