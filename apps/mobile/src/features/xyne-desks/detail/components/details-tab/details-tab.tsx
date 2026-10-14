import { memo, type ReactElement } from 'react';

import { EditableTicketOverview } from '@/src/screens/ticket-details/editable-ticket-overview';

type DetailsTabProps = {
  ticketId: string;
  channelId: string;
  contentPaddingTop: number;
};

/**
 * Desk Details tab — same editable overview as TicketDetailsScreen (title,
 * description, assignee, priority, status, board, labels, due date, …).
 */
export const DetailsTab = memo(function DetailsTab({
  ticketId,
  channelId,
  contentPaddingTop,
}: DetailsTabProps): ReactElement {
  return (
    <EditableTicketOverview
      ticketId={ticketId}
      channelId={channelId}
      contentPaddingTop={contentPaddingTop + 8}
    />
  );
});
