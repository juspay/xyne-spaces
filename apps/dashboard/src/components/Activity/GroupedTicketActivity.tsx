import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import { TicketToken } from '@xyne/icons';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { ActivityItemCard } from './ActivityItemCard';

interface GroupedTicketActivityProps {
  activities: ActivityWithRelated[];
  isExpanded: boolean;
}

const ACTION_LABELS: Record<string, string> = {
  ticket_status: 'status',
  ticket_status_v2: 'status',
  ticket_eta: 'due date',
  ticket_board: 'board',
  ticket_assigned: 'assignee',
  ticket_assigned_to: 'assignee',
  ticket_priority: 'priority',
  ticket_user_group: 'team',
  ticket_user_group_id: 'team',
  ticket_title: 'title',
  ticket_description: 'description',
  ticket_rca_created: 'RCA',
  ticket_rca_updated: 'RCA',
  ticket_subticket_added: 'sub-ticket',
  ticket_reference_added: 'related ticket',
  ticket_reference_removed: 'related ticket',
  ticket_pr_created: 'PR',
  ticket_pr_updated: 'PR',
  ticket_pr_merged: 'PR',
  ticket_pr_declined: 'PR',
  ticket_pr_reviewer_assigned: 'PR reviewer',
  ticket_qa_assigned: 'QA',
};

function getActionLabel(actorAction: string): string {
  return ACTION_LABELS[actorAction] || 'field';
}

export const GroupedTicketActivity = ({
  activities,
  isExpanded,
}: GroupedTicketActivityProps): ReactElement | null => {
  const first = activities[0];
  const actorId = first?.actorId || 'system';
  const actor = useUser(actorId);
  const actorName = actor ? getUserDisplayName(actor) : 'Xyne';

  if (!first || !first.ticket) return null;

  const ticket = first.ticket;
  const ticketXyneId = ticket.xyneId || first.ticketId || first.actionSourceId;
  const ticketIdValue = first.ticketId || first.actionSourceId;
  const targetPath = `/chat/activity/${ticket.channelId}/${ticket.conversationId}/${ticketIdValue}?selectedTab=details`;
  const supportTargetPath =
    ticket.channelId && ticket.conversationId
      ? `/support/${ticket.channelId}?conversationId=${ticket.conversationId}`
      : undefined;

  // Collect unique labels and format as comma-separated list
  const labels = [...new Set(activities.map(a => getActionLabel(a.actorAction)))];
  const labelList =
    labels.length > 1
      ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
      : labels[0] || 'fields';

  // A grouped card is unread as long as any underlying activity is unread —
  // matches markManyAsRead, which clears every id in the group together.
  const groupIsRead = activities.every(a => a.isRead);

  const content = (
    <span className='text-sm'>
      <span className={groupIsRead ? 'text-muted-foreground' : 'font-semibold'}>
        {ticketXyneId}
      </span>
      <span className='text-muted-foreground'> {labelList} updated</span>
    </span>
  );

  return (
    <ActivityItemCard
      activity={
        {
          ...first,
          actorAction: 'ticket_multi_updated',
          isRead: groupIsRead,
        } as ActivityWithRelated
      }
      actorId={actorId}
      actorName={actorName}
      channelId={ticket.channelId}
      badgeIcon={<TicketToken className='size-3 text-muted-foreground' />}
      badgeColorClass='bg-muted'
      description={<span className='text-muted-foreground text-sm'>updated ticket in</span>}
      targetPath={targetPath}
      focusThread
      supportTargetPath={supportTargetPath}
      isExpanded={isExpanded}
      groupActivityIds={activities.map(a => a.id)}
    >
      {content}
    </ActivityItemCard>
  );
};
