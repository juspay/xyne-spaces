import { useEffect, useMemo, useRef, type ComponentProps, type ReactElement } from 'react';
import { AlertCircle, ChevronRight, MessageCircle, WifiOff, X } from 'lucide-react';
import { MessageType, parseRepliesMd, type SdlcDiscussion } from '@xyne/shared';
import type { Conversation } from '../../machines/stateMachine';
import type { ThreadInfo } from '../../machines/xyneAIMachine';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuth } from '../../hooks/useAuth';
import { queries } from '../../zero/queries';
import { Button } from '../../components/ui/Button';
import AvatarGroup from '../../components/ui/Avatar/AvatarGroup';
import { cn } from '../../utils/classNames';
import { formatTimeAmPm } from '../../utils/dateUtils';
import { ChatBubble } from '../../components/Chat/ChatBubble/ChatBubble';
import { ChatInput } from '../../components/Chat/ChatInput/ChatInput';
import { ThreadMessages } from '../../components/Chat/ThreadPannel';
import { getInitialMessageFromConversation } from '../../utils/conversationMessageHelpers';
import { useZeroOfflineState } from '@xyne/shared/hooks';

/**
 * One chat panel for every SDLC surface. Tracks and artifact canvases both
 * chat through DISCUSSION rows in sdlc_entity_links (owner -> CONVERSATION);
 * only the owner in the discussion binding differs.
 */
interface SdlcChatPanelProps {
  channelId: string;
  title: string;
  discussion: Omit<SdlcDiscussion, 'linkId'>;
  conversationIds: string[];
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string | null) => void;
  onClose: () => void;
  /** Thread header's Ask AI. Raised so the host can route it past the frame. */
  onAskAI?: (threadInfo?: ThreadInfo) => void;
}

const NO_CONVERSATIONS: Conversation[] = [];

const noopUserClick = (): void => {};

export function SdlcChatPanel({
  channelId,
  title,
  discussion,
  conversationIds,
  selectedConversationId,
  onSelectConversation,
  onClose,
  onAskAI,
}: SdlcChatPanelProps): ReactElement {
  const { user } = useAuth();
  const { showOfflineBanner, isReconnecting, refreshConnection } = useZeroOfflineState();
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  const [rows, queryDetails] = useCachedQuery(
    queries.sdlcDiscussionConversations({
      channelId,
      conversationIds,
      limit: 200,
    }),
  );

  const conversations = useMemo(
    () =>
      Array.isArray(rows)
        ? [...(rows as unknown as Conversation[])].sort(
            (left, right) => left.createdAt - right.createdAt,
          )
        : NO_CONVERSATIONS,
    [rows],
  );
  const selectedConversation = selectedConversationId
    ? conversations.find(item => item.conversationId === selectedConversationId)
    : undefined;

  useEffect(() => {
    if (selectedConversationId && queryDetails.type === 'complete' && !selectedConversation) {
      onSelectConversation(null);
    }
  }, [onSelectConversation, queryDetails.type, selectedConversation, selectedConversationId]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: 'end' });
  }, [conversations.length]);

  const panelHeader = (
    <div className='flex h-11 shrink-0 items-center justify-between border-b border-border/50 px-3'>
      <span className='truncate text-sm font-semibold'>{title}</span>
      <Button variant='ghost' size='iconSm' onClick={onClose} aria-label='Close'>
        <X className='size-4' />
      </Button>
    </div>
  );

  if (selectedConversationId && selectedConversation) {
    return (
      <aside
        className='flex h-full min-w-0 flex-col bg-background'
        aria-label='SDLC conversation'
        data-track-category='SdlcHub'
        data-track-name='SdlcChatThreadViewed'
        data-track-metadata={JSON.stringify({
          ownerType: discussion.ownerType,
          conversationId: selectedConversationId,
        })}
      >
        <div className='flex min-h-0 flex-1 flex-col [&_.relative.min-h-0.max-h-full]:flex-1'>
          <ThreadMessages
            channelId={channelId}
            conversationId={selectedConversationId}
            onClose={() => onSelectConversation(null)}
            onUserClick={noopUserClick}
            {...(onAskAI && { onAskAI })}
            simpleView
            disableAskAI
          />
        </div>
      </aside>
    );
  }

  const isLoading = queryDetails.type !== 'complete' && conversations.length === 0;

  return (
    <aside
      className='flex h-full min-w-0 flex-col bg-background'
      aria-label='SDLC conversations'
      data-track-category='SdlcHub'
      data-track-name='SdlcChatListViewed'
      data-track-metadata={JSON.stringify({ ownerType: discussion.ownerType })}
    >
      {panelHeader}
      {showOfflineBanner ? (
        <div className='mx-3 mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200'>
          <WifiOff className='size-3.5 shrink-0' />
          <span className='min-w-0 flex-1'>
            {isReconnecting ? 'Reconnecting…' : 'Offline. Existing messages remain available.'}
          </span>
          <Button variant='ghost' size='sm' onClick={refreshConnection} disabled={isReconnecting}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className='min-h-0 flex-1 overflow-y-auto pt-2'>
        {queryDetails.type === 'error' ? (
          <div className='grid h-full place-items-center px-6 text-center'>
            <div>
              <AlertCircle className='mx-auto size-8 text-destructive/70' />
              <p className='mt-3 text-sm font-medium'>Could not load messages</p>
              <p className='mt-1 text-xs text-muted-foreground'>Check the connection and retry.</p>
              <Button className='mt-4' size='sm' variant='outline' onClick={refreshConnection}>
                Retry
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <div className='grid h-full place-items-center text-sm text-muted-foreground'>
            Loading messages…
          </div>
        ) : conversations.length === 0 ? (
          <div className='grid h-full place-items-center px-6 text-center'>
            <div>
              <MessageCircle className='mx-auto size-8 text-muted-foreground/50' />
              <p className='mt-3 text-sm font-medium'>No messages yet</p>
              <p className='mt-1 text-xs text-muted-foreground'>Start the conversation below.</p>
            </div>
          </div>
        ) : (
          <>
            {conversations.map(conversation => {
              const initialMessage = getInitialMessageFromConversation(conversation, user?.id);
              if (!initialMessage) return null;
              const replyCount = conversation.replyCount ?? 0;
              const hasReplies = replyCount > 0;
              const isSystemMessage = initialMessage.msgType === MessageType.SYSTEM;
              const repliers = parseRepliesMd(conversation.replies_md).repliers;
              const bubble = (
                <ChatBubble
                  message={initialMessage}
                  channelId={channelId}
                  context='channel'
                  onUserClick={noopUserClick}
                  showAvatar
                  conversation={
                    conversation as unknown as NonNullable<
                      ComponentProps<typeof ChatBubble>['conversation']
                    >
                  }
                />
              );
              return (
                <div
                  key={conversation.conversationId}
                  role='button'
                  tabIndex={0}
                  className={cn(
                    'group mx-3 mb-3 cursor-pointer overflow-hidden rounded-xl border bg-background transition-colors',
                    hasReplies ? 'border-border/80' : 'border-dashed border-border/80',
                    'hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  )}
                  onClick={event => {
                    // Let links and inline controls inside the bubble behave normally.
                    const target = event.target as HTMLElement;
                    if (target.closest('a, button, [contenteditable="true"]')) return;
                    onSelectConversation(conversation.conversationId);
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectConversation(conversation.conversationId);
                    }
                  }}
                  data-track-category='SdlcHub'
                  data-track-name='SdlcChatOpenThread'
                  data-track-metadata={JSON.stringify({
                    conversationId: conversation.conversationId,
                  })}
                >
                  {hasReplies ? (
                    <>
                      <div className='pb-1 pt-3'>{bubble}</div>
                      <div className='mx-4 border-t border-border/60' />
                      <div className='flex items-center gap-2 px-4 py-2.5 text-xs'>
                        {repliers.length > 0 && (
                          <AvatarGroup userIds={repliers} size='sm' count={3} />
                        )}
                        <span className='font-semibold text-primary'>
                          {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                        </span>
                        <span className='text-muted-foreground'>
                          Last reply {formatTimeAmPm(conversation.lastActivityAt)}
                        </span>
                        <ChevronRight className='ml-auto size-4 shrink-0 text-muted-foreground/70 transition-transform group-hover:translate-x-0.5' />
                      </div>
                    </>
                  ) : (
                    <div className='flex items-center'>
                      <div className='min-w-0 flex-1 pb-2 pt-3'>{bubble}</div>
                      {!isSystemMessage && (
                        <span className='shrink-0 self-center pr-4 text-sm text-muted-foreground'>
                          No replies yet
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={feedEndRef} />
          </>
        )}
      </div>

      <div className='shrink-0 px-3 pb-3 pt-1'>
        <ChatInput
          channelId={channelId}
          showTypingIndicator={false}
          placeholder={`Message ${title}…`}
          {...(user?.id && { currentUserId: user.id })}
          sdlcDiscussion={discussion}
        />
      </div>
    </aside>
  );
}
