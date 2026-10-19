import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  Ticket,
  Clock,
  SquareKanban,
  UserPlus,
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
} from 'lucide-react-native';
import { ActivityV2Card } from './activity-v2-card';
import { CopyableValue } from '@/src/components/ui/copyable-value';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

type Config = {
  iconElement: ReactElement;
  badgeColorClass: string;
  description: string;
  label: string;
};

const getConfig = (actorAction: string): Config => {
  switch (actorAction) {
    case 'ticket_status':
      return {
        iconElement: <Ticket size={12} color='#15603e' />,
        badgeColorClass: 'bg-green-100',
        description: 'updated status of ticket in',
        label: 'Status',
      };
    case 'ticket_eta':
      return {
        iconElement: <Clock size={12} color='#a16207' />,
        badgeColorClass: 'bg-yellow-100',
        description: 'updated due date of ticket in',
        label: 'Due Date',
      };
    case 'ticket_board':
      return {
        iconElement: <SquareKanban size={12} color='#1264a3' />,
        badgeColorClass: 'bg-blue-100',
        description: 'moved ticket to another board in',
        label: 'Board',
      };
    case 'ticket_assigned_to':
      return {
        iconElement: <UserPlus size={12} color='#1264a3' />,
        badgeColorClass: 'bg-blue-100',
        description: 'changed assignee of ticket in',
        label: 'Assignee',
      };
    case 'ticket_pr_created':
      return {
        iconElement: <GitPullRequest size={12} color='#1264a3' />,
        badgeColorClass: 'bg-blue-100',
        description: 'raised a PR for ticket in',
        label: 'PR Raised',
      };
    case 'ticket_pr_updated':
      return {
        iconElement: <GitPullRequest size={12} color='#a16207' />,
        badgeColorClass: 'bg-yellow-100',
        description: 'updated a PR for ticket in',
        label: 'PR Updated',
      };
    case 'ticket_pr_merged':
      return {
        iconElement: <GitMerge size={12} color='#15603e' />,
        badgeColorClass: 'bg-green-100',
        description: 'merged a PR for ticket in',
        label: 'PR Merged',
      };
    case 'ticket_pr_declined':
      return {
        iconElement: <GitPullRequestClosed size={12} color='#b91c1c' />,
        badgeColorClass: 'bg-red-100',
        description: 'declined a PR for ticket in',
        label: 'PR Declined',
      };
    case 'ticket_pr_reviewer_assigned':
      return {
        iconElement: <GitPullRequest size={12} color='#1264a3' />,
        badgeColorClass: 'bg-blue-100',
        description: 'assigned you as PR reviewer for ticket',
        label: 'PR Reviewer Assigned',
      };
    case 'ticket_qa_assigned':
      return {
        iconElement: <UserPlus size={12} color='#15603e' />,
        badgeColorClass: 'bg-green-100',
        description: 'assigned you as QA for ticket',
        label: 'QA Assigned',
      };
    default:
      return {
        iconElement: <Ticket size={12} color='#6b7280' />,
        badgeColorClass: 'bg-card',
        description: 'updated ticket in',
        label: 'Ticket',
      };
  }
};

export const TicketUpdateActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const ticket = activity.ticket;
  const actorId = activity.actorId ?? 'system';
  if (!ticket) return null;
  const ticketXyneId = ticket.xyneId ?? activity.ticketId ?? activity.actionSourceId ?? '';
  const config = getConfig(activity.actorAction ?? '');
  const isPRAction = (activity.actorAction ?? '').startsWith('ticket_pr_');

  return (
    <ActivityV2Card
      activity={activity}
      actorId={actorId}
      actorName={activity.actorId ? undefined : 'Xyne'}
      badgeIcon={config.iconElement}
      badgeColorClass={config.badgeColorClass}
      description={config.description}
      onPress={() => {
        const ticketId = activity.ticketId ?? activity.actionSourceId ?? ticket.id;
        if (!ticketId) return;
        router.push({
          pathname: '/ticket/[ticketId]',
          params: { ticketId, selectedTab: 'activity' },
        });
      }}
    >
      <View className='gap-1'>
        <Text
          className='text-[15px] text-activity-description font-medium'
          style={{ lineHeight: 24 }}
          numberOfLines={2}
        >
          {isPRAction ? config.label.toLowerCase() : `${config.label} updated`} for ticket &ldquo;
          {ticket.title}&rdquo;
        </Text>
        <CopyableValue
          value={ticketXyneId}
          label='Ticket ID'
          monospace
          textClassName='text-xs text-activity-description font-medium'
          copyAccessibilityLabel='Copy ticket ID'
        />
      </View>
    </ActivityV2Card>
  );
};
