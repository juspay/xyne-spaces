import { type ReactElement } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { UserPlus } from 'lucide-react-native';
import { useUser } from '@/src/hooks/useUsers';
import { ActivityV2Card } from './activity-v2-card';
import { CopyableValue } from '@/src/components/ui/copyable-value';
import type { ActivityV2Props } from './activity-v2/activity-v2.types';

export const TicketAssignmentActivity = ({ activity }: ActivityV2Props): ReactElement | null => {
  const ticket = activity.ticket;
  const actorId = activity.actorId ?? 'system';
  const assignedUser = useUser(ticket?.assignedTo ?? '');

  if (!ticket) return null;

  const assignedUserName = assignedUser?.name ?? 'Unknown';
  const ticketXyneId = ticket.xyneId ?? activity.ticketId ?? activity.actionSourceId ?? '';
  const isRecipientAssigned = ticket.assignedTo === activity.userId;
  const description = isRecipientAssigned
    ? 'assigned you to ticket in'
    : 'changed assignee of ticket in';

  return (
    <ActivityV2Card
      activity={activity}
      actorId={actorId}
      actorName={activity.actorId ? undefined : 'Xyne'}
      badgeIcon={<UserPlus size={12} color='#1264a3' />}
      badgeColorClass='bg-blue-100'
      description={description}
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
          {isRecipientAssigned
            ? `You have been assigned to ticket "${ticket.title}"`
            : `${assignedUserName} has been assigned to ticket "${ticket.title}"`}
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
