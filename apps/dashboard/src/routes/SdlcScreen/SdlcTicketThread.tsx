import type { ReactElement } from 'react';
import { ThreadMessages } from '../../components/Chat/ThreadPannel';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useChannelParticipation } from '../../hooks/useChannels';
import { queries } from '../../zero/queries';

interface SdlcTicketThreadProps {
  ticketId: string;
  onClose: () => void;
}

const noopUserClick = (): void => {};

/** Whether the viewer can open this ticket's thread: they are in its channel. */
export function useTicketThreadAccess(ticketId: string | null): boolean {
  const [ticket] = useCachedQuery(queries.ticketRowById({ ticketId: ticketId ?? '' }), {
    enabled: !!ticketId,
  });
  const participation = useChannelParticipation(ticketId ? (ticket?.channelId ?? '') : '');
  return !!ticketId && !!participation;
}

export function SdlcTicketThread({
  ticketId,
  onClose,
}: SdlcTicketThreadProps): ReactElement | null {
  const [ticket] = useCachedQuery(queries.ticketRowById({ ticketId }));
  if (!ticket) return null;

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col bg-background [&_.relative.min-h-0.max-h-full]:flex-1'>
      <ThreadMessages
        key={ticket.id}
        channelId={ticket.channelId}
        conversationId={ticket.conversationId}
        ticketId={ticket.id}
        onClose={onClose}
        onUserClick={noopUserClick}
        skipInputAutoFocus
      />
    </div>
  );
}
