// HUB desk tickets: the conversation the ticket was opened for stays in its own channel, named by the
// ticket's stub on the desk. Zero only returns it to members of that channel; everyone else on the
// desk sees why they can't open it.
// Rendered like other desks: the conversation in the ticket body, the composer in the bottom overlay.
import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { Lock } from 'lucide-react';
import { usePendingForThread, buildPendingThreadMessage } from '@xyne/shared/messages';
import { ChatInput } from '../../components/Chat/ChatInput';
import ThreadList from '../../components/Chat/ThreadList/ThreadList';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useAuth } from '../../hooks/useAuth';
import { useChannel } from '../../hooks/useChannels';
import { insertDateSeparatorsForThreadMessages } from '../../utils/chatUtils';
import { queries } from '../../zero/queries';

interface HubThreadProps {
  ticketId: string;
  deskChannelId: string;
}

function useHubSourceThread({ ticketId, deskChannelId }: HubThreadProps) {
  // The ticket's stub on the desk names the merchant's thread; that thread itself carries no ticket.
  const [stub, stubDetails] = useCachedQuery(queries.hubTicketStub({ ticketId, deskChannelId }));
  const link = stub?.metadata as
    | { hubSourceConversationId?: string; hubSourceChannelId?: string }
    | null
    | undefined;
  const linkedConversationId = link?.hubSourceConversationId ?? '';
  const channelId = link?.hubSourceChannelId ?? '';
  // Only members of the merchant's channel get the thread back.
  const [conversation, details] = useCachedQuery(
    queries.threadConversationV2({ conversationId: linkedConversationId || ' ', channelId }),
    { enabled: !!linkedConversationId },
  );
  const conversationId = conversation ? linkedConversationId : '';
  const pendingReplies = usePendingForThread(conversationId);

  // A pending reply shadows its Zero row by messageId, as in the thread panel.
  const messages = useMemo(() => {
    const base = conversation?.messages ? [...conversation.messages] : [];
    if (pendingReplies.length === 0) return base;
    const pendingIds = new Set(pendingReplies.map(entry => entry.messageId));
    const pendingRows = [...pendingReplies]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(buildPendingThreadMessage);
    return [
      ...base.filter(m => !pendingIds.has(m.messageId)),
      ...(pendingRows as unknown as typeof base),
    ];
  }, [conversation?.messages, pendingReplies]);

  return {
    sourceLoaded:
      stubDetails.type === 'complete' &&
      (!linkedConversationId || details.type === 'complete' || details.type === 'error'),
    conversationId,
    channelId,
    conversation,
    messagesLoaded: details.type === 'complete' || details.type === 'error',
    messages,
  };
}

/** The merchant conversation, as a flat list like other desks' threads. */
export function HubSourceThread(
  props: HubThreadProps & {
    /** A message of yours was just added, e.g. to scroll the ticket body down to it. */
    onOwnMessage?: () => void;
  },
): ReactElement | null {
  const { onOwnMessage, ...threadProps } = props;
  const { sourceLoaded, conversationId, channelId, conversation, messagesLoaded, messages } =
    useHubSourceThread(threadProps);
  const channel = useChannel(channelId);
  const { user } = useAuth();

  // The thread is oldest-first, so your new reply lands at the bottom of the ticket body.
  const lastMessage = messages[messages.length - 1];
  const lastSeenIdRef = useRef<string | null>(null);
  useEffect(() => {
    const lastId = lastMessage?.messageId ?? null;
    const isNew = lastSeenIdRef.current !== null && lastId !== lastSeenIdRef.current;
    lastSeenIdRef.current = lastId;
    if (isNew && lastMessage?.senderId === user?.id) onOwnMessage?.();
  }, [lastMessage, user?.id, onOwnMessage]);
  const withSeparators = useMemo(() => insertDateSeparatorsForThreadMessages(messages), [messages]);

  if (!conversationId) {
    if (!sourceLoaded) return null;
    return (
      <div className='flex flex-col items-center gap-2 px-6 py-16 text-center'>
        <Lock className='h-6 w-6 text-muted-foreground' />
        <div className='text-sm font-medium text-foreground'>
          You can&apos;t open this conversation
        </div>
        <div className='max-w-sm text-xs text-muted-foreground'>
          It&apos;s in a private channel you&apos;re not a member of, or the channel is no longer
          linked to this desk. Ask the channel&apos;s admin to add you.
        </div>
      </div>
    );
  }

  return (
    <ThreadList
      channelId={channelId}
      conversationId={conversationId}
      threadMessages={messages}
      isTicketThread
      messagesWithSeparators={withSeparators}
      hideReplyDivider
      conversation={conversation}
      channelScopeType={channel?.scopeType}
      isMessagesLoaded={messagesLoaded}
      conversationParticipant={{ lastReadAt: conversation?.participants?.lastReadAt ?? 0 }}
      initialScrollOffset={0}
    />
  );
}

/** Replies go into the conversation in its own channel. Nothing for people who can't open it. */
export function HubComposer(props: HubThreadProps): ReactElement | null {
  const { channelId, conversation, messages } = useHubSourceThread(props);
  const participantIds = useMemo(() => new Set(messages.map(m => m.senderId)), [messages]);
  if (!conversation || !channelId) return null;
  return (
    <div className='border-t border-border px-4 py-3'>
      <ChatInput
        channelId={channelId}
        conversation={conversation}
        placeholder='Reply…'
        threadParticipantIds={participantIds}
      />
    </div>
  );
}
