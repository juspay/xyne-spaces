import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import {
  Ticket,
  Clock,
  SquareKanban,
  UserPlus,
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
} from 'lucide-react';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';

interface TicketUpdateActivityProps {
  activity: ActivityWithRelated;
  isExpanded: boolean;
}

interface ActivityConfig {
  icon: ReactElement;
  badgeColor: string;
  description: string;
  label: string;
}

const getActivityConfig = (actorAction: string): ActivityConfig => {
  switch (actorAction) {
    case 'ticket_status':
      return {
        icon: <Ticket className='w-4 h-4 text-green-600' />,
        badgeColor: 'bg-green-100',
        description: 'updated status of ticket in',
        label: 'Status',
      };
    case 'ticket_eta':
      return {
        icon: <Clock className='w-4 h-4 text-amber-600' />,
        badgeColor: 'bg-amber-100',
        description: 'updated due date of ticket in',
        label: 'Due Date',
      };
    case 'ticket_board':
      return {
        icon: <SquareKanban className='w-4 h-4 text-purple-600' />,
        badgeColor: 'bg-purple-100',
        description: 'moved ticket to another board in',
        label: 'Board',
      };
    case 'ticket_assigned_to':
      return {
        icon: <UserPlus className='w-4 h-4 text-blue-600' />,
        badgeColor: 'bg-blue-100',
        description: 'changed assignee of ticket in',
        label: 'Assignee',
      };
    case 'ticket_pr_created':
      return {
        icon: <GitPullRequest className='w-4 h-4 text-blue-600' />,
        badgeColor: 'bg-blue-100',
        description: 'raised a PR for ticket in',
        label: 'PR Raised',
      };
    case 'ticket_pr_updated':
      return {
        icon: <GitPullRequest className='w-4 h-4 text-orange-600' />,
        badgeColor: 'bg-orange-100',
        description: 'updated a PR for ticket in',
        label: 'PR Updated',
      };
    case 'ticket_pr_merged':
      return {
        icon: <GitMerge className='w-4 h-4 text-green-600' />,
        badgeColor: 'bg-green-100',
        description: 'merged a PR for ticket in',
        label: 'PR Merged',
      };
    case 'ticket_pr_declined':
      return {
        icon: <GitPullRequestClosed className='w-4 h-4 text-red-600' />,
        badgeColor: 'bg-red-100',
        description: 'declined a PR for ticket in',
        label: 'PR Declined',
      };
    case 'ticket_pr_reviewer_assigned':
      return {
        icon: <GitPullRequest className='w-4 h-4 text-blue-600' />,
        badgeColor: 'bg-blue-100',
        description: 'assigned you as PR reviewer for ticket',
        label: 'PR Reviewer Assigned',
      };
    case 'ticket_qa_assigned':
      return {
        icon: <UserPlus className='w-4 h-4 text-green-600' />,
        badgeColor: 'bg-green-100',
        description: 'assigned you as QA for ticket',
        label: 'QA Assigned',
      };
    default:
      return {
        icon: <Ticket className='w-4 h-4 text-muted-foreground' />,
        badgeColor: 'bg-muted',
        description: 'updated ticket in',
        label: 'Ticket',
      };
  }
};

export const TicketUpdateActivity = ({
  activity,
  isExpanded,
}: TicketUpdateActivityProps): ReactElement | null => {
  const ticket = activity.ticket;
  const actorId = activity.actorId || 'system';
  const actor = useUser(actorId);
  const actorName = actor?.name || 'Xyne';

  if (!ticket) {
    return null;
  }

  const ticketXyneId = ticket.xyneId || activity.ticketId || activity.actionSourceId;
  const ticketIdValue = activity.ticketId || activity.actionSourceId;
  const config = getActivityConfig(activity.actorAction);

  // On mobile: will navigate to minimized view with details tab
  // On desktop: will navigate to tab-based route in ConversationPannel
  const targetPath = `/chat/activity/${ticket.channelId}/${ticket.conversationId}/${ticketIdValue}?selectedTab=details`;
  const supportTargetPath =
    ticket.channelId && ticket.conversationId
      ? `/support/${ticket.channelId}?conversationId=${ticket.conversationId}`
      : undefined;

  const isPRAction = activity.actorAction.startsWith('ticket_pr_');
  const expandedContent = (
    <div className='flex flex-col gap-1 mt-2'>
      <div className='text-sm text-foreground font-medium break-words whitespace-normal'>
        {' '}
        {isPRAction ? config.label.toLowerCase() : `${config.label} updated`} for ticket &ldquo;
        {ticket.title}&rdquo;
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
        {' '}
        {isPRAction ? config.label.toLowerCase() : `${config.label.toLowerCase()} updated`}
      </span>
    </span>
  );

  return (
    <ActivityItemCard
      activity={activity}
      actorId={actorId}
      actorName={actorName}
      channelId={ticket.channelId}
      badgeIcon={config.icon}
      badgeColorClass={config.badgeColor}
      description={<span className='text-muted-foreground text-sm'>{config.description}</span>}
      targetPath={targetPath}
      supportTargetPath={supportTargetPath}
      isExpanded={isExpanded}
    >
      {isExpanded ? expandedContent : condensedContent}
    </ActivityItemCard>
  );
};
