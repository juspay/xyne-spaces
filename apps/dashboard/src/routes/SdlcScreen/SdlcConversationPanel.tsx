import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { AlertCircle, ArrowLeft, ChevronRight, MessageCircle, Plus, WifiOff } from 'lucide-react';
import { MessageType, parseRepliesMd, type SdlcDiscussion } from '@xyne/shared';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation } from '../../machines/stateMachine';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { Button } from '../../components/ui/Button';
import Input from '../../components/ui/Input/Input';
import { ThreadMessages } from '../../components/Chat/ThreadPannel';
import UserAvatar, { AvatarShape, AvatarSize } from '../../components/UserAvatar/UserAvatar';
import AvatarGroup from '../../components/ui/Avatar/AvatarGroup';
import { getInitialMessageFromConversation } from '../../utils/conversationMessageHelpers';
import { formatRelativeTime } from '../../utils/dateUtils';
import { useZeroOfflineState } from '@xyne/shared/hooks';
import {
  escapeSdlcConversationTitle,
  sdlcConversationTitleFromHtml,
  shouldClearSelectedSdlcConversation,
} from './sdlcChatPolicy';
import { SdlcChatHeader } from './SdlcChatHeader';

interface SdlcConversationPanelProps {
  repoId: string;
  channelId: string;
  ownerCanvasId: string;
  ownerKind: string;
  surfaceType: SdlcDiscussion['surfaceType'];
  surfaceId: string;
  conversationIds: string[];
  selectedConversationId: string | null;
  onSelectConversation: (conversationId: string | null) => void;
  onOpenAI: () => void;
  onClose: () => void;
}

const NO_CONVERSATIONS: Conversation[] = [];
const MAX_TITLE_LENGTH = 160;

export function SdlcConversationPanel({
  repoId,
  channelId,
  ownerCanvasId,
  ownerKind,
  surfaceType,
  surfaceId,
  conversationIds,
  selectedConversationId,
  onSelectConversation,
  onOpenAI,
  onClose,
}: SdlcConversationPanelProps): ReactElement {
  const [conversationLimit, setConversationLimit] = useState(50);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();
  const zero = useZero();
  const { isOffline, showOfflineBanner, isReconnecting, refreshConnection } = useZeroOfflineState();
  const [rows, queryDetails] = useCachedQuery(
    queries.sdlcDiscussionConversations({ channelId, conversationIds, limit: conversationLimit }),
  );
  const conversations = useMemo(
    () =>
      Array.isArray(rows)
        ? [...(rows as unknown as Conversation[])].sort(
            (left, right) => right.lastActivityAt - left.lastActivityAt,
          )
        : NO_CONVERSATIONS,
    [rows],
  );
  const selectedConversationLinked = Boolean(
    selectedConversationId && conversationIds.includes(selectedConversationId),
  );
  const [selectedConversationRow, selectedQueryDetails] = useCachedQuery(
    queries.sdlcDiscussionConversation({
      channelId,
      conversationId:
        selectedConversationId && selectedConversationLinked
          ? selectedConversationId
          : '__no_sdlc_selected_conversation__',
    }),
  );
  const selectedConversation =
    selectedConversationId && selectedConversationRow
      ? (selectedConversationRow as unknown as Conversation)
      : undefined;

  useEffect(() => {
    if (
      shouldClearSelectedSdlcConversation({
        selectedConversationId,
        linkedConversationIds: conversationIds,
        selectedQueryComplete: selectedQueryDetails.type === 'complete',
        selectedConversationFound: Boolean(selectedConversation),
      })
    ) {
      onSelectConversation(null);
    }
  }, [
    conversationIds,
    onSelectConversation,
    selectedConversation,
    selectedConversationId,
    selectedQueryDetails.type,
  ]);

  const discussion = useMemo<Omit<SdlcDiscussion, 'linkId'>>(
    () => ({ repoId, ownerCanvasId, surfaceType, surfaceId }),
    [ownerCanvasId, repoId, surfaceId, surfaceType],
  );

  const createConversation = useCallback(async (): Promise<void> => {
    const nextTitle = title.trim();
    if (!nextTitle || creating) return;
    if (isOffline) {
      toast.error('Reconnect before creating a conversation');
      return;
    }
    setCreating(true);
    const conversationId = uuidv4();
    try {
      const result = zero.mutate(
        mutators.conversations.send({
          channelId,
          content: escapeSdlcConversationTitle(nextTitle),
          type: MessageType.USER,
          conversationId,
          messageId: uuidv4(),
          timestamp: Date.now(),
          sdlcDiscussion: { ...discussion, linkId: uuidv4() },
        }),
      );
      const response = await result.server;
      if (response.type === 'error') throw new Error(response.error.message);
      setTitle('');
      setShowCreate(false);
      onSelectConversation(conversationId);
    } catch (error) {
      toast.error('Conversation was not created', {
        description: error instanceof Error ? error.message : 'Try again.',
      });
    } finally {
      setCreating(false);
    }
  }, [channelId, creating, discussion, isOffline, onSelectConversation, title, zero]);

  const panelHeader = (
    <SdlcChatHeader
      activeTab='conversations'
      onOpenConversations={() => undefined}
      onOpenAI={onOpenAI}
      onClose={onClose}
    />
  );

  if (selectedConversationId && selectedConversation) {
    const initialMessage = getInitialMessageFromConversation(selectedConversation, user?.id);
    const selectedTitle = sdlcConversationTitleFromHtml(initialMessage?.content ?? 'Conversation');
    return (
      <aside
        className='flex h-full min-w-0 flex-col border-l bg-transparent'
        aria-label='SDLC conversation'
        data-track-category='SdlcHub'
        data-track-name='ConversationThreadViewed'
        data-track-metadata={JSON.stringify({ ownerKind, conversationId: selectedConversationId })}
      >
        {panelHeader}
        <div className='flex h-10 shrink-0 items-center gap-2 bg-muted/20 px-3'>
          <Button
            variant='ghost'
            size='iconSm'
            onClick={() => onSelectConversation(null)}
            aria-label='Back to conversations'
            data-track-category='SdlcHub'
            data-track-name='ConversationThreadBack'
            data-track-metadata={JSON.stringify({ ownerKind })}
          >
            <ArrowLeft />
          </Button>
          <UserAvatar
            userId={selectedConversation.createdBy}
            size={AvatarSize.SM}
            shape={AvatarShape.CIRCULAR}
            showActiveStatus={false}
          />
          <div className='truncate text-xs font-medium'>{selectedTitle}</div>
        </div>
        <div className='min-h-0 flex-1 [&_.bg-background]:bg-transparent'>
          <ThreadMessages
            channelId={channelId}
            conversationId={selectedConversationId}
            onClose={() => onSelectConversation(null)}
            simpleView
            hideHeader
            disableAskAI
          />
        </div>
      </aside>
    );
  }

  const isLoading = queryDetails.type !== 'complete' && conversations.length === 0;

  return (
    <aside
      className='flex h-full min-w-0 flex-col border-l bg-transparent'
      aria-label='SDLC conversations'
      data-track-category='SdlcHub'
      data-track-name='ConversationListViewed'
      data-track-metadata={JSON.stringify({ ownerKind })}
    >
      {panelHeader}
      {showOfflineBanner ? (
        <div className='mx-3 mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200'>
          <WifiOff className='size-3.5 shrink-0' />
          <span className='min-w-0 flex-1'>
            {isReconnecting ? 'Reconnecting…' : 'Offline. Existing topics remain available.'}
          </span>
          <Button variant='ghost' size='sm' onClick={refreshConnection} disabled={isReconnecting}>
            Retry
          </Button>
        </div>
      ) : null}
      <div className='flex shrink-0 items-center justify-between px-3 pb-1 pt-3'>
        <div className='text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
          Topics
        </div>
        <Button
          variant='ghost'
          size='iconSm'
          onClick={() => setShowCreate(value => !value)}
          aria-label='New conversation'
          title='New conversation'
          data-track-category='SdlcHub'
          data-track-name='NewConversationFocused'
          data-track-metadata={JSON.stringify({ ownerKind })}
        >
          <Plus />
        </Button>
      </div>

      {showCreate ? (
        <form
          className='mx-3 mb-2 mt-1 rounded-xl bg-muted/30 p-3'
          onSubmit={event => {
            event.preventDefault();
            void createConversation();
          }}
        >
          <label htmlFor='sdlc-conversation-title' className='text-xs font-semibold'>
            Conversation title
          </label>
          <Input
            id='sdlc-conversation-title'
            value={title}
            onChange={event => setTitle(event.target.value)}
            placeholder='What needs discussion?'
            maxLength={MAX_TITLE_LENGTH}
            autoFocus
            className='mt-2 bg-background'
          />
          <div className='mt-2 flex items-center justify-between gap-2'>
            <span className='text-[11px] text-muted-foreground'>
              Be specific. Replies hold the detail.
            </span>
            <div className='flex gap-1.5'>
              <Button type='button' variant='ghost' size='sm' onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                type='submit'
                size='sm'
                disabled={!title.trim() || isOffline}
                loading={creating}
                data-track-category='SdlcHub'
                data-track-name='SdlcConversationTitleCreated'
                data-track-metadata={JSON.stringify({ ownerKind })}
              >
                Create
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      <div className='min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1'>
        {conversationIds.length > conversations.length ? (
          <div className='flex justify-center pb-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setConversationLimit(limit => limit + 50)}
            >
              Load older
            </Button>
          </div>
        ) : null}
        {queryDetails.type === 'error' ? (
          <div className='grid h-full place-items-center px-6 text-center'>
            <div>
              <AlertCircle className='mx-auto size-8 text-destructive/70' />
              <p className='mt-3 text-sm font-medium'>Could not load conversations</p>
              <p className='mt-1 text-xs text-muted-foreground'>Check the connection and retry.</p>
              <Button className='mt-4' size='sm' variant='outline' onClick={refreshConnection}>
                Retry
              </Button>
            </div>
          </div>
        ) : isLoading ? (
          <div className='grid h-full place-items-center text-sm text-muted-foreground'>
            Loading conversations…
          </div>
        ) : conversations.length === 0 ? (
          <div className='grid h-full place-items-center px-6 text-center'>
            <div>
              <MessageCircle className='mx-auto size-8 text-muted-foreground/50' />
              <p className='mt-3 text-sm font-medium'>No conversations yet</p>
              <p className='mt-1 text-xs text-muted-foreground'>
                Create a focused topic for this item.
              </p>
              <Button
                className='mt-4'
                size='sm'
                onClick={() => setShowCreate(true)}
                disabled={isOffline}
              >
                <Plus className='size-3.5' />
                Create conversation
              </Button>
            </div>
          </div>
        ) : (
          conversations.map(conversation => {
            const participant = (
              conversation as unknown as {
                participants?: readonly { lastReadAt?: number | null }[];
              }
            ).participants?.[0];
            const unread = Boolean(
              participant?.lastReadAt
                ? conversation.lastActivityAt > participant.lastReadAt
                : conversation.createdBy !== user?.id ||
                    (conversation.replyCount > 0 &&
                      conversation.lastActivityAt > conversation.createdAt),
            );
            const initialMessage = getInitialMessageFromConversation(conversation, user?.id);
            const conversationTitle = sdlcConversationTitleFromHtml(initialMessage?.content ?? '');
            const repliers = [...parseRepliesMd(conversation.replies_md).repliers].reverse();
            return (
              <button
                type='button'
                key={conversation.conversationId}
                onClick={() => onSelectConversation(conversation.conversationId)}
                className='group mb-1.5 flex w-full items-start gap-3 rounded-xl bg-muted/20 px-3 py-3 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                data-track-category='SdlcHub'
                data-track-name='ConversationThreadSelected'
                data-track-metadata={JSON.stringify({
                  ownerKind,
                  conversationId: conversation.conversationId,
                })}
              >
                <span className='relative shrink-0'>
                  <UserAvatar
                    userId={conversation.createdBy}
                    size={AvatarSize.REGULAR}
                    shape={AvatarShape.CIRCULAR}
                    showActiveStatus={false}
                  />
                  {unread ? (
                    <span className='absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-primary' />
                  ) : null}
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-semibold'>{conversationTitle}</span>
                  <span className='mt-1.5 flex min-h-5 items-center gap-1.5 text-[11px] text-muted-foreground'>
                    {repliers.length > 0 ? (
                      <AvatarGroup userIds={repliers} size='xs' count={3} />
                    ) : null}
                    <span>
                      {conversation.replyCount === 1
                        ? '1 reply'
                        : `${conversation.replyCount} replies`}
                    </span>
                    <span aria-hidden='true'>·</span>
                    <span>{formatRelativeTime(conversation.lastActivityAt)}</span>
                  </span>
                </span>
                <ChevronRight className='mt-1 size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground' />
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
