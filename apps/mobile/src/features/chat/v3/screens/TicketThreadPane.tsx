import { type ReactElement, useMemo } from 'react';

import { surfaceRemountKey } from '../data/conversationRef';
import { ListError } from '../list/ListError';
import { ChatConversation } from './ChatConversation';
import { ticketThreadRaw } from './searchParams';
import { useOpenIntent } from './useOpenIntent';
import { useResolveLocation } from './useResolveLocation';

export function TicketThreadPane({
  channelId,
  threadId,
  ticketId,
  messageId,
  from,
  createdAt,
  source,
  parentTicketMd = null,
  parentTicketId = null,
  onParentTicketPress,
}: {
  channelId: string;
  threadId: string;
  ticketId: string;
  messageId?: string;
  from?: string;
  createdAt?: string;
  source?: string;
  parentTicketMd?: string | null;
  parentTicketId?: string | null;
  onParentTicketPress?: () => void;
}): ReactElement {
  const raw = useMemo(
    () =>
      ticketThreadRaw({
        channelId,
        threadId,
        ticketId,
        ...(messageId ? { messageId } : {}),
        ...(from ? { from } : {}),
        ...(source ? { source } : {}),
        ...(createdAt ? { createdAt } : {}),
      }),
    [channelId, createdAt, from, messageId, source, threadId, ticketId],
  );
  const parsed = useOpenIntent(raw);
  const location = useResolveLocation(parsed.ok ? parsed.value : null);
  if (!parsed.ok) {
    return <ListError failure={parsed.error} />;
  }
  return (
    <ChatConversation
      key={surfaceRemountKey(parsed.value)}
      intent={parsed.value}
      location={location}
      parentTicketMd={parentTicketMd}
      parentTicketId={parentTicketId}
      {...(onParentTicketPress ? { onParentTicketPress } : {})}
    />
  );
}
