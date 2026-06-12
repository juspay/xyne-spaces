import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { UserPlus } from 'lucide-react';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';

interface TicketAssignmentActivityProps {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}

export const TicketAssignmentActivity = ({
  activity,
  isExpanded,
}: TicketAssignmentActivityProps): ReactElement | null => {
  const ticket = activity.ticket;
  const actorId = activity.actorId || 'system';
  const actor = useUser(actorId);
  const actorName = actor?.name || 'Xyne';

  // Get the assigned user's name - always call the hook before early return
  const assignedUser = useUser(ticket?.assignedTo || '');
  const assignedUserName = assignedUser?.name || 'Unknown';

  if (!ticket) {
    return null;
  }

  const ticketXyneId = ticket.xyneId || activity.ticketId || activity.actionSourceId;
  const ticketIdValue = activity.ticketId || activity.actionSourceId;

  // On mobile: will navigate to minimized view with details tab
  // On desktop: will navigate to tab-based route in ConversationPannel
  const targetPath = `/chat/activity/${ticket.channelId}/${ticket.conversationId}/${ticketIdValue}?selectedTab=details`;
  const supportTargetPath =
    ticket.channelId && ticket.conversationId
      ? `/support/${ticket.channelId}?conversationId=${ticket.conversationId}`
      : undefined;

  // Check if the recipient (activity.userId) is the one who was assigned
  const isRecipientAssigned = ticket.assignedTo === activity.userId;

  const expandedContent = (
    <div className='flex flex-col gap-1 mt-2'>
      <div className='text-sm text-foreground font-medium break-words whitespace-normal'>
        {isRecipientAssigned ? (
          <>You have been assigned to ticket &ldquo;{ticket.title}&rdquo;</>
        ) : (
          <>
            {assignedUserName} has been assigned to ticket &ldquo;{ticket.title}&rdquo;
          </>
        )}
      </div>
      <div className='text-xs text-muted-foreground break-words whitespace-normal'>
        Ticket ID: <span className='font-mono'>{ticketXyneId}</span>
      </div>
    </div>
  );

  const condensedContent = (
    <span className='text-sm text-foreground'>
      <span className='font-semibold'>{ticketXyneId}</span>
      <span className='text-muted-foreground'>
        {isRecipientAssigned ? ' assigned to you' : ` assigned to ${assignedUserName}`}
      </span>
    </span>
  );

  const description = isRecipientAssigned ? (
    <span className='text-muted-foreground text-sm'>assigned you to ticket in</span>
  ) : (
    <span className='text-muted-foreground text-sm'>changed assignee of ticket in</span>
  );

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actorId}
      actorName={actorName}
      channelId={ticket.channelId}
      badgeIcon={<UserPlus className='w-4 h-4 text-blue-600' />}
      badgeColorClass='bg-blue-100'
      description={description}
      targetPath={targetPath}
      focusThread
      supportTargetPath={supportTargetPath}
      isExpanded={isExpanded}
    >
      {isExpanded ? expandedContent : condensedContent}
    </ActivityItemCard>
  );
};
