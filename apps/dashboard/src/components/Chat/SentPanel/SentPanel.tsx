import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import type { Message, Conversation, MessageAttachment } from '@xyne/shared';
import { format } from 'date-fns';
import { MessageCard, RecipientAvatar, useRecipientName } from '../MessageCard';
import { formatDatePill } from '../../../utils/dateUtils';

const PAGE_SIZE = 25;

/** From `userSentMessagesPaginated` with `.related('conversation').related('attachments')`. */
type SentMessageWithConversation = Message & {
  conversation?: Conversation | undefined;
  attachments?: readonly MessageAttachment[] | undefined;
};

type SentCursor = { messageId: string; createdAt: number };

/** One virtualized row: heading + single bordered stack of messages for that calendar day */
interface SentDateGroup {
  _kind: 'date-group';
  id: string;
  dateText: string;
  messages: SentMessageWithConversation[];
}

type SentPanelItem = SentDateGroup;

const groupMessagesByDay = (messages: SentMessageWithConversation[]): SentDateGroup[] => {
  const groups: SentDateGroup[] = [];
  let currentDayKey: string | null = null;
  let currentMessages: SentMessageWithConversation[] = [];

  const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  const flush = (): void => {
    if (currentMessages.length === 0 || currentDayKey === null) return;
    const first = currentMessages[0];
    if (!first) return;
    const anchor = new Date(first.createdAt);
    groups.push({
      _kind: 'date-group',
      id: `date-${dayKey(anchor)}`,
      dateText: formatDatePill(anchor),
      messages: currentMessages,
    });
    currentMessages = [];
    currentDayKey = null;
  };

  for (const message of messages) {
    const d = new Date(message.createdAt);
    const key = dayKey(d);
    if (currentDayKey !== key) {
      flush();
      currentDayKey = key;
    }
    currentMessages.push(message);
  }
  flush();

  return groups;
};

const flattenGroups = (items: SentPanelItem[]): SentMessageWithConversation[] =>
  items.flatMap(g => g.messages);

const mergeSentPages = (
  prevGroups: SentDateGroup[],
  nextMessages: SentMessageWithConversation[],
): SentDateGroup[] => {
  const map = new Map<string, SentMessageWithConversation>();
  for (const m of flattenGroups(prevGroups)) {
    if (!map.has(m.messageId)) map.set(m.messageId, m);
  }
  for (const m of nextMessages) {
    map.set(m.messageId, m);
  }
  const messages = [...map.values()];
  messages.sort((a, b) => b.createdAt - a.createdAt || b.messageId.localeCompare(a.messageId));
  return groupMessagesByDay(messages);
};

const cursorForOldestInList = (groups: SentDateGroup[]): SentCursor => {
  const lastGroup = groups[groups.length - 1];
  const lastMsg = lastGroup?.messages[lastGroup.messages.length - 1];
  return lastMsg
    ? { messageId: lastMsg.messageId, createdAt: lastMsg.createdAt }
    : { messageId: '', createdAt: 0 };
};

const SentGroupMessageRow = ({
  message,
}: {
  message: SentMessageWithConversation;
}): ReactElement => {
  const navigate = useNavigate();
  const conversation = message.conversation;
  const recipientName = useRecipientName(message, conversation ?? null);
  const plainPreview = message.content.replace(/<[^>]+>/g, '').trim() || '(no text)';
  const timestamp = format(new Date(message.createdAt), 'h:mm a');
  const panelAttachments = useMemo(() => {
    const raw = message.attachments;
    if (!raw?.length) return [];
    return raw.map(a => ({
      id: a.id,
      mimetype: a.mimetype,
      originalFilename: a.originalFilename,
      thumbnailUrl: a.thumbnailUrl,
      size: a.size,
    }));
  }, [message.attachments]);

  const handleClick = (): void => {
    const conv = conversation;
    const channelId = conv?.channelId;
    const conversationId = message.conversationId ?? conv?.conversationId;
    if (!channelId || !conversationId) return;

    // Match Activity tab deep links so ChatList scrolls to origin and ChatBubble applies highlight-message
    const isThreadReply = conv.initialMessageId !== message.messageId;
    const hash = isThreadReply
      ? `#origin=${conversationId}&messageId=${message.messageId}`
      : `#origin=${conversationId}`;
    const path = isThreadReply
      ? `/chat/dir/${channelId}/${conversationId}${hash}`
      : `/chat/dir/${channelId}${hash}`;

    void navigate(path);
  };

  return (
    <MessageCard
      recipientAvatar={<RecipientAvatar conversation={conversation ?? null} />}
      recipientName={recipientName}
      contentPreview={plainPreview}
      timestamp={timestamp}
      actions={null}
      variant='listRow'
      onClick={handleClick}
      trackCategory='CHAT_SIDEBAR'
      trackName='OPEN_SENT_MESSAGE'
      attachments={panelAttachments}
    />
  );
};

const SentDateGroupBlock = ({ group }: { group: SentDateGroup }): ReactElement => (
  <div className='mb-4 px-2 first:pt-1'>
    <h4 className='text-sm font-semibold text-foreground pb-2 pt-3'>{group.dateText}</h4>
    <div className='rounded-xl border border-border bg-card overflow-hidden shadow-sm'>
      {group.messages.map(message => (
        <div key={message.messageId} className='border-b border-border last:border-b-0'>
          <SentGroupMessageRow message={message} />
        </div>
      ))}
    </div>
  </div>
);

const SentPanel = (): ReactElement => {
  const [groups, setGroups] = useState<SentDateGroup[]>([]);
  const [cursor, setCursor] = useState<SentCursor | null>(null);

  const groupsRef = useRef<SentDateGroup[]>([]);
  const reachedEndRef = useRef(false);
  const pendingLoadCursorKeyRef = useRef<string | null>(null);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  const query = useMemo(
    () =>
      queries.userSentMessagesPaginated({
        limit: PAGE_SIZE,
        start: cursor,
      }),
    [cursor],
  );

  const [page, queryDetails] = useCachedQuery(query as never, true);

  useEffect(() => {
    if (queryDetails.type === 'error') {
      pendingLoadCursorKeyRef.current = null;
      return;
    }

    if (queryDetails.type !== 'complete') {
      return;
    }

    const typedPage = page as unknown as ReadonlyArray<SentMessageWithConversation> | undefined;
    const nextPage = Array.from(typedPage ?? []);

    if (nextPage.length === 0) {
      if (cursor !== null && groupsRef.current.length > 0) {
        reachedEndRef.current = true;
      }
      pendingLoadCursorKeyRef.current = null;
      return;
    }

    pendingLoadCursorKeyRef.current = null;
    reachedEndRef.current = false;

    const merged =
      cursor === null ? mergeSentPages([], nextPage) : mergeSentPages(groupsRef.current, nextPage);

    groupsRef.current = merged;
    setGroups(merged);

    if (nextPage.length < PAGE_SIZE) {
      reachedEndRef.current = true;
    }
  }, [queryDetails.type, page, cursor]);

  const isInitialLoading = queryDetails.type !== 'complete' && groups.length === 0;
  const isAppending = queryDetails.type !== 'complete' && groups.length > 0;

  const loadMore = useCallback(() => {
    if (reachedEndRef.current) return;
    if (queryDetails.type !== 'complete') return;
    if (groupsRef.current.length === 0) return;

    const next = cursorForOldestInList(groupsRef.current);
    if (!next.messageId) return;

    const key = JSON.stringify(next);
    if (pendingLoadCursorKeyRef.current === key) return;
    pendingLoadCursorKeyRef.current = key;
    setCursor(next);
  }, [queryDetails.type]);

  const emptyState = (
    <div className='flex flex-col items-center justify-center h-full p-8 text-center'>
      <Send className='text-muted-foreground mb-4' size={48} />
      <p className='text-muted-foreground text-lg font-medium mb-2'>No sent messages</p>
      <p className='text-muted-foreground text-sm max-w-md'>Messages you send will appear here</p>
    </div>
  );

  return (
    <div className='flex-1 h-full flex flex-col overflow-hidden bg-muted/30'>
      <div className='flex-1 overflow-y-auto p-6 min-h-0'>
        {queryDetails.type === 'error' ? (
          <div className='flex flex-col items-center justify-center h-full p-8 text-center text-sm text-destructive'>
            Could not load sent messages.
          </div>
        ) : isInitialLoading ? (
          <div className='flex items-center justify-center h-full p-8 text-sm text-muted-foreground'>
            Loading…
          </div>
        ) : groups.length === 0 ? (
          emptyState
        ) : (
          <Virtuoso<SentPanelItem>
            data={groups}
            className='h-full'
            style={{ height: '100%' }}
            endReached={loadMore}
            computeItemKey={(_, item) => item.id}
            itemContent={(_, item) => <SentDateGroupBlock group={item} />}
            components={{
              Footer: () =>
                isAppending ? (
                  <div className='py-3 text-center text-xs text-muted-foreground'>Loading…</div>
                ) : null,
            }}
          />
        )}
      </div>
    </div>
  );
};

SentPanel.displayName = 'SentPanel';

export default SentPanel;
