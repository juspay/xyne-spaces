import { ReactElement } from 'react';
import type { ActivityWithRelated } from '../../types/activity';
import {
  ClockDefault,
  KanbanBoard,
  UserPlus,
  GitPullRequest,
  Merge,
  GitPullRequestCancel,
  Subtask,
  LinkHorizontal,
  File02ExclamationMark,
  AlertTriangle,
  TicketToken,
} from '@xyne/icons';
import { ActivityItemCard } from './ActivityItemCard';
import { useUser } from '../../hooks/useUsers';
import { getUserDisplayName } from '../../utils/userDisplayName';

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
    case 'ticket_status_v2':
      return {
        icon: <TicketToken className='size-3 text-green-600' />,
        badgeColor: 'bg-green-100',
        description: 'updated status of ticket in',
        label: 'Status',
      };
    case 'ticket_eta':
      return {
        icon: <ClockDefault className='size-3 text-amber-600' />,
        badgeColor: 'bg-amber-100',
        description: 'updated due date of ticket in',
        label: 'Due Date',
      };
    case 'ticket_board':
      return {
        icon: <KanbanBoard className='size-3 text-purple-600' />,
        badgeColor: 'bg-purple-100',
        description: 'moved ticket to another board in',
        label: 'Board',
      };
    case 'ticket_assigned_to':
      return {
        icon: <UserPlus className='size-3 text-blue-600' />,
        badgeColor: 'bg-blue-100',
        description: 'changed assignee of ticket in',
        label: 'Assignee',
      };
    case 'ticket_priority':
      return {
        icon: <AlertTriangle className='size-3 text-orange-600' />,
        badgeColor: 'bg-orange-100',
        description: 'updated priority of ticket in',
        label: 'Priority',
      };
    case 'ticket_user_group':
      return {
        icon: <UserPlus className='size-3 text-indigo-600' />,
        badgeColor: 'bg-indigo-100',
        description: 'changed team of ticket in',
        label: 'Team',
      };
    case 'ticket_title':
      return {
        icon: <File02ExclamationMark className='size-3 text-cyan-600' />,
        badgeColor: 'bg-cyan-100',
        description: 'renamed ticket in',
        label: 'Title',
      };
    case 'ticket_description':
      return {
        icon: <File02ExclamationMark className='size-3 text-teal-600' />,
        badgeColor: 'bg-teal-100',
        description: 'updated description of ticket in',
        label: 'Description',
      };
    case 'ticket_rca_created':
      return {
        icon: <AlertTriangle className='size-3 text-red-600' />,
        badgeColor: 'bg-red-100',
        description: 'added an RCA to ticket in',
        label: 'RCA Added',
      };
    case 'ticket_rca_updated':
      return {
        icon: <AlertTriangle className='size-3 text-orange-600' />,
        badgeColor: 'bg-orange-100',
        description: 'updated the RCA of ticket in',
        label: 'RCA Updated',
      };
    case 'ticket_subticket_added':
      return {
        icon: <Subtask className='size-3 text-emerald-600' />,
        badgeColor: 'bg-emerald-100',
        description: 'added a sub-ticket to ticket in',
        label: 'Sub-ticket Added',
      };
    case 'ticket_reference_added':
      return {
        icon: <LinkHorizontal className='size-3 text-sky-600' />,
        badgeColor: 'bg-sky-100',
        description: 'linked a related ticket in',
        label: 'Related Ticket Linked',
      };
    case 'ticket_reference_removed':
      return {
        icon: <LinkHorizontal className='size-3 text-slate-600' />,
        badgeColor: 'bg-slate-100',
        description: 'unlinked a related ticket in',
        label: 'Related Ticket Unlinked',
      };
    case 'ticket_multi_updated':
      return {
        icon: <TicketToken className='size-3 text-muted-foreground' />,
        badgeColor: 'bg-muted',
        description: 'made multiple changes to ticket in',
        label: 'Multiple Changes',
      };
    case 'ticket_pr_created':
      return {
        icon: <GitPullRequest className='size-3 text-blue-600' />,
        badgeColor: 'bg-blue-100',
        description: 'raised a PR for ticket in',
        label: 'PR Raised',
      };
    case 'ticket_pr_updated':
      return {
        icon: <GitPullRequest className='size-3 text-orange-600' />,
        badgeColor: 'bg-orange-100',
        description: 'updated a PR for ticket in',
        label: 'PR Updated',
      };
    case 'ticket_pr_merged':
      return {
        icon: <Merge className='size-3 text-green-600' />,
        badgeColor: 'bg-green-100',
        description: 'merged a PR for ticket in',
        label: 'PR Merged',
      };
    case 'ticket_pr_declined':
      return {
        icon: <GitPullRequestCancel className='size-3 text-red-600' />,
        badgeColor: 'bg-red-100',
        description: 'declined a PR for ticket in',
        label: 'PR Declined',
      };
    case 'ticket_pr_reviewer_assigned':
      return {
        icon: <GitPullRequest className='size-3 text-blue-600' />,
        badgeColor: 'bg-blue-100',
        description: 'assigned you as PR reviewer for ticket',
        label: 'PR Reviewer Assigned',
      };
    case 'ticket_qa_assigned':
      return {
        icon: <UserPlus className='size-3 text-green-600' />,
        badgeColor: 'bg-green-100',
        description: 'assigned you as QA for ticket',
        label: 'QA Assigned',
      };
    default:
      return {
        icon: <TicketToken className='size-3 text-muted-foreground' />,
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
  const actorName = actor ? getUserDisplayName(actor) : 'Xyne';

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
      <div className='text-sm font-medium break-words whitespace-normal'>
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
    <span className='text-sm'>
      <span className={activity.isRead ? 'text-muted-foreground' : 'font-semibold'}>
        {ticketXyneId}
      </span>
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
      focusThread
      supportTargetPath={supportTargetPath}
      isExpanded={isExpanded}
    >
      {isExpanded ? expandedContent : condensedContent}
    </ActivityItemCard>
  );
};
